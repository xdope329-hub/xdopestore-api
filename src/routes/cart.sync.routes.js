const router = require('express').Router();
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const { findVariation, unitPrice } = require('../utils/cartPricing');

async function getCartItems(userId) {
  const items = await Cart.find({ consumer_id: userId }).populate({
    path: 'product_id',
    populate: { path: 'product_thumbnail_id', select: 'asset_url original_url' },
  });
  return items.map(i => {
    const obj = i.toJSON ? i.toJSON() : i;
    const product = obj.product_id || {};
    obj.product = { ...product, product_thumbnail: product.product_thumbnail_id || null, sale_price: product.sale_price || product.price };
    obj.product_id = product._id || product.id;
    obj.variation = findVariation(product, obj.variation_id);
    return obj;
  });
}

// POST /sync/cart — merge guest cart into server cart on login.
// Accepts the payload under either `cart` or `items` for client compatibility.
router.post('/sync/cart', auth, async (req, res) => {
  const payload = Array.isArray(req.body?.cart)
    ? req.body.cart
    : Array.isArray(req.body?.items)
      ? req.body.items
      : [];
  for (const item of payload) {
    const product = await Product.findById(item.product_id);
    if (!product) continue;
    const price = unitPrice(product, findVariation(product, item.variation_id));
    const existing = await Cart.findOne({ consumer_id: req.user._id, product_id: item.product_id, variation_id: item.variation_id || null });
    if (existing) {
      existing.quantity = Math.max(existing.quantity, item.quantity);
      existing.sub_total = existing.quantity * price;
      await existing.save();
    } else {
      await Cart.create({ consumer_id: req.user._id, product_id: item.product_id, variation_id: item.variation_id || null, quantity: item.quantity, sub_total: item.quantity * price });
    }
  }
  const items = await getCartItems(req.user._id);
  const total = items.reduce((s, i) => s + (i.sub_total || 0), 0);
  res.json({ items, total });
});

// POST /replace/cart  or  PUT /replace/cart — replace one variation with another
async function replaceCartHandler(req, res) {
  const { product_id, variation_id, quantity = 1, id } = req.body;
  const product = await Product.findById(product_id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  const price = unitPrice(product, findVariation(product, variation_id));

  // Remove old item if `id` provided
  if (id) await Cart.findByIdAndDelete(id);

  const existing = await Cart.findOne({ consumer_id: req.user._id, product_id, variation_id: variation_id || null });
  if (existing) {
    existing.quantity = Number(quantity);
    existing.sub_total = existing.quantity * price;
    await existing.save();
  } else {
    await Cart.create({ consumer_id: req.user._id, product_id, variation_id: variation_id || null, quantity: Number(quantity), sub_total: Number(quantity) * price });
  }

  const items = await getCartItems(req.user._id);
  const total = items.reduce((s, i) => s + (i.sub_total || 0), 0);
  res.json({ items, total });
}

router.post('/replace/cart', auth, replaceCartHandler);
router.put('/replace/cart', auth, replaceCartHandler);

// DELETE /clear/cart
router.delete('/clear/cart', auth, async (req, res) => {
  await Cart.deleteMany({ consumer_id: req.user._id });
  res.json({ message: 'Cart cleared', items: [], total: 0 });
});

module.exports = router;
