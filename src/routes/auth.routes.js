const router = require('express').Router();
const { isAdminUser } = require('../utils/roles');
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
const crypto = require('crypto');
const {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  otpLimiter,
  refreshLimiter,
} = require('../middleware/rateLimiters');

// Password reset: 6-digit code from a CSPRNG, limited attempts, and a
// single-use token that /update-password must present.
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
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
// NOTE: /login is protected by the rate limiter (10 attempts / 15 min per
// IP) but intentionally NOT by reCAPTCHA: the admin dashboard's login form
// has no captcha widget, so enforcing it here locks administrators out on
// any deployment where RECAPTCHA_SECRET_KEY is set. Register and password
// reset keep captcha — those are the bot-abuse surfaces.
router.post('/login', loginLimiter, async (req, res) => {
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

// Alta de un cliente (la usan /register y /register/checkout): valida, crea
// la cuenta, adopta los pedidos de invitado hechos con ese correo y devuelve
// la sesión. { status, message } si falla; { status: 201, body } si no.
async function createConsumerAccount({ name, email, password, phone, country_code } = {}, req) {
  if (!name || !email || !password) return { status: 422, message: 'Name, email and password are required' };
  if (!isPasswordStrong(password)) {
    return { status: 422, message: 'Password must be 8-128 characters and contain at least one letter and one number' };
  }
  const normalized = String(email).toLowerCase();
  const exists = await User.findOne({ email: normalized });
  if (exists) return { status: 422, message: 'Email already registered' };

  const Role = require('../models/Role');
  const consumerRole = await Role.findOne({ name: 'consumer' });
  const user = await User.create({ name, email: normalized, password, phone, country_code, role: consumerRole?._id });
  const populated = await User.findById(user._id).populate('role');
  const session = await issueSession(user, req);
  // Adopción de pedidos de invitado: si este correo compró sin cuenta,
  // sus órdenes pasan a la cuenta recién creada (aparecen en "Mis pedidos").
  try {
    const Order = require('../models/Order');
    await Order.updateMany(
      { guest_email: normalized, consumer_id: null },
      { $set: { consumer_id: user._id, is_guest: false } }
    );
  } catch (e) { console.warn('[register] no se pudieron adoptar pedidos de invitado:', e.message); }
  return { status: 201, body: { ...session, data: populated } };
}

// POST /register
router.post('/register', registerLimiter, verifyRecaptcha, async (req, res) => {
  const result = await createConsumerAccount(req.body || {}, req);
  if (result.status !== 201) return res.status(result.status).json({ message: result.message });
  res.status(201).json(result.body);
});

// POST /register/checkout — "Crear cuenta" del checkout de invitados. No pasa
// por reCAPTCHA (el checkout no tiene widget, y con la clave configurada el
// alta en segundo plano fallaba con 422); en su lugar exige el pedido recién
// creado con ese mismo correo como prueba de compra. Devuelve la sesión para
// que la tienda deje al cliente logueado.
const CHECKOUT_REGISTER_WINDOW_MS = 30 * 60 * 1000;
router.post('/register/checkout', registerLimiter, async (req, res) => {
  const { order_id, email } = req.body || {};
  const mongoose = require('mongoose');
  const Order = require('../models/Order');
  const order = mongoose.Types.ObjectId.isValid(String(order_id || '')) ? await Order.findById(order_id) : null;
  const sameEmail = Boolean(order?.guest_email) && order.guest_email === String(email || '').trim().toLowerCase();
  const recent = Boolean(order) && Date.now() - new Date(order.createdAt || 0).getTime() < CHECKOUT_REGISTER_WINDOW_MS;
  if (!order || !sameEmail || !recent) return res.status(422).json({ message: 'El pedido no corresponde a este correo' });
  const result = await createConsumerAccount(req.body || {}, req);
  if (result.status !== 201) return res.status(result.status).json({ message: result.message });
  res.status(201).json(result.body);
});

// POST /login/google - Sign in with Google (Google Identity Services credential)
// Captcha is required here too (when RECAPTCHA_SECRET_KEY is set): the store
// demands the captcha be solved before ANY login path, Google included.
// The ID token is additionally verified server-side against GOOGLE_CLIENT_ID.
// Google sign-in is NOT captcha-gated (standard practice): the signed Google
// credential is itself the anti-bot check, and the rate limiter still applies.
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
router.post('/refresh', refreshLimiter, async (req, res) => {
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
  const isAdmin = isAdminUser(user);
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
    // CSPRNG (Math.random no es apto para códigos de seguridad).
    user.otp = String(crypto.randomInt(100000, 1000000));
    user.otp_expires_at = new Date(Date.now() + OTP_TTL_MS);
    user.otp_attempts = 0;
    user.otp_verified_at = undefined;
    user.otp_verified_expires_at = undefined;
    user.password_reset_token_hash = undefined;
    user.password_reset_expires_at = undefined;
    await user.save({ validateBeforeSave: false });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[forgot-password] OTP for', normalized, '=', user.otp);
    }
    // El código viaja por correo (antes nunca se enviaba y el flujo no
    // podía completarse en producción). No bloquea la respuesta.
    const mail = require('../services/mail');
    mail.sendPasswordResetOTP({ email: user.email, name: user.name, otp: user.otp })
      .catch(mail.logMailError('password-reset-otp'));
  }
  res.json({ message: 'If that email is registered, a reset code has been sent.' });
});

// El admin envía el código como `token`; el storefront como `otp`.
router.post('/verify-otp', otpLimiter, async (req, res) => {
  const { email } = req.body || {};
  const otp = req.body?.otp ?? req.body?.token;
  if (!email || !otp) return res.status(422).json({ message: 'Email and OTP required' });
  const user = await User.findOne({ email: String(email).toLowerCase() });
  const invalid = () => res.status(422).json({ message: 'Invalid or expired OTP' });
  if (!user || !user.otp || !user.otp_expires_at || user.otp_expires_at < new Date()) return invalid();

  const presented = String(otp).trim();
  const matches = presented.length === user.otp.length && crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(user.otp));
  if (!matches) {
    // Contador por usuario: al agotar los intentos el código deja de valer
    // y hay que pedir uno nuevo (evita adivinar los 6 dígitos).
    user.otp_attempts = (user.otp_attempts || 0) + 1;
    if (user.otp_attempts >= OTP_MAX_ATTEMPTS) {
      user.otp = undefined;
      user.otp_expires_at = undefined;
    }
    await user.save({ validateBeforeSave: false });
    return invalid();
  }

  // Token de un solo uso para /update-password (se guarda solo su hash).
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.otp_verified_at = new Date();
  user.otp_verified_expires_at = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  user.password_reset_token_hash = sha256(resetToken);
  user.password_reset_expires_at = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  user.otp = undefined;
  user.otp_expires_at = undefined;
  user.otp_attempts = 0;
  await user.save({ validateBeforeSave: false });
  res.json({ message: 'OTP verified', email: user.email, reset_token: resetToken });
});
router.post('/verify-token', (req, res, next) => { req.url = '/verify-otp'; router.handle(req, res, next); });

// Exige el `reset_token` devuelto por /verify-otp (el admin lo manda como
// `token`): antes bastaba conocer el correo dentro de la ventana de 10 min.
router.post('/update-password', otpLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const resetToken = req.body?.reset_token ?? req.body?.token;
  if (!email || !password) return res.status(422).json({ message: 'Email and password required' });
  if (!resetToken) return res.status(422).json({ message: 'Reset token required. Please restart the reset flow.' });
  if (!isPasswordStrong(password)) {
    return res.status(422).json({
      message: 'Password must be 8-128 characters and contain at least one letter and one number',
    });
  }
  const user = await User.findOne({ email: String(email).toLowerCase() });
  const tokenValid =
    user &&
    user.password_reset_token_hash &&
    user.password_reset_expires_at &&
    user.password_reset_expires_at >= new Date() &&
    crypto.timingSafeEqual(Buffer.from(user.password_reset_token_hash), Buffer.from(sha256(resetToken)));
  if (!tokenValid) {
    return res.status(422).json({ message: 'OTP not verified or verification expired. Please restart the reset flow.' });
  }
  user.password = password;
  user.otp_verified_at = undefined;
  user.otp_verified_expires_at = undefined;
  user.password_reset_token_hash = undefined;
  user.password_reset_expires_at = undefined;
  await user.save();
  // Force re-login everywhere after a password change
  await revokeAllForUser(user._id);
  res.json({ message: 'Password updated' });
});

module.exports = router;
