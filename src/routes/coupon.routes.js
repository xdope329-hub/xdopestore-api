const router = require('express').Router();
const Coupon = require('../models/Coupon');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

router.get('/', auth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.search) filter.code = new RegExp(req.query.search, 'i');
  const total = await Coupon.countDocuments(filter);
  const data = await Coupon.find(filter).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 });
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data });
});

router.get('/:id', auth, async (req, res) => {
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
