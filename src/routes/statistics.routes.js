const router = require('express').Router();
const Product = require('../models/Product');
const Order = require('../models/Order');
const OrderStatus = require('../models/OrderStatus');
const User = require('../models/User');
const Review = require('../models/Review');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// GET /statistics/count
router.get('/count', auth, adminOnly, async (req, res) => {
  // Un pago aprobado deja payment_status='completed' (ver payment.routes.js).
  const PAID = 'completed';
  const [products, orders, users, reviews, revenueAgg, statusAgg, statuses, mercadopagoPaid] = await Promise.all([
    Product.countDocuments(),
    Order.countDocuments(),
    User.countDocuments(),
    Review.countDocuments(),
    Order.aggregate([{ $match: { payment_status: PAID } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    // Las órdenes referencian el estado por status_id (ObjectId → OrderStatus),
    // no por un campo de texto: se agrupa por id y se traduce a slug abajo.
    Order.aggregate([{ $group: { _id: '$status_id', count: { $sum: 1 } } }]),
    OrderStatus.find({}, 'slug').lean(),
    // Pestaña "Mercado Pago pagados" del admin.
    Order.countDocuments({ payment_method: 'mercadopago', payment_status: PAID }),
  ]);

  const slugById = {};
  statuses.forEach((st) => { slugById[String(st._id)] = st.slug; });
  const statusMap = {};
  statusAgg.forEach(s => {
    const slug = s._id ? slugById[String(s._id)] : null;
    if (slug) statusMap[slug] = s.count;
  });

  res.json({
    total_products: products,
    total_orders: orders,
    total_users: users,
    total_reviews: reviews,
    total_stores: 0,
    total_revenue: revenueAgg[0]?.total || 0,
    total_pending_orders: statusMap['pending'] || 0,
    total_processing_orders: statusMap['processing'] || 0,
    total_cancelled_orders: statusMap['cancelled'] || 0,
    total_shipped_orders: statusMap['shipped'] || 0,
    total_out_of_delivery_orders: statusMap['out_for_delivery'] || 0,
    total_delivered_orders: statusMap['delivered'] || 0,
    total_mercadopago_paid_orders: mercadopagoPaid,
  });
});

// GET /dashboard/chart
router.get('/chart', auth, adminOnly, async (req, res) => {
  // Last 7 days order data
  const days = 7;
  const start = new Date();
  start.setDate(start.getDate() - days);

  const orders = await Order.aggregate([
    { $match: { createdAt: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
        revenue: { $sum: '$total' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({ data: orders });
});

module.exports = router;
