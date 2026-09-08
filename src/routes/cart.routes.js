const router = require('express').Router();
const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const { findVariation, unitPrice, shapeCartVariation, CART_PRODUCT_POPULATE } = require('../utils/cartPricing');

// A cart line for a variable product stores only variation_id — resolve the
// full variant subdoc so the storefront can show its name/talla, price and
// the variation photo (the drawer showed the product thumbnail for every
// color because variation images were never populated here).
async function getCartResponse(userId) {
  const items = await Cart.find({ consumer_id: userId }).populate(CART_PRODUCT_POPULATE);

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
    obj.variation = shapeCartVariation(product, obj.variation_id);
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
  // Un id vacío o inválido (ficha de producto sin cargar) hacía fallar la
  // consulta con un CastError (500); es una petición inválida.
  if (!mongoose.Types.ObjectId.isValid(String(product_id || ''))) return res.status(422).json({ message: 'Producto inválido' });
  const product = await Product.findById(product_id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  // Cantidades enteras y positivas: una cantidad negativa o fraccionaria
  // bajaba el total y, al confirmarse el pedido, SUMABA stock.
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return res.status(422).json({ message: 'Cantidad inválida' });

  const chosenVariation = findVariation(product, variation_id);
  // Un producto con variantes se compra por variante: sin ella se cobraba
  // el precio "desde" del padre y se descontaba del contador del padre.
  if (Array.isArray(product.variations) && product.variations.length && !chosenVariation) {
    return res.status(422).json({ message: 'Elige talla y color' });
  }
  const price = unitPrice(product, chosenVariation);
  let existing = await Cart.findOne({ consumer_id: req.user._id, product_id, variation_id: variation_id || null });

  if (existing) {
    existing.quantity += qty;
    existing.sub_total = existing.quantity * price;
    await existing.save();
  } else {
    await Cart.create({
      consumer_id: req.user._id,
      product_id,
      variation_id: variation_id || null,
      quantity: qty,
      sub_total: qty * price,
    });
  }

  res.status(201).json(await getCartResponse(req.user._id));
});

// PUT /cart — update by product_id in body (from UI handleIncDec without item ID in URL)
router.put('/', auth, async (req, res) => {
  const { product_id, variation_id, quantity } = req.body;
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return res.status(422).json({ message: 'Cantidad inválida' });
  const product = await Product.findById(product_id);
  const price = unitPrice(product, findVariation(product, variation_id));
  const item = await Cart.findOne({ consumer_id: req.user._id, product_id, variation_id: variation_id || null });
  if (!item) return res.status(404).json({ message: 'Cart item not found' });
  item.quantity = qty;
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
  const qty = Number(req.body.quantity ?? item.quantity);
  if (!Number.isInteger(qty) || qty < 1) return res.status(422).json({ message: 'Cantidad inválida' });
  item.quantity = qty;
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
