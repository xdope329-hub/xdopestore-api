/**
 * Reglas de moderación de reseñas. Módulo PURO (sin modelos ni red) para
 * testearlo en aislamiento (review-moderation.unit.test.js).
 *
 * Ciclo de vida de una reseña:
 *   pending (0) → approved (1) | rejected (2)
 * La crea el cliente en `pending`; solo el administrador la aprueba o
 * rechaza. Si el cliente edita una reseña ya moderada vuelve a `pending`.
 * Solo las aprobadas cuentan para el promedio y se muestran en la tienda.
 */

const REVIEW_STATUS = Object.freeze({ PENDING: 0, APPROVED: 1, REJECTED: 2 });

const SLUG_BY_STATUS = Object.freeze({ 0: 'pending', 1: 'approved', 2: 'rejected' });
const STATUS_BY_SLUG = Object.freeze({ pending: 0, approved: 1, rejected: 2 });

const MAX_DESCRIPTION_LENGTH = 2000;

/** 'approved' | 1 | '1' → 1; cualquier otra cosa → null. */
function parseModerationStatus(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const slug = value.trim().toLowerCase();
    if (slug in STATUS_BY_SLUG) return STATUS_BY_SLUG[slug];
    if (!/^\d+$/.test(slug)) return null;
    value = Number(slug);
  }
  if (typeof value === 'boolean') return value ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED;
  return Number.isInteger(value) && value in SLUG_BY_STATUS ? value : null;
}

const statusSlug = (status) => SLUG_BY_STATUS[Number(status)] || 'pending';
const isPublished = (status) => Number(status) === REVIEW_STATUS.APPROVED;

/**
 * Valida lo que el cliente puede enviar. `partial` (edición) permite omitir
 * campos; en creación la calificación es obligatoria.
 * Devuelve { ok, message, values } con los valores ya normalizados.
 */
function validateReviewInput(body = {}, { partial = false } = {}) {
  const values = {};

  if (body.rating === undefined || body.rating === null || body.rating === '') {
    if (!partial) return { ok: false, message: 'La calificación es obligatoria (1 a 5 estrellas)' };
  } else {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, message: 'La calificación debe ser un número entero entre 1 y 5' };
    }
    values.rating = rating;
  }

  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') return { ok: false, message: 'La opinión debe ser texto' };
    const description = body.description.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return { ok: false, message: `La opinión no puede superar ${MAX_DESCRIPTION_LENGTH} caracteres` };
    }
    values.description = description;
  }

  return { ok: true, values };
}

/**
 * Productos de pedidos ENTREGADOS que el cliente aún no ha reseñado.
 * `orders` llegan con `products[].product_id` poblado (o como id suelto);
 * `reviews` son las reseñas del cliente (cualquier estado). Un producto que
 * aparece en varios pedidos se lista una sola vez (el pedido más reciente).
 */
function pendingReviewItems(orders = [], reviews = []) {
  const reviewed = new Set(reviews.map((r) => String(r.product_id?._id || r.product_id)));
  const seen = new Set();
  const items = [];
  for (const order of orders) {
    for (const line of order.products || []) {
      const product = line.product_id && typeof line.product_id === 'object' ? line.product_id : null;
      const productId = String(product?._id || line.product_id || '');
      if (!productId || reviewed.has(productId) || seen.has(productId)) continue;
      seen.add(productId);
      items.push({
        order_id: order._id,
        order_number: order.order_number,
        product: {
          id: productId,
          name: product?.name || line.name || '',
          slug: product?.slug || null,
          product_thumbnail: product?.product_thumbnail_id || null,
        },
      });
    }
  }
  return items;
}

module.exports = {
  REVIEW_STATUS,
  MAX_DESCRIPTION_LENGTH,
  parseModerationStatus,
  statusSlug,
  isPublished,
  validateReviewInput,
  pendingReviewItems,
};
