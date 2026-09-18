const Product = require('../models/Product');

const idOf = (value) => String(value?._id || value?.id || value || '');

// Shared by account carts, guest checkout and cart synchronization. Child
// documents used for order snapshots always come from the database.
async function validateBundleSelections(product, rawSelections, { populate = false } = {}) {
  const items = Array.isArray(product.bundle_items) ? product.bundle_items : [];
  if (!items.length) return { ok: false, message: 'Bundle sin items configurados' };
  if (!Array.isArray(rawSelections)) return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
  // Matching posicional: un bundle puede repetir el mismo producto en varios
  // slots (con distintas allowed_variation_ids), así que no se puede indexar
  // por product_id — cada slot consume la selección de su misma posición.
  if (rawSelections.length !== items.length) {
    return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
  }
  const selections = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pid = idOf(item.product_id);
    const selected = rawSelections[i];
    if (!selected || idOf(selected.product_id) !== pid) return { ok: false, message: 'Elige las variantes de cada producto del bundle' };
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

// Match the entire composition positionally. `$all` es set-based, así que un
// bundle con el mismo producto repetido varias veces necesita comparación por
// posición para no colisionar con otras composiciones de igual tamaño.
function bundleCompositionFilter(selections) {
  const ordered = selections.map((selection) => ({
    product_id: idOf(selection.product_id),
    variation_id: selection.variation_id || null,
  }));
  return {
    $expr: {
      $eq: [
        { $map: { input: '$bundle_selections', as: 'sel', in: { product_id: { $toString: '$$sel.product_id' }, variation_id: { $cond: [{ $ifNull: ['$$sel.variation_id', false] }, { $toString: '$$sel.variation_id' }, null] } } } },
        ordered,
      ],
    },
  };
}

module.exports = { validateBundleSelections, bundleCompositionFilter };
