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
  const items = await Cart.find({ consumer_id: userId }).populate([
    CART_PRODUCT_POPULATE,
    { path: 'bundle_selections.product_id', select: 'name slug product_thumbnail_id variations', populate: { path: 'product_thumbnail_id', select: 'asset_url original_url' } },
  ]);

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
    // Bundle: adjunta el nombre y variante elegida para cada item del bundle
    // (el detalle de carrito/checkout muestra la composición).
    if (Array.isArray(obj.bundle_selections) && obj.bundle_selections.length) {
      obj.bundle_selections = obj.bundle_selections.map((sel) => {
        const childDoc = sel.product_id && typeof sel.product_id === 'object' ? sel.product_id : null;
        const variation = childDoc && sel.variation_id ? (childDoc.variations || []).find((v) => String(v._id || v.id) === String(sel.variation_id)) : null;
        return {
          product_id: childDoc?._id || childDoc?.id || sel.product_id,
          product: childDoc ? { id: childDoc._id, name: childDoc.name, slug: childDoc.slug, product_thumbnail: childDoc.product_thumbnail_id || null } : null,
          variation_id: sel.variation_id || null,
          variation: variation ? { id: variation._id || variation.id, name: variation.name, attribute_values: variation.attribute_values || [] } : null,
        };
      });
    }
    return obj;
  });

  const total = shaped.reduce((s, i) => s + (i.sub_total || 0), 0);
  return { items: shaped, total };
}

// GET /cart
router.get('/', auth, async (req, res) => {
  res.json(await getCartResponse(req.user._id));
});

// Bundle: valida que las selecciones cubran todos los items del bundle y que
// cada variante pertenezca al subset permitido en el admin. Devuelve las
// selecciones saneadas ({ ok, selections } | { ok: false, message }).
async function validateBundleSelections(product, rawSelections) {
  const items = Array.isArray(product.bundle_items) ? product.bundle_items : [];
  if (!items.length) return { ok: false, message: 'Bundle sin items configurados' };
  const byPid = new Map();
  (rawSelections || []).forEach((sel) => {
    const pid = String(sel?.product_id ?? '');
    if (pid) byPid.set(pid, sel);
  });
  const out = [];
  for (const it of items) {
    const pid = String(it.product_id);
    const sel = byPid.get(pid);
    if (!sel) return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
    const child = await Product.findById(pid);
    if (!child) return { ok: false, message: 'Producto del bundle no disponible' };
    const hasVariants = Array.isArray(child.variations) && child.variations.length > 0;
    let variationId = sel.variation_id ? String(sel.variation_id) : null;
    if (hasVariants) {
      if (!variationId) return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
      const variation = child.variations.find((v) => String(v._id) === variationId);
      if (!variation) return { ok: false, message: 'Variante inválida en el bundle' };
      const allowed = Array.isArray(it.allowed_variation_ids) ? it.allowed_variation_ids.map(String) : [];
      if (allowed.length && !allowed.includes(variationId)) {
        return { ok: false, message: 'Variante no permitida para este bundle' };
      }
    } else {
      variationId = null;
    }
    out.push({ product_id: pid, variation_id: variationId });
  }
  return { ok: true, selections: out };
}

// POST /cart — add item or update quantity (with _method:put)
router.post('/', auth, async (req, res) => {
  const { product_id, variation_id, quantity = 1, bundle_selections } = req.body;
  // Un id vacío o inválido (ficha de producto sin cargar) hacía fallar la
  // consulta con un CastError (500); es una petición inválida.
  if (!mongoose.Types.ObjectId.isValid(String(product_id || ''))) return res.status(422).json({ message: 'Producto inválido' });
  const product = await Product.findById(product_id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  // Cantidades enteras y positivas: una cantidad negativa o fraccionaria
  // bajaba el total y, al confirmarse el pedido, SUMABA stock.
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return res.status(422).json({ message: 'Cantidad inválida' });

  const isBundle = product.type === 'bundle';
  let bundleSelections = [];
  if (isBundle) {
    const check = await validateBundleSelections(product, bundle_selections);
    if (!check.ok) return res.status(422).json({ message: check.message });
    bundleSelections = check.selections;
  }

  const chosenVariation = isBundle ? null : findVariation(product, variation_id);
  // Un producto con variantes se compra por variante: sin ella se cobraba
  // el precio "desde" del padre y se descontaba del contador del padre.
  if (!isBundle && Array.isArray(product.variations) && product.variations.length && !chosenVariation) {
    return res.status(422).json({ message: 'Elige talla y color' });
  }
  const price = unitPrice(product, chosenVariation);
  // Cada combinación de bundle_selections es un item distinto en el carrito.
  const bundleKey = isBundle
    ? bundleSelections.map((s) => `${s.product_id}:${s.variation_id || ''}`).sort().join('|')
    : null;
  let existing = await Cart.findOne({ consumer_id: req.user._id, product_id, variation_id: isBundle ? null : (variation_id || null) });
  if (existing && isBundle) {
    const existingKey = (existing.bundle_selections || []).map((s) => `${s.product_id}:${s.variation_id || ''}`).sort().join('|');
    if (existingKey !== bundleKey) existing = null;
  }

  if (existing) {
    existing.quantity += qty;
    existing.sub_total = existing.quantity * price;
    await existing.save();
  } else {
    await Cart.create({
      consumer_id: req.user._id,
      product_id,
      variation_id: isBundle ? null : (variation_id || null),
      bundle_selections: bundleSelections,
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
