const router = require('express').Router();
const OrderStatus = require('../models/OrderStatus');
const Order = require('../models/Order');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { transitionOrder } = require('../services/orderTransitions');

router.get('/', async (req, res) => {
  const statuses = await OrderStatus.find().sort({ sequence: 1 });
  res.json({ data: statuses });
});

router.post('/', auth, adminOnly, async (req, res) => {
  const status = await OrderStatus.create(req.body);
  res.status(201).json(status);
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  // Can be used to update an order's status_id — con las MISMAS reglas de
  // secuencia que PUT /order/:id (services/orderTransitions.js).
  const { order_id, status_id } = req.body;
  if (order_id) {
    const found = await Order.findById(order_id);
    if (!found) return res.status(404).json({ message: 'Order not found' });
    const result = await transitionOrder(found, status_id);
    if (!result.ok) return res.status(result.status || 422).json({ message: result.message, allowed_next_statuses: result.allowed || [] });
    const order = await Order.findById(order_id).populate('status_id');
    return res.json(order);
  }
  const status = await OrderStatus.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(status);
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  await OrderStatus.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
