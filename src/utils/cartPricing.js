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

// Populate spec shared by every cart serializer: the thumbnail for the
// product line and the variation images so the storefront can show the
// photo of the chosen color/size (not just the product thumbnail).
const CART_PRODUCT_POPULATE = {
  path: 'product_id',
  populate: [
    { path: 'product_thumbnail_id', select: 'asset_url original_url' },
    { path: 'variations.variation_images', select: 'asset_url original_url' },
  ],
};

// Populated attachment usable as an image (never a bare ObjectId).
const usableImage = (image) => (image && typeof image === 'object' && image.original_url ? image : null);

/**
 * Variant subdoc for a cart line with the storefront aliases the product
 * endpoints also expose: `variation_image` (first populated image, or null)
 * and `variation_galleries`. null when the line has no variation.
 */
function shapeCartVariation(product, variationId) {
  const variation = findVariation(product, variationId);
  if (!variation) return null;
  const images = (Array.isArray(variation.variation_images) ? variation.variation_images : []).map(usableImage).filter(Boolean);
  return { ...variation, variation_galleries: images, variation_image: images[0] || null };
}

/**
 * Reglas de una línea de carrito: cantidad entera ≥ 1 y, si el producto
 * tiene variantes, una variante existente. Devuelve { ok, variation, qty }
 * o { ok: false, message }. Las usan POST /cart y la sincronización del
 * carrito de invitado al iniciar sesión (cart.sync.routes.js).
 */
function validateCartLine(product, variationId, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, message: 'Cantidad inválida' };
  const variation = findVariation(product, variationId);
  if (Array.isArray(product?.variations) && product.variations.length && !variation) {
    return { ok: false, message: 'Elige talla y color' };
  }
  return { ok: true, variation, qty };
}

module.exports = { findVariation, unitPrice, shapeCartVariation, validateCartLine, CART_PRODUCT_POPULATE };
