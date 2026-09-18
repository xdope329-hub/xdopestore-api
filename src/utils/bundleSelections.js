const Product = require('../models/Product');

const idOf = (value) => String(value?._id || value?.id || value || '');

// Shared by account carts, guest checkout and cart synchronization. Child
// documents used for order snapshots always come from the database.
async function validateBundleSelections(product, rawSelections, { populate = false } = {}) {
  const items = Array.isArray(product.bundle_items) ? product.bundle_items : [];
  if (!items.length) return { ok: false, message: 'Bundle sin items configurados' };
  if (!Array.isArray(rawSelections)) return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
  const byPid = new Map(rawSelections.map((selection) => [idOf(selection?.product_id), selection]));
  if (byPid.size !== rawSelections.length || byPid.size !== items.length) {
    return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
  }
  const selections = [];
  for (const item of items) {
    const pid = idOf(item.product_id);
    const selected = byPid.get(pid);
    if (!selected) return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
    const child = await Product.findById(pid);
    if (!child || [false, 0, '0'].includes(child.status)) return { ok: false, message: 'Producto del bundle no disponible' };
    const variations = Array.isArray(child.variations) ? child.variations : [];
    let variationId = selected.variation_id ? idOf(selected.variation_id) : null;
    if (variations.length) {
      if (!variationId) return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
      const variation = variations.find((candidate) => idOf(candidate) === variationId);
      if (!variation || [false, 0, '0'].includes(variation.status)) return { ok: false, message: 'Variante inválida en el bundle' };
      const allowed = (item.allowed_variation_ids || []).map(idOf);
      if (allowed.length && !allowed.includes(variationId)) return { ok: false, message: 'Variante no permitida para este bundle' };
    } else {
      variationId = null;
    }
    selections.push({ product_id: populate ? child : pid, variation_id: variationId });
  }
  return { ok: true, selections };
}

// Match the entire composition, regardless of the order in which it was sent.
// Different sizes for the same bundle must remain distinct cart lines.
function bundleCompositionFilter(selections) {
  return { bundle_selections: {
    $size: selections.length,
    $all: selections.map((selection) => ({ $elemMatch: { product_id: idOf(selection.product_id), variation_id: selection.variation_id || null } })),
  } };
}

module.exports = { validateBundleSelections, bundleCompositionFilter };
