const router = require('express').Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const OrderStatus = require('../models/OrderStatus');
const auth = require('../middleware/auth');

function transformProduct(p) {
  const item = p.toJSON ? p.toJSON() : { ...p };
  const productDoc = item.product_id; // populated or ObjectId
  return {
    id: item._id,
    product_id: productDoc?._id || productDoc,
    variation_id: item.variation_id,
    name: item.name,
    product_thumbnail: productDoc?.product_thumbnail_id || null,
    is_return: productDoc?.is_return ?? 1,
    pivot: {
      single_price: item.price,
      quantity: item.quantity,
      subtotal: item.sub_total,
      variation: null,
      refund_status: item.refund_status || null,
    },
  };
}

function transformOrder(order) {
  const obj = order.toJSON ? order.toJSON() : order;
  obj.order_status = obj.status_id || null;
  obj.consumer = obj.consumer_id || null;
  obj.created_at = obj.createdAt;
  if (!obj.order_status_activities) obj.order_status_activities = [];
  if (!obj.sub_orders) obj.sub_orders = [];
  if (Array.isArray(obj.products)) {
    obj.products = order.products.map(transformProduct);
  }
  return obj;
}

// Returns a Mongoose Query (not yet executed) or null
function findOrderQuery(param) {
  const isObjectId = mongoose.Types.ObjectId.isValid(param) && String(new mongoose.Types.ObjectId(param)) === param;
  if (isObjectId) return Order.findById(param);
  const num = parseInt(param, 10);
  if (!isNaN(num)) return Order.findOne({ order_number: num });
  return null;
}

const populateDetail = [
  { path: 'consumer_id', select: 'name email phone' },
  { path: 'status_id' },
  { path: 'products.product_id', select: 'name product_thumbnail_id is_return', populate: { path: 'product_thumbnail_id', select: 'original_url' } },
];

// GET /order
router.get('/', auth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 10;
  const isAdmin = req.user.role?.name === 'admin';
  const filter = isAdmin ? {} : { consumer_id: req.user._id };
  if (req.query.status) filter.status_id = req.query.status;
  const total = await Order.countDocuments(filter);
  const data = await Order.find(filter)
    .skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 })
    .populate('consumer_id', 'name email phone')
    .populate('status_id');
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data: data.map(transformOrder) });
});

// POST /order — create new order
router.post('/', auth, async (req, res) => {
  if (req.body && req.body.order_status_id !== undefined) {
    return handleStatusUpdate(req, res);
  }

  const { billing_address, shipping_address, payment_method, coupon_total_discount = 0, shipping_total = 0, notes } = req.body;
  const cartItems = await Cart.find({ consumer_id: req.user._id }).populate('product_id');
  if (!cartItems.length) return res.status(422).json({ message: 'Cart is empty' });

  const products = cartItems.map(i => ({
    product_id: i.product_id._id,
    variation_id: i.variation_id,
    name: i.product_id.name,
    quantity: i.quantity,
    price: i.product_id.sale_price || i.product_id.price,
    sub_total: i.sub_total,
  }));

  const amount = cartItems.reduce((s, i) => s + i.sub_total, 0);
  const total = amount - coupon_total_discount + shipping_total;
  const pendingStatus = await OrderStatus.findOne({ slug: 'pending' });

  const order = await Order.create({
    consumer_id: req.user._id,
    products,
    billing_address,
    shipping_address,
    payment_method: payment_method || 'cod',
    payment_status: 'pending',
    amount,
    coupon_total_discount,
    shipping_total,
    total,
    status_id: pendingStatus?._id,
    notes,
  });

  await Cart.deleteMany({ consumer_id: req.user._id });
  const populated = await Order.findById(order._id).populate(populateDetail);

  const mail = require('../services/mail');
  mail
    .sendOrderConfirmation({ order: populated.toJSON(), consumer: populated.consumer_id })
    .catch(mail.logMailError('order-confirmation'));

  res.status(201).json(transformOrder(populated));
});

// GET /order/:id — supports MongoDB _id or order_number
router.get('/:id', auth, async (req, res) => {
  const q = findOrderQuery(req.params.id);
  if (!q) return res.status(404).json({ message: 'Order not found' });
  const order = await q.populate(populateDetail);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  const isAdmin = req.user.role?.name === 'admin';
  if (!isAdmin && order.consumer_id._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  res.json(transformOrder(order));
});

// PUT /order/:id — update order status (admin)
router.put('/:id', auth, async (req, res) => {
  await handleStatusUpdate(req, res);
});

// POST /order/:id — method-override from admin dashboard (sends _method:put)
router.post('/:id', auth, async (req, res) => {
  await handleStatusUpdate(req, res);
});

async function handleStatusUpdate(req, res) {
  const param = req.params.id;
  const { order_status_id, note, changed_at } = req.body;

  if (!param) return res.status(422).json({ message: 'Order ID required' });

  let statusId = order_status_id;
  if (typeof order_status_id === 'object' && order_status_id?.id) {
    statusId = order_status_id.id;
  }

  const q = findOrderQuery(param);
  if (!q) return res.status(404).json({ message: 'Order not found' });
  const found = await q;
  if (!found) return res.status(404).json({ message: 'Order not found' });

  const prevStatusId = String(found.status_id || '');

  const order = await Order.findByIdAndUpdate(
    found._id,
    { status_id: statusId },
    { new: true }
  ).populate(populateDetail);

  if (!order) return res.status(404).json({ message: 'Order not found' });

  if (String(order.status_id?._id || order.status_id || '') !== prevStatusId) {
    const mail = require('../services/mail');
    mail
      .sendOrderStatusUpdate({
        order: order.toJSON(),
        consumer: order.consumer_id,
        statusName: order.status_id?.name || 'updated',
      })
      .catch(mail.logMailError('order-status-update'));
  }

  res.json(transformOrder(order));
}

module.exports = router;
