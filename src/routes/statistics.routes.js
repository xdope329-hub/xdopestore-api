const router = require('express').Router();
const Product = require('../models/Product');
const Order = require('../models/Order');
const OrderStatus = require('../models/OrderStatus');
const User = require('../models/User');
const Review = require('../models/Review');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { storeDayRange, STORE_TIMEZONE } = require('../utils/capacity');

// Estados de pago que cuentan como cobrados (incluye alias antiguos de la
// semilla/versiones previas; ver utils/orderStatusFlow.js).
const PAID_STATUSES = ['completed', 'paid', 'approved', 'success'];

/**
 * Ventas que cuentan como ingresos: pedidos no cancelados con el pago
 * confirmado — contra entrega (se cobra al entregar) o pasarela pagada — y
 * no reembolsados. Antes solo contaban los pagos "completed", así que
 * NINGÚN pedido contra entrega sumaba en el panel.
 */
function revenueMatch(cancelledId) {
  const match = {
    $and: [
      { $or: [{ payment_method: 'cod' }, { payment_status: { $in: PAID_STATUSES } }] },
      { payment_status: { $nin: ['refunded', 'rejected', 'cancelled'] } },
    ],
  };
  if (cancelledId) match.status_id = { $ne: cancelledId };
  return match;
}

/**
 * Rango de fechas del filtro del panel (filter_by: today | last_week |
 * last_month | this_year | all_time) en el día de la tienda. Antes el
 * parámetro llegaba y se ignoraba: las cifras eran siempre históricas.
 */
function periodRange(filterBy, now = new Date()) {
  const { start: today } = storeDayRange(now);
  const days = (n) => new Date(today.getTime() - n * 24 * 3600 * 1000);
  switch (String(filterBy || '').toLowerCase()) {
    case 'today': return { $gte: today };
    case 'last_week': return { $gte: days(7) };
    case 'last_month': return { $gte: days(30) };
    case 'this_year': {
      const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIMEZONE(), year: 'numeric' }).format(now));
      const { start } = storeDayRange(new Date(Date.UTC(year, 0, 1, 12)));
      return { $gte: start };
    }
    default: return null;
  }
}

// GET /statistics/count
router.get('/count', auth, adminOnly, async (req, res) => {
  const range = periodRange(req.query.filter_by);
  const inPeriod = range ? { createdAt: range } : {};
  const statuses = await OrderStatus.find({}, 'slug').lean();
  const cancelled = statuses.find((s) => s.slug === 'cancelled');
  const cancelledId = cancelled ? cancelled._id : null;

  const [products, orders, users, reviews, revenueAgg, statusAgg, mercadopagoPaid, reviewAgg] = await Promise.all([
    Product.countDocuments(),
    Order.countDocuments(inPeriod),
    User.countDocuments(),
    Review.countDocuments(),
    Order.aggregate([{ $match: { ...inPeriod, ...revenueMatch(cancelledId) } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    // Las órdenes referencian el estado por status_id (ObjectId → OrderStatus),
    // no por un campo de texto: se agrupa por id y se traduce a slug abajo.
    Order.aggregate([{ $match: inPeriod }, { $group: { _id: '$status_id', count: { $sum: 1 } } }]),
    // Pestaña "Mercado Pago pagados" del admin.
    Order.countDocuments({ ...inPeriod, payment_method: 'mercadopago', payment_status: { $in: PAID_STATUSES } }),
    // Pestañas de moderación de reseñas (pendiente / aprobada / rechazada).
    Review.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const reviewsByStatus = {};
  reviewAgg.forEach((r) => { reviewsByStatus[Number(r._id)] = r.count; });

  const slugById = {};
  statuses.forEach((st) => { slugById[String(st._id)] = st.slug; });
  const statusMap = {};
  statusAgg.forEach((s) => {
    const slug = s._id ? slugById[String(s._id)] : null;
    if (slug) statusMap[slug] = s.count;
  });

  res.json({
    total_products: products,
    total_orders: orders,
    total_users: users,
    total_reviews: reviews,
    total_pending_reviews: reviewsByStatus[0] || 0,
    total_approved_reviews: reviewsByStatus[1] || 0,
    total_rejected_reviews: reviewsByStatus[2] || 0,
    total_stores: 0,
    total_revenue: revenueAgg[0]?.total || 0,
    total_pending_orders: statusMap['pending'] || 0,
    total_processing_orders: statusMap['processing'] || 0,
    total_cancelled_orders: statusMap['cancelled'] || 0,
    total_shipped_orders: statusMap['shipped'] || 0,
    total_out_of_delivery_orders: statusMap['out_for_delivery'] || 0,
    total_delivered_orders: statusMap['delivered'] || 0,
    total_mercadopago_paid_orders: mercadopagoPaid,
    filter_by: range ? String(req.query.filter_by).toLowerCase() : 'all_time',
  });
});

// GET /dashboard/chart — últimos 7 días (día de la tienda), ingresos con el
// mismo criterio que el panel. Devuelve la forma que lee el admin
// (ChartData.js: months / revenues / commissions) además de las filas.
router.get('/chart', auth, adminOnly, async (req, res) => {
  const days = 7;
  const { start: today } = storeDayRange(new Date());
  const start = new Date(today.getTime() - (days - 1) * 24 * 3600 * 1000);
  const cancelled = await OrderStatus.findOne({ slug: 'cancelled' }, '_id').lean();

  const rows = await Order.aggregate([
    { $match: { createdAt: { $gte: start }, ...revenueMatch(cancelled?._id || null) } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: STORE_TIMEZONE() } },
        count: { $sum: 1 },
        revenue: { $sum: '$total' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byDay = Object.fromEntries(rows.map((r) => [r._id, r]));
  const labels = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start.getTime() + i * 24 * 3600 * 1000 + 12 * 3600 * 1000);
    labels.push(new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TIMEZONE(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(day));
  }
  res.json({
    data: labels.map((label) => byDay[label] || { _id: label, count: 0, revenue: 0 }),
    months: labels,
    revenues: labels.map((label) => byDay[label]?.revenue || 0),
    commissions: labels.map(() => 0),
  });
});

module.exports = router;
