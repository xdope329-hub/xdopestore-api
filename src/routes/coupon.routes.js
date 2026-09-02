const router = require('express').Router();
const Coupon = require('../models/Coupon');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// Campos que un cliente puede ver de un cupón vigente (para el "ver
// cupones" del checkout). Límites de uso, contadores y flags internos
// quedan fuera; el catálogo completo es solo para administradores.
const publicCouponFields = (c) => ({
  id: c.id || c._id,
  title: c.title,
  description: c.description,
  code: c.code,
  type: c.type,
  amount: c.amount,
  min_spend: c.min_spend,
  end_date: c.end_date,
});

// GET /coupon/public — cupones activos y vigentes, vista de cliente.
router.get('/public', auth, async (req, res) => {
  const now = new Date();
  const data = await Coupon.find({
    status: 1,
    is_expired: { $ne: true },
    $and: [
      { $or: [{ start_date: null }, { start_date: { $exists: false } }, { start_date: { $lte: now } }] },
      { $or: [{ end_date: null }, { end_date: { $exists: false } }, { end_date: { $gte: now } }] },
    ],
  }).sort({ createdAt: -1 }).limit(20);
  res.json({ data: data.map(publicCouponFields) });
});

// Catálogo completo: solo administración.
router.get('/', auth, adminOnly, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.search) filter.code = new RegExp(req.query.search, 'i');
  const total = await Coupon.countDocuments(filter);
  const data = await Coupon.find(filter).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 });
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data });
});

router.get('/:id', auth, adminOnly, async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
  res.json(coupon);
});

// POST /coupon/check — validate a coupon code (public or auth)
router.post('/check', async (req, res) => {
  const { code } = req.body;
  const coupon = await Coupon.findOne({ code: code?.toUpperCase(), status: 1 });
  if (!coupon) return res.status(404).json({ message: 'Invalid coupon code' });
  const now = new Date();
  if (coupon.end_date && coupon.end_date < now) return res.status(422).json({ message: 'Coupon expired' });
  res.json(coupon);
});

router.post('/', auth, adminOnly, async (req, res) => {
  const coupon = await Coupon.create({ ...req.body, created_by_id: req.user._id });
  res.status(201).json(coupon);
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  const update = { ...req.body };
  // Al desactivar la expiración desde el admin, elimina las fechas viejas
  // para que no sigan venciendo el cupón silenciosamente.
  const ops = { $set: update };
  if (update.is_expired === false || update.is_expired === 0) {
    delete update.start_date;
    delete update.end_date;
    ops.$unset = { start_date: 1, end_date: 1 };
  }
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, ops, { new: true });
  res.json(coupon);
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  await Coupon.findByIdAndDelete(req.params.id);
  res.json({ message: 'Coupon deleted' });
});

module.exports = router;
