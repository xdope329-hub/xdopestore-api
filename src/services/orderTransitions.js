/**
 * Cambios de estado de un pedido, con las reglas de utils/orderStatusFlow.js
 * aplicadas sobre los modelos. TODAS las rutas que tocan `status_id` o
 * `payment_status` pasan por aquí (order.routes, orderStatus.routes,
 * payment.routes): no hay otra forma de mover un pedido.
 */
const Order = require('../models/Order');
const OrderStatus = require('../models/OrderStatus');
const {
  allowedNextStatuses,
  canTransition,
  mapGatewayPaymentStatus,
  nextPaymentStatus,
  shouldAdvanceOnPayment,
  transitionError,
  isPaymentFailed,
  normalizePaymentStatus,
  PAYMENT_STATUS,
  CANCELLED,
} = require('../utils/orderStatusFlow');

const slugOf = (statusDoc) => statusDoc?.slug || 'pending';

/** Documentos OrderStatus a los que puede avanzar un pedido en `slug`. */
async function allowedNextStatusDocs(slug) {
  const slugs = allowedNextStatuses(slug);
  if (!slugs.length) return [];
  const docs = await OrderStatus.find({ slug: { $in: slugs } });
  return slugs.map((s) => docs.find((d) => d.slug === s)).filter(Boolean);
}

/**
 * Cambio MANUAL (administrador). Devuelve { ok, status, message, allowed }
 * cuando la transición no es secuencial; { ok: true, order, from, to }
 * cuando se aplicó; { ok: true, unchanged: true } si ya estaba en ese estado.
 */
async function transitionOrder(orderDoc, targetStatusId) {
  const target = targetStatusId ? await OrderStatus.findById(targetStatusId) : null;
  if (!target) return { ok: false, status: 422, message: 'Estado de pedido desconocido' };
  const current = orderDoc.status_id ? await OrderStatus.findById(orderDoc.status_id?._id || orderDoc.status_id) : null;
  const from = slugOf(current);
  if (String(current?._id || '') === String(target._id)) return { ok: true, unchanged: true, order: orderDoc, from, to: from };
  if (!canTransition(from, target.slug)) {
    return { ok: false, status: 422, message: transitionError(from, target.slug), allowed: allowedNextStatuses(from) };
  }
  const order = await Order.findByIdAndUpdate(orderDoc._id, { status_id: target._id }, { new: true });
  // Efectos del cambio de estado, en un solo sitio para TODAS las rutas
  // (PUT /order/:id y PUT /orderStatus/:id):
  //  - cancelar repone el stock que se hubiera descontado (utils/stock.js);
  //  - entregar un pedido contra entrega deja el pago como completado (se
  //    cobró al entregar): así suma en ingresos y admite reembolsos.
  if (target.slug === CANCELLED) {
    const { releaseStock } = require('../utils/stock');
    releaseStock(orderDoc._id).catch((err) => console.error('[stock] release failed', err?.message || err));
  }
  if (target.slug === 'delivered' && String(orderDoc.payment_method || '').toLowerCase() === 'cod' && normalizePaymentStatus(orderDoc.payment_status) !== PAYMENT_STATUS.COMPLETED) {
    await Order.updateOne({ _id: orderDoc._id }, { $set: { payment_status: PAYMENT_STATUS.COMPLETED, payment_completed_at: new Date() } });
    if (order) order.payment_status = PAYMENT_STATUS.COMPLETED;
  }
  return { ok: true, order, from, to: target.slug };
}

/**
 * Resultado de la pasarela (webhook o verificación). Actualiza SOLO el
 * estado del pago y, como único efecto sobre la logística, pasa el pedido a
 * `processing` si el pago quedó completado y el pedido seguía en `pending`.
 * Nunca retrocede un pedido ya enviado ni degrada un pago completado.
 * Idempotente: la misma notificación repetida no cambia nada.
 */
async function applyPaymentResult(orderId, { transactionId, status, gatewayResponse } = {}) {
  const order = await Order.findById(orderId).populate('status_id');
  if (!order) return null;

  const paymentStatus = nextPaymentStatus(order.payment_status, mapGatewayPaymentStatus(status));
  const update = {
    payment_status: paymentStatus,
    payment_gateway_status: status ? String(status) : order.payment_gateway_status || null,
  };
  if (transactionId) update.payment_transaction_id = String(transactionId);
  if (gatewayResponse !== undefined) update.payment_gateway_response = gatewayResponse;
  if (paymentStatus === 'completed' && !order.payment_completed_at) update.payment_completed_at = new Date();
  if (isPaymentFailed(paymentStatus)) update.payment_error = `Pago ${status} por la pasarela`;

  const advanced = shouldAdvanceOnPayment(slugOf(order.status_id), paymentStatus);
  if (advanced) {
    const processing = await OrderStatus.findOne({ slug: 'processing' });
    if (processing) update.status_id = processing._id;
  }

  // Escritura condicional: si otra notificación (webhook y verify a la vez,
  // o el mismo webhook repetido) ya cambió el pago o el estado, esta no
  // aplica nada y no repite efectos (stock, correo). Los pedidos antiguos
  // pueden no tener payment_status: null casa con el campo ausente.
  const guard = { _id: orderId, payment_status: order.payment_status ?? null };
  if (advanced) guard.status_id = order.status_id?._id || order.status_id || null;
  const written = await Order.findOneAndUpdate(guard, update, { new: false });
  if (!written) return { order, paymentStatus: order.payment_status, advanced: false, update: {}, raced: true };
  if (paymentStatus === PAYMENT_STATUS.COMPLETED && slugOf(order.status_id) === CANCELLED) {
    console.warn(`[payment] pago aprobado para el pedido CANCELADO #${order.order_number || orderId}: revisar y reembolsar`);
  }
  return { order, paymentStatus, advanced, update };
}

module.exports = { transitionOrder, applyPaymentResult, allowedNextStatusDocs };
