const Product = require('../models/Product');

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
      quantity: Math.max(1, Number(p.quantity) || 1),
    }))
    .filter((p) => p.product_id);
  if (!wanted.length) return [];

  const docs = await Product.find({ _id: { $in: wanted.map((p) => p.product_id) }, status: 1 });
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const items = [];
  for (const w of wanted) {
    const doc = byId.get(w.product_id);
    if (!doc) continue; // producto eliminado/inactivo — se omite
    let unit;
    if (w.variation_id && Array.isArray(doc.variations)) {
      const variation = doc.variations.find((v) => String(v._id || v.id) === w.variation_id);
      if (!variation) continue;
      unit = Number(variation.sale_price ?? variation.price ?? 0);
    } else {
      unit = Number(doc.sale_price || doc.price || 0);
    }
    items.push({ product_id: doc, variation_id: w.variation_id, quantity: w.quantity, sub_total: unit * w.quantity });
  }
  return items;
}

module.exports = { buildGuestCartItems };
