/**
 * Purchase idempotente. Se llama desde:
 *  - /payment/initialize (COD: pedido queda confirmado al crearse)
 *  - onPaymentConfirmed  (Mercado Pago: payment_status paso a `completed`)
 *
 * Idempotencia: se marca `meta_purchase_sent_at` con una escritura condicional
 * (findOneAndUpdate + guard). Un webhook repetido, una segunda notificacion o
 * un race entre webhook+verify no genera dos Purchase. `event_id` estable
 * (`purchase_<orderId>`) permite ademas que Meta deduplique si el browser
 * dispara Purchase con el mismo id.
 */
const Order = require('../../models/Order');
const { sendEvents } = require('./capiClient');
const { getConfig } = require('./config');
const { buildUserData } = require('./userData');
const { purchaseEventId } = require('./eventId');

function buildContents(order) {
  const products = Array.isArray(order?.products) ? order.products : [];
  return products.map((p) => ({
    id: String(p.variation_id || p.product_id || p.sku || ''),
    quantity: Number(p.quantity) || 1,
    item_price: Number(p.price) || 0,
  })).filter((c) => c.id);
}

function buildContentIds(order) {
  return buildContents(order).map((c) => c.id);
}

function buildPurchaseEvent(order, account) {
  const cfg = getConfig();
  const contents = buildContents(order);
  const numItems = contents.reduce((s, c) => s + c.quantity, 0);
  return {
    event_name: 'Purchase',
    event_time: Math.floor((order.payment_completed_at || order.createdAt || new Date()).getTime() / 1000),
    event_id: purchaseEventId(order._id),
    event_source_url: order.meta_event_source_url || undefined,
    action_source: 'website',
    user_data: buildUserData(order, account),
    custom_data: {
      currency: cfg.currency,
      value: Number(order.total) || 0,
      content_ids: buildContentIds(order),
      contents,
      content_type: 'product',
      num_items: numItems,
      order_id: String(order._id),
    },
  };
}

/**
 * Envia Purchase para `orderId` si aun no se envio. Idempotente y no bloquea:
 * cualquier error se registra pero jamas se propaga.
 */
async function maybeSendPurchase(orderId) {
  const cfg = getConfig();
  if (!cfg.enabled) return { skipped: 'meta_disabled' };
  try {
    // Guard atomico: la primera llamada marca el timestamp y sigue; las
    // siguientes ven `meta_purchase_sent_at` seteado y salen sin enviar.
    const claimed = await Order.findOneAndUpdate(
      { _id: orderId, meta_purchase_sent_at: null },
      { $set: { meta_purchase_sent_at: new Date() } },
      { new: true },
    ).populate([{ path: 'consumer_id', select: 'name email' }]);
    if (!claimed) return { skipped: 'already_sent' };

    const account = claimed.consumer_id && typeof claimed.consumer_id === 'object'
      ? { name: claimed.consumer_id.name, email: claimed.consumer_id.email }
      : null;
    const event = buildPurchaseEvent(claimed, account);
    const result = await sendEvents([event]);
    if (!result.ok) {
      // Rollback del guard: si Meta rechazo, dejamos la puerta abierta para
      // un reintento manual/futuro webhook. NO reintentamos aqui: Meta puede
      // rechazar por token invalido y no queremos bombardear.
      await Order.updateOne({ _id: orderId }, { $set: { meta_purchase_sent_at: null } });
      return { ok: false, error: result };
    }
    return { ok: true, event_id: event.event_id };
  } catch (err) {
    console.error('[Meta CAPI] maybeSendPurchase failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

module.exports = { maybeSendPurchase, buildPurchaseEvent, buildContents, buildContentIds };
