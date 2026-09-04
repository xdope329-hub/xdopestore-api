/**
 * Reglas de las solicitudes de reembolso. Módulo PURO (sin modelos ni red)
 * para testearlo en aislamiento (refund.test.js).
 *
 * Un cliente puede pedir el reembolso de una línea de su pedido cuando:
 *  - el pedido está ENTREGADO y el pago está completado;
 *  - el producto está marcado como "admite devolución" (is_return) en el
 *    admin, tal como estaba al momento de pedir el reembolso;
 *  - la línea no tiene ya una solicitud (pendiente, aprobada o rechazada).
 */

const { isPaymentCompleted } = require('./orderStatusFlow');

const REFUND_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
const MAX_REASON_LENGTH = 1000;

const str = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : v === null || v === undefined ? '' : String(v));

/** 'approved' | 'rejected' | 'pending' (cualquier mayúscula) → slug; otro → null. */
function parseRefundStatus(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  return REFUND_STATUSES.includes(slug) ? slug : null;
}

/** Línea del pedido que coincide con el producto (y la variante si se indica). */
function findOrderLine(order, productId, variationId) {
  const lines = Array.isArray(order?.products) ? order.products : [];
  const wantedProduct = str(productId);
  const wantedVariation = str(variationId);
  return (
    lines.find((line) => str(line.product_id) === wantedProduct && (!wantedVariation || str(line.variation_id) === wantedVariation)) ||
    null
  );
}

/** Validación de lo que envía el cliente. */
function validateRefundInput(body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return { ok: false, message: 'Indica el motivo del reembolso' };
  if (reason.length > MAX_REASON_LENGTH) return { ok: false, message: `El motivo no puede superar ${MAX_REASON_LENGTH} caracteres` };
  const paymentType = typeof body.payment_type === 'string' && body.payment_type.trim() ? body.payment_type.trim().toLowerCase() : 'original';
  return { ok: true, values: { reason, payment_type: paymentType } };
}

/**
 * ¿Puede pedirse el reembolso de esta línea? `order.status_id` debe venir
 * poblado (slug). Devuelve { ok, message }.
 */
function refundEligibility({ order, line, product } = {}) {
  if (!order) return { ok: false, message: 'Pedido no encontrado' };
  const slug = order.status_id?.slug || order.order_status?.slug || null;
  if (slug !== 'delivered') return { ok: false, message: 'Solo se puede solicitar el reembolso de un pedido entregado' };
  if (!isPaymentCompleted(order.payment_status)) return { ok: false, message: 'El pedido no tiene el pago completado' };
  if (!line) return { ok: false, message: 'El producto no pertenece a este pedido' };
  if (product && !Number(product.is_return ?? 0)) return { ok: false, message: 'Este producto no admite devolución' };
  if (line.refund_status) return { ok: false, message: 'Ya existe una solicitud de reembolso para este producto' };
  return { ok: true };
}

module.exports = { REFUND_STATUSES, MAX_REASON_LENGTH, parseRefundStatus, findOrderLine, validateRefundInput, refundEligibility };
