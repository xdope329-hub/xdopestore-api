/**
 * Reglas del ciclo de vida del pedido y del estado del pago. Módulo PURO
 * (sin modelos ni red): es la única fuente de verdad y se testea en
 * aislamiento (order-status-flow.unit.test.js).
 *
 * Dos conceptos independientes:
 *  - payment_status: la situación de la transacción (pending, completed,
 *    rejected, cancelled, refunded). La escribe SOLO la pasarela.
 *  - estado del pedido (OrderStatus.slug): el proceso logístico
 *    pending → processing → shipped → out_for_delivery → delivered.
 *    Lo avanza el administrador paso a paso; el único salto automático es
 *    pending → processing cuando el pago queda completado.
 */

const ORDER_FLOW = ['pending', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
const CANCELLED = 'cancelled';
// Solo se puede cancelar antes de que el pedido salga.
const CANCELLABLE_FROM = ['pending', 'processing'];

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

// Valores que quedaron en pedidos antiguos (seed, versiones previas).
const LEGACY_PAYMENT_ALIASES = { paid: 'completed', approved: 'completed', failed: 'rejected', success: 'completed' };

function normalizePaymentStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return PAYMENT_STATUS.PENDING;
  return LEGACY_PAYMENT_ALIASES[raw] || raw;
}

/** Estado de pago de la tienda a partir del estado crudo de Mercado Pago. */
function mapGatewayPaymentStatus(gatewayStatus) {
  switch (String(gatewayStatus || '').toLowerCase()) {
    case 'approved':
      return PAYMENT_STATUS.COMPLETED;
    case 'rejected':
      return PAYMENT_STATUS.REJECTED;
    case 'cancelled':
      return PAYMENT_STATUS.CANCELLED;
    case 'refunded':
    case 'charged_back':
      return PAYMENT_STATUS.REFUNDED;
    default:
      // pending, in_process, in_mediation, authorized, desconocidos…
      return PAYMENT_STATUS.PENDING;
  }
}

/**
 * Estado de pago resultante al recibir una notificación. Un pago ya
 * completado no vuelve a "pending" por una notificación tardía o repetida;
 * sí puede pasar a reembolsado (refunded) si la pasarela lo informa.
 */
function nextPaymentStatus(current, incoming) {
  const cur = normalizePaymentStatus(current);
  const inc = normalizePaymentStatus(incoming);
  if (cur === PAYMENT_STATUS.COMPLETED && inc === PAYMENT_STATUS.PENDING) return cur;
  return inc;
}

const isPaymentCompleted = (status) => normalizePaymentStatus(status) === PAYMENT_STATUS.COMPLETED;
const isPaymentFailed = (status) => [PAYMENT_STATUS.REJECTED, PAYMENT_STATUS.CANCELLED].includes(normalizePaymentStatus(status));

function nextOrderStatus(slug) {
  const idx = ORDER_FLOW.indexOf(slug);
  if (idx === -1 || idx === ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[idx + 1];
}

/** Estados a los que el administrador puede pasar el pedido desde `slug`. */
function allowedNextStatuses(slug) {
  const current = slug || 'pending';
  const next = nextOrderStatus(current);
  const out = next ? [next] : [];
  if (CANCELLABLE_FROM.includes(current)) out.push(CANCELLED);
  return out;
}

const canTransition = (from, to) => allowedNextStatuses(from).includes(to);

/** Único cambio automático: pago completado con el pedido aún en `pending`. */
const shouldAdvanceOnPayment = (currentSlug, paymentStatus) => isPaymentCompleted(paymentStatus) && (currentSlug || 'pending') === 'pending';

function transitionError(from, to) {
  const allowed = allowedNextStatuses(from);
  const options = allowed.length ? `Solo puede pasar a: ${allowed.join(', ')}.` : 'Este pedido ya no admite cambios de estado.';
  return `No se puede cambiar el pedido de "${from}" a "${to}". Los estados son secuenciales. ${options}`;
}

module.exports = {
  ORDER_FLOW,
  CANCELLED,
  CANCELLABLE_FROM,
  PAYMENT_STATUS,
  normalizePaymentStatus,
  mapGatewayPaymentStatus,
  nextPaymentStatus,
  isPaymentCompleted,
  isPaymentFailed,
  nextOrderStatus,
  allowedNextStatuses,
  canTransition,
  shouldAdvanceOnPayment,
  transitionError,
};
