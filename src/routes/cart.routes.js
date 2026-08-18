const router = require('express').Router();
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const { findVariation, unitPrice } = require('../utils/cartPricing');

// A cart line for a variable product stores only variation_id — resolve the
// full variant subdoc so the storefront can show its name/talla and price.
async function getCartResponse(userId) {
  const items = await Cart.find({ consumer_id: userId })
    .populate({
      path: 'product_id',
      populate: { path: 'product_thumbnail_id', select: 'asset_url original_url' },
    });

  const shaped = items.map(i => {
    const obj = i.toJSON ? i.toJSON() : i;
    const product = obj.product_id || {};
    obj.product = {
      ...product,
      product_thumbnail: product.product_thumbnail_id || null,
      sale_price: product.sale_price || product.price,
    };
    obj.product_id = product._id || product.id;
    // Expose the chosen variant (name, attribute_values, prices) so the UI
    // can render "Talla: S" and charge the variant's price.
    obj.variation = findVariation(product, obj.variation_id);
    return obj;
  });

  const total = shaped.reduce((s, i) => s + (i.sub_total || 0), 0);
  return { items: shaped, total };
}

// GET /cart
router.get('/', auth, async (req, res) => {
  res.json(await getCartResponse(req.user._id));
});

// POST /cart — add item or update quantity (with _method:put)
router.post('/', auth, async (req, res) => {
  const { product_id, variation_id, quantity = 1, id } = req.body;
  const product = await Product.findById(product_id);
  if (!product) return res.status(404).json({ message: 'Product not found' });

  const chosenVariation = findVariation(product, variation_id);
  const price = unitPrice(product, chosenVariation);
  let existing = await Cart.findOne({ consumer_id: req.user._id, product_id, variation_id: variation_id || null });

  if (existing) {
    existing.quantity += Number(quantity);
    existing.sub_total = existing.quantity * price;
    await existing.save();
  } else {
    await Cart.create({
      consumer_id: req.user._id,
      product_id,
      variation_id: variation_id || null,
      quantity: Number(quantity),
      sub_total: Number(quantity) * price,
    });
  }

  res.status(201).json(await getCartResponse(req.user._id));
});

// PUT /cart — update by product_id in body (from UI handleIncDec without item ID in URL)
router.put('/', auth, async (req, res) => {
  const { product_id, variation_id, quantity } = req.body;
  const product = await Product.findById(product_id);
  const price = unitPrice(product, findVariation(product, variation_id));
  const item = await Cart.findOne({ consumer_id: req.user._id, product_id, variation_id: variation_id || null });
  if (!item) return res.status(404).json({ message: 'Cart item not found' });
  item.quantity = Number(quantity);
  item.sub_total = item.quantity * price;
  await item.save();
  res.json(await getCartResponse(req.user._id));
});

// PUT /cart/:id — update by cart item ID
router.put('/:id', auth, async (req, res) => {
  const item = await Cart.findOne({ _id: req.params.id, consumer_id: req.user._id });
  if (!item) return res.status(404).json({ message: 'Cart item not found' });
  const product = await Product.findById(item.product_id);
  const price = unitPrice(product, findVariation(product, item.variation_id));
  item.quantity = Number(req.body.quantity ?? item.quantity);
  item.sub_total = item.quantity * price;
  await item.save();
  res.json(await getCartResponse(req.user._id));
});

// DELETE /cart/:id
router.delete('/:id', auth, async (req, res) => {
  await Cart.findOneAndDelete({ _id: req.params.id, consumer_id: req.user._id });
  res.json(await getCartResponse(req.user._id));
});

// exposed for unit tests
router.findVariation = findVariation;
router.unitPrice = unitPrice;

module.exports = router;
