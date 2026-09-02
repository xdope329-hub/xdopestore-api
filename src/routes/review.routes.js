const router = require('express').Router();
const { isAdminUser } = require('../utils/roles');
const Review = require('../models/Review');
const Order = require('../models/Order');
const OrderStatus = require('../models/OrderStatus');
const auth = require('../middleware/auth');

function normalizeReview(r) {
  const obj = r.toJSON ? r.toJSON() : r;
  return {
    id: obj._id || obj.id,
    rating: obj.rating,
    description: obj.description,
    status: obj.status,
    created_at: obj.createdAt,
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
          product_thumbnail: obj.product_id.product_thumbnail_id || null,
        }
      : null,
  };
}

router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.product_id) filter.product_id = req.query.product_id;
  const total = await Review.countDocuments(filter);
  const reviews = await Review.find(filter)
    .skip((page - 1) * limit)
    .limit(limit)
    .sort({ createdAt: -1 })
    .populate({ path: 'consumer_id', select: 'name profile_image_id', populate: { path: 'profile_image_id', select: 'original_url' } })
    .populate({ path: 'product_id', select: 'name product_thumbnail_id', populate: { path: 'product_thumbnail_id', select: 'original_url' } });

  res.json({
    current_page: page,
    last_page: Math.ceil(total / limit),
    total,
    per_page: limit,
    data: reviews.map(normalizeReview),
  });
});

router.post('/', auth, async (req, res) => {
  const delivered = await OrderStatus.findOne({ slug: 'delivered' });
  const hasPurchased = await Order.findOne({
    consumer_id: req.user._id,
    'products.product_id': req.body.product_id,
    status_id: delivered?._id,
  });
  if (!hasPurchased) return res.status(403).json({ message: 'Debes comprar el producto para dejar una reseña' });

  // Solo los campos que el cliente puede fijar: nunca `status` ni otros
  // internos por asignación masiva.
  const { product_id, rating, description, review_image_id } = req.body;
  const review = await Review.create({ product_id, rating, description, review_image_id, consumer_id: req.user._id });
  res.status(201).json(review);
});

router.put('/:id', auth, async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ message: 'Review no encontrada' });
  if (review.consumer_id.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'No autorizado' });
  review.rating = req.body.rating ?? review.rating;
  review.description = req.body.description ?? review.description;
  await review.save();
  res.json(review);
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
