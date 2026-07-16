const router = require('express').Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { signToken } = require('../config/jwt');
const {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
} = require('../config/refreshTokens');
const {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
} = require('../middleware/rateLimiters');
const { verifyRecaptcha } = require('../middleware/recaptcha');
const { verifyGoogleIdToken } = require('../config/googleAuth');

// Dummy hash to keep login response time constant when the email isn't found
// (prevents email-existence enumeration via timing).
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8w/8g4iPqYX0FZ7RgFqvZQ.KMz.T1i';

function isPasswordStrong(pw) {
  if (typeof pw !== 'string') return false;
  if (pw.length < 8 || pw.length > 128) return false;
  if (!/[A-Za-z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  return true;
}

// Bundle the token pair a client needs to keep a session alive.
async function issueSession(user, req) {
  const access_token = signToken(user._id);
  const refresh_token = await issueRefreshToken(user._id, req);
  return { access_token, refresh_token, token: access_token }; // `token` for legacy client compat
}

// POST /login
router.post('/login', loginLimiter, verifyRecaptcha, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(422).json({ message: 'Email and password required' });

  const user = await User.findOne({ email: String(email).toLowerCase() }).populate('role');
  const hashToTest = user ? user.password : DUMMY_HASH;
  const valid = await bcrypt.compare(password, hashToTest);
  if (!user || !valid) return res.status(401).json({ message: 'Invalid credentials' });
  if (user.status === 0) return res.status(403).json({ message: 'Account disabled' });

  const session = await issueSession(user, req);
  res.json({ ...session, data: user });
});

// POST /register
router.post('/register', registerLimiter, verifyRecaptcha, async (req, res) => {
  const Role = require('../models/Role');
  const { name, email, password, phone, country_code } = req.body;
  if (!name || !email || !password) {
    return res.status(422).json({ message: 'Name, email and password are required' });
  }
  if (!isPasswordStrong(password)) {
    return res.status(422).json({
      message: 'Password must be 8-128 characters and contain at least one letter and one number',
    });
  }
  const normalized = String(email).toLowerCase();
  const exists = await User.findOne({ email: normalized });
  if (exists) return res.status(422).json({ message: 'Email already registered' });

  const consumerRole = await Role.findOne({ name: 'consumer' });
  const user = await User.create({ name, email: normalized, password, phone, country_code, role: consumerRole?._id });
  const populated = await User.findById(user._id).populate('role');
  const session = await issueSession(user, req);
  res.status(201).json({ ...session, data: populated });
});

// POST /login/google - Sign in with Google (Google Identity Services credential)
// No captcha here: Google's own flow already gates bots, and the ID token is
// verified server-side against GOOGLE_CLIENT_ID.
router.post('/login/google', loginLimiter, async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(422).json({ message: 'Google credential required' });

  let payload;
  try {
    payload = await verifyGoogleIdToken(credential);
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') {
      return res.status(503).json({ message: 'Google login is not configured on this server' });
    }
    if (err.code === 'UNVERIFIED') {
      return res.status(403).json({ message: 'Google account email is not verified' });
    }
    return res.status(401).json({ message: 'Invalid Google credential' });
  }

  const email = String(payload.email).toLowerCase();
  let user = await User.findOne({ email }).populate('role');

  if (user) {
    if (user.status === 0) return res.status(403).json({ message: 'Account disabled' });
    // Link the Google identity to the existing account on first Google login.
    if (!user.google_id) {
      user.google_id = payload.sub;
      if (!user.email_verified_at) user.email_verified_at = new Date();
      await user.save({ validateBeforeSave: false });
    } else if (user.google_id !== payload.sub) {
      // Same email but a different Google subject — refuse rather than merge.
      return res.status(401).json({ message: 'Google account mismatch for this email' });
    }
  } else {
    const Role = require('../models/Role');
    const crypto = require('crypto');
    const consumerRole = await Role.findOne({ name: 'consumer' });
    // Google-only accounts still need a password field: generate a random one
    // nobody knows. The user can set a real one later via the reset flow.
    const randomPassword = `${crypto.randomBytes(24).toString('base64url')}aA1`;
    const created = await User.create({
      name: payload.name || email.split('@')[0],
      email,
      password: randomPassword,
      google_id: payload.sub,
      auth_provider: 'google',
      email_verified_at: new Date(),
      role: consumerRole?._id,
    });
    user = await User.findById(created._id).populate('role');
  }

  const session = await issueSession(user, req);
  res.json({ ...session, data: user });
});

// POST /refresh - swap a refresh token for a new access token + rotated refresh
router.post('/refresh', async (req, res) => {
  const rawRefresh = req.body?.refresh_token || req.headers['x-refresh-token'];
  if (!rawRefresh) return res.status(401).json({ message: 'Missing refresh token' });

  try {
    const { user_id, refresh_token } = await rotateRefreshToken(rawRefresh, req);
    const user = await User.findById(user_id);
    if (!user || user.status === 0) return res.status(401).json({ message: 'Account not active' });
    const access_token = signToken(user_id);
    res.json({ access_token, refresh_token, token: access_token });
  } catch (err) {
    // Every failure looks the same to the client - don't distinguish
    // "unknown" vs "expired" vs "replay-detected".
    return res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
});

// POST /logout - revoke a single refresh token (this device)
router.post('/logout', async (req, res) => {
  const rawRefresh = req.body?.refresh_token || req.headers['x-refresh-token'];
  await revokeRefreshToken(rawRefresh);
  res.json({ message: 'Logged out' });
});

// POST /logout/all - requires access token; revokes every refresh for the user
router.post('/logout/all', auth, async (req, res) => {
  await revokeAllForUser(req.user._id);
  res.json({ message: 'Logged out from all devices' });
});

// GET /logout - kept as a no-op for legacy clients that don't send the token
router.get('/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

// GET /self
router.get('/self', auth, async (req, res) => {
  const { transformUser } = require('../utils/transform');
  const { resolvePermissions, PERMISSIONS } = require('../data/permissions');
  const Address = require('../models/Address');
  const user = await require('../models/User').findById(req.user._id)
    .populate('role')
    .populate('profile_image_id', 'asset_url original_url')
    .select('-password -otp -otp_expires_at -otp_verified_at -otp_verified_expires_at');
  const obj = transformUser(user);
  const isAdmin = user.role?.system_reserve === '1';
  obj.permission = isAdmin ? PERMISSIONS : resolvePermissions(user.role?.permissions || []);
  obj.address = await Address.find({ user_id: req.user._id }).sort({ is_default: -1, createdAt: -1 });
  res.json(obj);
});

// POST /forgot-password (unchanged behaviour, still rate-limited + no leaks)
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(422).json({ message: 'Email required' });
  const normalized = String(email).toLowerCase();
  const user = await User.findOne({ email: normalized });
  if (user) {
    user.otp = String(Math.floor(100000 + Math.random() * 900000));
    user.otp_expires_at = new Date(Date.now() + 15 * 60 * 1000);
    await user.save({ validateBeforeSave: false });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[forgot-password] OTP for', normalized, '=', user.otp);
    }
  }
  res.json({ message: 'If that email is registered, a reset code has been sent.' });
});

router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(422).json({ message: 'Email and OTP required' });
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !user.otp || user.otp !== String(otp) || !user.otp_expires_at || user.otp_expires_at < new Date()) {
    return res.status(422).json({ message: 'Invalid or expired OTP' });
  }
  user.otp_verified_at = new Date();
  user.otp_verified_expires_at = new Date(Date.now() + 10 * 60 * 1000);
  user.otp = undefined;
  user.otp_expires_at = undefined;
  await user.save({ validateBeforeSave: false });
  res.json({ message: 'OTP verified', email: user.email });
});
router.post('/verify-token', (req, res, next) => { req.url = '/verify-otp'; router.handle(req, res, next); });

router.post('/update-password', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(422).json({ message: 'Email and password required' });
  if (!isPasswordStrong(password)) {
    return res.status(422).json({
      message: 'Password must be 8-128 characters and contain at least one letter and one number',
    });
  }
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !user.otp_verified_expires_at || user.otp_verified_expires_at < new Date()) {
    return res.status(422).json({ message: 'OTP not verified or verification expired. Please restart the reset flow.' });
  }
  user.password = password;
  user.otp_verified_at = undefined;
  user.otp_verified_expires_at = undefined;
  await user.save();
  // Force re-login everywhere after a password change
  await revokeAllForUser(user._id);
  res.json({ message: 'Password updated' });
});

module.exports = router;
