function findVariation(product, variationId) {
  if (!product || !variationId || !Array.isArray(product.variations)) return null;
  const wanted = String(variationId);
  return product.variations.find((variation) => String(variation._id || variation.id) === wanted) || null;
}

function unitPrice(product, variation) {
  if (variation) {
    return Number(variation.sale_price ?? variation.price) || Number(variation.price) || 0;
  }

  return Number(product?.sale_price ?? product?.price) || Number(product?.price) || 0;
}

module.exports = { findVariation, unitPrice };
