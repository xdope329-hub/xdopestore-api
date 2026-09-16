// Solicitudes de reembolso: el cliente las crea desde el detalle de un
// pedido entregado; el administrador las aprueba o rechaza. Antes /refund
// era un stub (lista vacía y POST solo para administradores), así que el
// botón "Reembolso" de la tienda nunca podía funcionar.
const router = require('express').Router();
const mongoose = require('mongoose');
const Refund = require('../models/Refund');
const Order = require('../models/Order');
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { publicFormLimiter } = require('../middleware/rateLimiters');
const { isAdminUser } = require('../utils/roles');
const { parseRefundStatus, findOrderLine, validateRefundInput, refundEligibility, refundableAmount } = require('../utils/refundRules');

const isObjectId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === v;

function normalizeRefund(r) {
  const obj = r.toJSON ? r.toJSON() : r;
  const order = obj.order_id && typeof obj.order_id === 'object' ? obj.order_id : null;
  const user = obj.consumer_id && typeof obj.consumer_id === 'object' ? obj.consumer_id : null;
  const product = obj.product_id && typeof obj.product_id === 'object' ? obj.product_id : null;
  return {
    id: obj._id || obj.id,
    order_id: order ? order._id || order.id : obj.order_id,
    product_id: product ? product._id || product.id : obj.product_id,
    variation_id: obj.variation_id || null,
    reason: obj.reason,
    payment_type: obj.payment_type,
    amount: obj.amount,
    quantity: obj.quantity,
    status: obj.status,
    admin_note: obj.admin_note || null,
    moderated_at: obj.moderated_at || null,
    created_at: obj.createdAt,
    updated_at: obj.updatedAt,
    order: order ? { id: order._id || order.id, order_number: order.order_number } : null,
    user: user ? { id: user._id || user.id, name: user.name, email: user.email } : null,
    product: product ? { id: product._id || product.id, name: product.name, product_thumbnail: product.product_thumbnail_id || null } : null,
  };
}

const populateRefund = (q) =>
  q
    .populate({ path: 'order_id', select: 'order_number' })
    .populate({ path: 'consumer_id', select: 'name email' })
    .populate({ path: 'product_id', select: 'name product_thumbnail_id', populate: { path: 'product_thumbnail_id', select: 'original_url' } });

// Copia el estado de la solicitud a la línea del pedido.
async function syncOrderLine(refund, status) {
  const match = { _id: refund.order_id?._id || refund.order_id, 'products.product_id': refund.product_id?._id || refund.product_id };
  if (refund.variation_id) match['products.variation_id'] = refund.variation_id;
  await Order.updateOne(match, { $set: { 'products.$.refund_status': status } });
}

// GET /refund — administrador: todas (filtro ?status=); cliente: las suyas.
router.get('/', auth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.paginate) || 15, 100);
  const admin = isAdminUser(req.user);
  const filter = admin ? {} : { consumer_id: req.user._id };
  const status = parseRefundStatus(req.query.status);
  if (status) filter.status = status;
  const total = await Refund.countDocuments(filter);
  const refunds = await populateRefund(Refund.find(filter).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 }));
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data: refunds.map(normalizeRefund) });
});

// POST /refund — el cliente pide el reembolso de una línea de su pedido.
router.post('/', auth, publicFormLimiter, async (req, res) => {
  const { order_id, product_id, variation_id } = req.body || {};
  if (!isObjectId(String(order_id || '')) || !isObjectId(String(product_id || ''))) {
    return res.status(422).json({ message: 'Pedido o producto inválido' });
  }
  const input = validateRefundInput(req.body);
  if (!input.ok) return res.status(422).json({ message: input.message });

  const order = await Order.findById(order_id).populate('status_id');
  if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
  const ownerId = String(order.consumer_id?._id || order.consumer_id || '');
  if (!isAdminUser(req.user) && ownerId !== String(req.user._id)) return res.status(403).json({ message: 'No autorizado' });

  const line = findOrderLine(order, product_id, isObjectId(String(variation_id || '')) ? variation_id : null);
  const product = await Product.findById(product_id).select('name is_return');
  const eligibility = refundEligibility({ order, line, product });
  if (!eligibility.ok) return res.status(422).json({ message: eligibility.message });

  const refund = await Refund.create({
    order_id: order._id,
    product_id,
    variation_id: line.variation_id || null,
    consumer_id: order.consumer_id?._id || order.consumer_id,
    reason: input.values.reason,
    payment_type: input.values.payment_type,
    amount: refundableAmount(order, line),
    quantity: Number(line.quantity || 1),
    status: 'pending',
  });
  await syncOrderLine(refund, 'pending');
  res.status(201).json({ ...normalizeRefund(refund), message: 'Solicitud de reembolso enviada. Te avisaremos cuando sea revisada.' });
});

// PUT /refund/:id — administración: aprobar o rechazar.
router.put('/:id', auth, adminOnly, async (req, res) => {
  const status = parseRefundStatus(req.body?.status);
  if (!status) return res.status(422).json({ message: 'Estado inválido: usa pending, approved o rejected' });
  const refund = await Refund.findById(req.params.id);
  if (!refund) return res.status(404).json({ message: 'Solicitud no encontrada' });
  refund.status = status;
  refund.moderated_at = status === 'pending' ? null : new Date();
  if (typeof req.body.admin_note === 'string') refund.admin_note = req.body.admin_note.trim().slice(0, 1000);
  await refund.save();
  await syncOrderLine(refund, status);
  res.json({ ...normalizeRefund(refund), message: `Reembolso ${status}` });
});

module.exports = router;
