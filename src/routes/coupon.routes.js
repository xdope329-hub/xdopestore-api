const router = require('express').Router();
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const adminOnly = require('../middleware/adminOnly');

// Campos que un cliente puede ver de un cupón vigente (para el "ver
// cupones" del checkout y la página de ofertas). Límites de uso,
// contadores y flags internos quedan fuera; el catálogo completo es solo
// para administradores.
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

// Un cupón con tope de usos agotado ya no se ofrece al cliente.
const hasUsesLeft = (c) => Boolean(c.is_unlimited) || !c.usage_per_coupon || (c.used || 0) < c.usage_per_coupon;

// Solo ids válidos y sin repetidos: el admin manda arrays de ids de producto
// (pestaña Restricciones); un "" o un id inválido hacía fallar el guardado
// con un CastError (500).
const isObjectId = (v) => typeof v === 'string' && v.length === 24 && mongoose.Types.ObjectId.isValid(v);
const cleanIds = (value) => {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const ids = [];
  for (const v of raw) {
    const id = String(v && typeof v === 'object' ? v._id || v.id || '' : v || '');
    if (isObjectId(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
};

// Cuerpo del admin normalizado para crear/editar: nunca se aceptan campos
// internos (contador de usos, autor) y las listas de productos se limpian.
function sanitizeCouponBody(body = {}) {
  const clean = { ...body };
  ['_id', 'id', 'used', 'created_by_id', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].forEach((k) => { delete clean[k]; });
  if (clean.code !== undefined) clean.code = String(clean.code).trim();
  for (const key of ['products', 'exclude_products']) {
    if (clean[key] !== undefined) clean[key] = cleanIds(clean[key]);
  }
  return clean;
}

const isDuplicateCode = (err) => Boolean(err) && err.code === 11000;

// GET /coupon/public — cupones activos y vigentes, vista de cliente. También
// para invitados: pueden usar cupones en el checkout. La vigencia la deciden
// las fechas; `is_expired` solo indica que el cupón TIENE ventana de fechas
// (antes se usaba como filtro y ocultaba cupones vigentes).
router.get('/public', optionalAuth, async (req, res) => {
  const now = new Date();
  const data = await Coupon.find({
    status: 1,
    $and: [
      { $or: [{ start_date: null }, { start_date: { $exists: false } }, { start_date: { $lte: now } }] },
      { $or: [{ end_date: null }, { end_date: { $exists: false } }, { end_date: { $gte: now } }] },
    ],
  }).sort({ createdAt: -1 }).limit(20);
  res.json({ data: data.filter(hasUsesLeft).map(publicCouponFields) });
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

// Detalle para el formulario de edición: los productos van poblados con su
// nombre para que el selector muestre la selección guardada.
router.get('/:id', auth, adminOnly, async (req, res) => {
  const coupon = await Coupon.findById(req.params.id).populate('products', 'name').populate('exclude_products', 'name');
  if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
  res.json(coupon);
});

// POST /coupon/check — validate a coupon code (public or auth)
router.post('/check', async (req, res) => {
  const { code } = req.body;
  const coupon = await Coupon.findOne({ code: String(code || '').trim().toUpperCase(), status: 1 });
  if (!coupon) return res.status(404).json({ message: 'Invalid coupon code' });
  const now = new Date();
  if (coupon.end_date && coupon.end_date < now) return res.status(422).json({ message: 'Coupon expired' });
  res.json(coupon);
});

router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const coupon = await Coupon.create({ ...sanitizeCouponBody(req.body), created_by_id: req.user._id });
    res.status(201).json(coupon);
  } catch (err) {
    if (isDuplicateCode(err)) return res.status(422).json({ message: 'Ya existe un cupón con ese código' });
    throw err;
  }
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  const update = sanitizeCouponBody(req.body);
  // Al desactivar la vigencia desde el admin, elimina las fechas viejas
  // para que no sigan venciendo el cupón silenciosamente.
  const ops = { $set: update };
  if (update.is_expired === false || update.is_expired === 0 || update.is_expired === '0') {
    delete update.start_date;
    delete update.end_date;
    ops.$unset = { start_date: 1, end_date: 1 };
  }
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, ops, { new: true, runValidators: true });
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
    res.json(coupon);
  } catch (err) {
    if (isDuplicateCode(err)) return res.status(422).json({ message: 'Ya existe un cupón con ese código' });
    throw err;
  }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  await Coupon.findByIdAndDelete(req.params.id);
  res.json({ message: 'Coupon deleted' });
});

module.exports = router;
