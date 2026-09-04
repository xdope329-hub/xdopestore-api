const router = require('express').Router();
const mongoose = require('mongoose');
const { isAdminUser } = require('../utils/roles');
const Review = require('../models/Review');
const Order = require('../models/Order');
const OrderStatus = require('../models/OrderStatus');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const adminOnly = require('../middleware/adminOnly');
const { publicFormLimiter } = require('../middleware/rateLimiters');
const {
  REVIEW_STATUS,
  parseModerationStatus,
  statusSlug,
  validateReviewInput,
  pendingReviewItems,
} = require('../utils/reviewModeration');

const isObjectId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === v;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeReview(r) {
  const obj = r.toJSON ? r.toJSON() : r;
  return {
    id: obj._id || obj.id,
    rating: obj.rating,
    description: obj.description,
    status: obj.status,
    status_slug: statusSlug(obj.status),
    moderated_at: obj.moderated_at || null,
    created_at: obj.createdAt,
    updated_at: obj.updatedAt,
    consumer: obj.consumer_id
      ? {
          id: obj.consumer_id._id || obj.consumer_id.id,
          name: obj.consumer_id.name,
          profile_image: obj.consumer_id.profile_image_id || null,
        }
      : null,
    product: obj.product_id
      ? {
          id: obj.product_id._id || obj.product_id.id,
          name: obj.product_id.name,
          slug: obj.product_id.slug,
          product_thumbnail: obj.product_id.product_thumbnail_id || null,
        }
      : null,
  };
}

const populateReview = (q) =>
  q
    .populate({ path: 'consumer_id', select: 'name profile_image_id', populate: { path: 'profile_image_id', select: 'original_url' } })
    .populate({ path: 'product_id', select: 'name slug product_thumbnail_id', populate: { path: 'product_thumbnail_id', select: 'original_url' } });

// GET /review — público: solo reseñas APROBADAS. Administrador: todas, con
// filtro opcional ?status=pending|approved|rejected y búsqueda por texto.
router.get('/', optionalAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.paginate) || 15, 100);
  const admin = isAdminUser(req.user);

  const filter = {};
  if (req.query.product_id) filter.product_id = req.query.product_id;
  if (admin) {
    const wanted = parseModerationStatus(req.query.status);
    if (wanted !== null) filter.status = wanted;
    if (req.query.search) filter.description = { $regex: escapeRegex(req.query.search), $options: 'i' };
  } else {
    filter.status = REVIEW_STATUS.APPROVED;
  }

  // Sin columna elegida: las más recientes primero (el admin manda
  // `sort=asc` con `field` vacío por defecto; no debe invertir el orden).
  const SORTABLE = { rating: 'rating', created_at: 'createdAt', status: 'status' };
  const sortField = SORTABLE[req.query.field];
  const sort = sortField
    ? { [sortField]: String(req.query.sort).toLowerCase() === 'asc' ? 1 : -1 }
    : { createdAt: -1 };

  const total = await Review.countDocuments(filter);
  const reviews = await populateReview(
    Review.find(filter).skip((page - 1) * limit).limit(limit).sort(sort)
  );

  res.json({
    current_page: page,
    last_page: Math.ceil(total / limit),
    total,
    per_page: limit,
    data: reviews.map(normalizeReview),
  });
});

// GET /review/pending — productos de pedidos ENTREGADOS del cliente que aún
// no ha reseñado. Alimenta el aviso "Califica tu compra" de la tienda.
router.get('/pending', auth, async (req, res) => {
  const delivered = await OrderStatus.findOne({ slug: 'delivered' });
  if (!delivered) return res.json({ data: [] });
  const orders = await Order.find({ consumer_id: req.user._id, status_id: delivered._id })
    .sort({ updatedAt: -1 })
    .populate({ path: 'products.product_id', select: 'name slug product_thumbnail_id', populate: { path: 'product_thumbnail_id', select: 'original_url' } });
  const reviews = await Review.find({ consumer_id: req.user._id }).select('product_id status');
  res.json({ data: pendingReviewItems(orders, reviews) });
});

// POST /review — el cliente crea su reseña; queda PENDIENTE hasta que el
// administrador la apruebe.
router.post('/', auth, publicFormLimiter, async (req, res) => {
  const { product_id } = req.body || {};
  if (!isObjectId(String(product_id || ''))) return res.status(422).json({ message: 'Producto inválido' });

  const input = validateReviewInput(req.body);
  if (!input.ok) return res.status(422).json({ message: input.message });

  const delivered = await OrderStatus.findOne({ slug: 'delivered' });
  const hasPurchased = await Order.findOne({
    consumer_id: req.user._id,
    'products.product_id': product_id,
    status_id: delivered?._id,
  });
  if (!hasPurchased) return res.status(403).json({ message: 'Debes comprar el producto para dejar una reseña' });

  const existing = await Review.findOne({ product_id, consumer_id: req.user._id });
  if (existing) return res.status(409).json({ message: 'Ya dejaste una reseña de este producto. Puedes editarla.' });

  // Solo los campos que el cliente puede fijar: nunca `status` ni otros
  // internos por asignación masiva.
  const { review_image_id } = req.body;
  const review = await Review.create({
    product_id,
    rating: input.values.rating,
    description: input.values.description,
    review_image_id: isObjectId(String(review_image_id || '')) ? review_image_id : undefined,
    consumer_id: req.user._id,
    status: REVIEW_STATUS.PENDING,
  });
  const payload = review.toJSON ? review.toJSON() : review;
  res.status(201).json({ ...payload, message: 'Gracias por tu opinión. Se publicará cuando sea revisada.' });
});

// PUT /review/:id/status — moderación (solo administración).
router.put('/:id/status', auth, adminOnly, async (req, res) => {
  const status = parseModerationStatus(req.body?.status);
  if (status === null) return res.status(422).json({ message: 'Estado inválido: usa pending, approved o rejected' });
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ message: 'Review no encontrada' });
  review.status = status;
  review.moderated_at = status === REVIEW_STATUS.PENDING ? null : new Date();
  await review.save();
  res.json({ ...normalizeReview(review), message: `Reseña ${statusSlug(status)}` });
});

// PUT /review/:id — el autor edita su reseña; vuelve a PENDIENTE.
router.put('/:id', auth, publicFormLimiter, async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ message: 'Review no encontrada' });
  if (review.consumer_id.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'No autorizado' });

  const input = validateReviewInput(req.body, { partial: true });
  if (!input.ok) return res.status(422).json({ message: input.message });

  if (input.values.rating !== undefined) review.rating = input.values.rating;
  if (input.values.description !== undefined) review.description = input.values.description;
  review.status = REVIEW_STATUS.PENDING;
  review.moderated_at = null;
  await review.save();
  const payload = review.toJSON ? review.toJSON() : review;
  res.json({ ...payload, message: 'Reseña actualizada. Se publicará cuando sea revisada.' });
});

router.delete('/:id', auth, async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ message: 'Review no encontrada' });
  const isAdmin = isAdminUser(req.user);
  if (!isAdmin && review.consumer_id.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'No autorizado' });
  await review.deleteOne();
  res.json({ message: 'Review eliminada' });
});

module.exports = router;
