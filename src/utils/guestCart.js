const Product = require('../models/Product');
const { findVariation, unitPrice } = require('./cartPricing');
const { validateBundleSelections } = require('./bundleSelections');

/**
 * Reconstruye el carrito de un invitado EN EL SERVIDOR a partir de
 * [{ product_id, variation_id, quantity }]. Los precios se toman SIEMPRE de
 * la base de datos — nunca del cliente — para que un invitado no pueda
 * manipular el total.
 *
 * Devuelve ítems con la misma forma mínima que el carrito de usuarios
 * ({ product_id: <doc>, variation_id, quantity, sub_total }) para reusar la
 * lógica de totales y creación de orden.
 */
async function buildGuestCartItems(rawProducts) {
  const wanted = (Array.isArray(rawProducts) ? rawProducts : [])
    .map((p) => ({
      product_id: String(p.product_id || p.product?.id || p.product?._id || ''),
      variation_id: p.variation_id ? String(p.variation_id) : null,
      quantity: Math.max(1, Math.floor(Number(p.quantity) || 1)),
      bundle_selections: p.bundle_selections,
    }))
    .filter((p) => p.product_id);
  if (!wanted.length) return [];

  const docs = await Product.find({ _id: { $in: wanted.map((p) => p.product_id) }, status: 1 });
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const items = [];
  for (const w of wanted) {
    const doc = byId.get(w.product_id);
    if (!doc) continue; // producto eliminado/inactivo — se omite
    if (doc.type === 'bundle') {
      const check = await validateBundleSelections(doc, w.bundle_selections, { populate: true });
      if (!check.ok) throw Object.assign(new Error(check.message), { status: 422 });
      items.push({ product_id: doc, variation_id: null, bundle_selections: check.selections, quantity: w.quantity, sub_total: Math.round(unitPrice(doc, null) * w.quantity) });
      continue;
    }
    const variation = w.variation_id ? findVariation(doc, w.variation_id) : null;
    if (w.variation_id && !variation) continue;
    // Mismo precio que el carrito de usuarios (utils/cartPricing.js): un
    // sale_price 0 o null cobra el precio normal, nunca $0.
    const unit = unitPrice(doc, variation);
    items.push({ product_id: doc, variation_id: w.variation_id, quantity: w.quantity, sub_total: Math.round(unit * w.quantity) });
  }
  return items;
}

module.exports = { buildGuestCartItems };
