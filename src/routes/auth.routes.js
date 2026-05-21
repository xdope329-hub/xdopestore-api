const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(422).json({ message: 'Email and password required' });
  const user = await User.findOne({ email }).populate('role');
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const valid = await user.comparePassword(password);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
  const token = signToken(user._id);
  res.json({ token, access_token: token, data: user });
});

// POST /register
router.post('/register', async (req, res) => {
  const Role = require('../models/Role');
  const { name, email, password, phone, country_code } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(422).json({ message: 'Email already registered' });
  const consumerRole = await Role.findOne({ name: 'consumer' });
  const user = await User.create({ name, email, password, phone, country_code, role: consumerRole?._id });
  // (Wallet auto-creation removed when the consumer wallet feature was retired.)
  const populated = await User.findById(user._id).populate('role');
  const token = signToken(user._id);
  res.status(201).json({ token, access_token: token, data: populated });
});

// GET /self
router.get('/self', auth, async (req, res) => {
  const { transformUser } = require('../utils/transform');
  const { resolvePermissions, PERMISSIONS } = require('../data/permissions');
  const Address = require('../models/Address');
  const user = await require('../models/User').findById(req.user._id)
    .populate('role')
    .populate('profile_image_id', 'asset_url original_url')
    .select('-password');
  const obj = transformUser(user);
  // Admin role (system_reserve='1') gets all permissions
  const isAdmin = user.role?.system_reserve === '1';
  obj.permission = isAdmin ? PERMISSIONS : resolvePermissions(user.role?.permissions || []);
  // Inline the user's saved addresses so the storefront account & checkout pages
  // can pre-fill / preselect without an extra request.
  obj.address = await Address.find({ user_id: req.user._id }).sort({ is_default: -1, createdAt: -1 });
  res.json(obj);
});

// POST /forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.otp_expires_at = new Date(Date.now() + 15 * 60 * 1000);
  await user.save({ validateBeforeSave: false });
  // In production send email — for local dev just return the OTP
  res.json({ message: 'OTP sent', otp: user.otp, email: user.email });
});

// POST /verify-otp  (alias: /verify-token)
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.otp !== otp || user.otp_expires_at < new Date()) {
    return res.status(422).json({ message: 'Invalid or expired OTP' });
  }
  res.json({ message: 'OTP verified', email: user.email });
});
router.post('/verify-token', async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.otp !== otp || user.otp_expires_at < new Date()) {
    return res.status(422).json({ message: 'Invalid or expired OTP' });
  }
  res.json({ message: 'OTP verified', email: user.email });
});

// POST /update-password
router.post('/update-password', async (req, res) => {
  const { email, otp, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.otp !== otp) return res.status(422).json({ message: 'Invalid request' });
  user.password = password;
  user.otp = undefined;
  user.otp_expires_at = undefined;
  await user.save();
  res.json({ message: 'Password updated' });
});

// GET /logout
router.get('/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

module.exports = router;
