/**
 * Instantánea de la variante comprada en cada línea del pedido: atributos
 * (Color, Talla…) y SKU, tomados al crear el pedido para que el detalle
 * siga siendo fiel aunque el producto cambie después. Módulo puro; para
 * pedidos antiguos sin instantánea se resuelve desde el producto.
 */

const findVariation = (product, variationId) => {
  if (!product || !variationId || !Array.isArray(product.variations)) return null;
  const wanted = String(variationId);
  return product.variations.find((v) => String(v._id || v.id) === wanted) || null;
};

const attributesOf = (variation) =>
  (variation?.attribute_values || [])
    .filter((av) => av && av.value)
    .map((av) => ({ name: av.name || av.attribute_name || '', value: String(av.value) }));

/** Datos a guardar en la línea del pedido al crearlo. */
function buildOrderLineSnapshot(product, variation) {
  const attributes = attributesOf(variation);
  return {
    variation_name: variation ? variation.name || attributes.map((a) => a.value).join('/') || null : null,
    sku: variation?.sku || product?.sku || null,
    variation_attributes: attributes,
  };
}

/**
 * Atributos y SKU de una línea ya guardada. Usa la instantánea si existe;
 * si no (pedidos anteriores a este campo), los reconstruye desde la
 * variante del producto poblado.
 */
function describeOrderLine(item, product) {
  const stored = Array.isArray(item?.variation_attributes) ? item.variation_attributes.filter((a) => a && a.value) : [];
  if (stored.length || item?.sku) {
    return { variation_name: item.variation_name || null, sku: item.sku || null, variation_attributes: stored };
  }
  const variation = findVariation(product, item?.variation_id);
  const fallback = buildOrderLineSnapshot(product, variation);
  return { ...fallback, variation_name: item?.variation_name || fallback.variation_name };
}

module.exports = { buildOrderLineSnapshot, describeOrderLine, findVariation };
