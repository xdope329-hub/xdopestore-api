const router = require('express').Router();
const Address = require('../models/Address');
const auth = require('../middleware/auth');
const { findCountry, findState } = require('../data/countries');

// Normalize the body coming from both the storefront and admin checkout forms.
// The forms send country_id / state_id as ids; we cache the resolved names so
// list rendering is cheap and survives a country catalog change.
function normalizeAddressBody(body = {}) {
  const out = { ...body };

  if (out.country_id !== undefined && out.country_id !== null && out.country_id !== '') {
    const c = findCountry(out.country_id);
    if (c) out.country_name = c.name;
    out.country_id = Number(out.country_id);
  }
  if (out.state_id !== undefined && out.state_id !== null && out.state_id !== '') {
    const s = findState(out.country_id, out.state_id);
    if (s) out.state_name = s.name;
    out.state_id = Number(out.state_id);
  }

  // Drop fields the model doesn't expect to avoid Mongoose silently casting them.
  delete out._method;
  delete out.country;
  delete out.state;
  // Campos internos: nunca desde el cliente (el dueño lo fija la ruta; un
  // PUT con user_id ajeno reasignaba la dirección a otro usuario).
  ['user_id', '_id', 'id', 'createdAt', 'updatedAt', '__v'].forEach((k) => { delete out[k]; });

  ['title', 'street', 'city'].forEach((k) => {
    if (typeof out[k] === 'string') out[k] = out[k].trim();
  });

  if (out.pincode !== undefined && out.pincode !== null) out.pincode = String(out.pincode);
  if (out.phone !== undefined && out.phone !== null) out.phone = String(out.phone);
  if (out.is_default !== undefined) out.is_default = Boolean(out.is_default);

  return out;
}

// GET /address — all addresses for the current user (default first)
router.get('/', auth, async (req, res) => {
  const data = await Address.find({ user_id: req.user._id }).sort({ is_default: -1, createdAt: -1 });
  res.json({ data });
});

// GET /address/:id
router.get('/:id', auth, async (req, res) => {
  const addr = await Address.findOne({ _id: req.params.id, user_id: req.user._id });
  if (!addr) return res.status(404).json({ message: 'Address not found' });
  res.json(addr);
});

// POST /address — create address, optionally marking it default
router.post('/', auth, async (req, res) => {
  const body = normalizeAddressBody(req.body);

  // If this is the user's first address, make it default automatically.
  const existingCount = await Address.countDocuments({ user_id: req.user._id });
  if (existingCount === 0) body.is_default = true;

  if (body.is_default) {
    await Address.updateMany({ user_id: req.user._id }, { is_default: false });
  }

  const addr = await Address.create({ ...body, user_id: req.user._id });
  res.status(201).json(addr);
});

// PUT /address/:id — update an existing address
router.put('/:id', auth, async (req, res) => {
  const body = normalizeAddressBody(req.body);

  if (body.is_default) {
    await Address.updateMany({ user_id: req.user._id }, { is_default: false });
  }
  const addr = await Address.findOneAndUpdate(
    { _id: req.params.id, user_id: req.user._id },
    body,
    { new: true }
  );
  if (!addr) return res.status(404).json({ message: 'Address not found' });
  res.json(addr);
});

// PATCH /address/:id/default — mark address as the user's default
router.patch('/:id/default', auth, async (req, res) => {
  const target = await Address.findOne({ _id: req.params.id, user_id: req.user._id });
  if (!target) return res.status(404).json({ message: 'Address not found' });
  await Address.updateMany({ user_id: req.user._id }, { is_default: false });
  target.is_default = true;
  await target.save();
  res.json(target);
});

// DELETE /address/:id
router.delete('/:id', auth, async (req, res) => {
  const wasDefault = await Address.findOne({ _id: req.params.id, user_id: req.user._id });
  await Address.findOneAndDelete({ _id: req.params.id, user_id: req.user._id });

  // If we removed the default, promote the most recent remaining address.
  if (wasDefault?.is_default) {
    const next = await Address.findOne({ user_id: req.user._id }).sort({ createdAt: -1 });
    if (next) { next.is_default = true; await next.save(); }
  }
  res.json({ message: 'Address deleted' });
});

module.exports = router;
