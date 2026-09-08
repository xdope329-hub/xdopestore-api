// High-level mail dispatchers. Each helper is fire-and-forget safe: callers
// use `.catch(logMailError)` so a Brevo outage never breaks the business flow.
//
// Cuándo escribe la tienda al cliente (routes/payment.routes.js y
// routes/order.routes.js deciden; utils/orderStatusFlow.js → isPaymentConfirmed):
//  - contra entrega: confirmación al crear el pedido y avisos de estado;
//  - pasarela (Mercado Pago): NADA hasta que el pago queda confirmado; en
//    ese momento la confirmación (`paymentConfirmed`) y luego los avisos.
const brevo = require('./brevo');

const STORE_NAME = () => process.env.BREVO_SENDER_NAME || 'xDope Store';
const STORE_URL = () => process.env.STORE_URL || 'http://localhost:3000';

function logMailError(context) {
  return (err) => {
    if (err && err.code === 'BREVO_NOT_CONFIGURED') {
      console.warn(`[mail:${context}] skipped — BREVO_API_KEY not set`);
      return;
    }
    console.error(`[mail:${context}] failed`, err?.message || err, err?.details || '');
  };
}

// ────────────────────────────── Templates ──────────────────────────────
function wrapHtml(bodyHtml) {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f6f6f6;padding:24px;color:#212121;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#888;margin:0;">${STORE_NAME()} &middot; <a href="${STORE_URL()}" style="color:#888;">${STORE_URL()}</a></p>
  </div></body></html>`;
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ────────────────────────────── Password reset ──────────────────────────────
async function sendPasswordResetOTP({ email, name, otp }) {
  const subject = `${STORE_NAME()}: Your password reset code`;
  const html = wrapHtml(`
    <h2 style="margin-top:0;">Password reset</h2>
    <p>Hi${name ? ` ${name}` : ''},</p>
    <p>Use the code below to reset your password. It expires in <strong>15 minutes</strong>.</p>
    <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;background:#f2f2f2;padding:16px;border-radius:6px;">${otp}</p>
    <p style="color:#666;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
  `);
  const text = `Your ${STORE_NAME()} password reset code is: ${otp}\nThis code expires in 15 minutes.`;
  return brevo.sendTransactionalEmail({ to: { email, name }, subject, htmlContent: html, textContent: text });
}

// ────────────────────────────── Test email ──────────────────────────────
async function sendTestEmail({ to }) {
  const subject = `${STORE_NAME()}: Test email`;
  const html = wrapHtml(`
    <h2 style="margin-top:0;">Brevo is connected ✅</h2>
    <p>This is a test email sent from your admin panel.</p>
    <p>If you're reading this, transactional email is working.</p>
  `);
  return brevo.sendTransactionalEmail({ to, subject, htmlContent: html, textContent: 'Brevo test email — connection OK.' });
}

// ────────────────────────────── Pedidos ──────────────────────────────
// Los correos de pedido llegan al cliente con cuenta Y al invitado: el
// invitado no tiene usuario, así que el destinatario sale de guest_name /
// guest_email guardados en el pedido. Antes sin cuenta no se enviaba nada.
function orderRecipient(order, consumer) {
  const email = consumer?.email || order?.guest_email;
  if (!email) return null;
  return { email, name: consumer?.name || order?.guest_name || '' };
}

// "Ver pedido": con cuenta → detalle en Mi cuenta; invitado → seguimiento
// público con el número y el correo ya puestos (no puede iniciar sesión).
function orderLink(order, recipient) {
  const number = order.order_number || order._id;
  if (order.is_guest || !order.consumer_id) {
    const qs = new URLSearchParams({ order_number: String(number), email_or_phone: recipient.email });
    return `${STORE_URL()}/order/details?${qs}`;
  }
  return `${STORE_URL()}/account/order/details/${number}`;
}

const PAYMENT_LABELS = { cod: 'Pago contra entrega', mercadopago: 'Mercado Pago' };
const paymentLabel = (method) => PAYMENT_LABELS[String(method || '').toLowerCase()] || String(method || '').toUpperCase();

function formatMoney(n) {
  const num = Number(n || 0);
  return num.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function orderItemsTable(order) {
  const rows = (order.products || [])
    .map(
      (p) => `<tr>
        <td style="padding:8px 4px;border-bottom:1px solid #eee;">${escapeHtml(p.name || '')}${p.variation_name ? ` (${escapeHtml(p.variation_name)})` : ''}</td>
        <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:center;">${p.quantity}</td>
        <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:right;">$${formatMoney(p.sub_total)}</td>
      </tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <thead><tr>
      <th style="text-align:left;padding:8px 4px;border-bottom:2px solid #212121;">Producto</th>
      <th style="text-align:center;padding:8px 4px;border-bottom:2px solid #212121;">Cant.</th>
      <th style="text-align:right;padding:8px 4px;border-bottom:2px solid #212121;">Subtotal</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const viewOrderButton = (href) =>
  `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#212121;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">Ver pedido</a></p>`;

const guestTrackingHint = (order, recipient) =>
  order.is_guest || !order.consumer_id
    ? `<p style="color:#666;font-size:13px;">Puedes seguir tu pedido en cualquier momento con el número <strong>#${order.order_number || order._id}</strong> y el correo <strong>${escapeHtml(recipient.email)}</strong> en <a href="${escapeHtml(`${STORE_URL()}/order/tracking`)}" style="color:#666;">${escapeHtml(`${STORE_URL()}/order/tracking`)}</a>.</p>`
    : '';

/**
 * Confirmación del pedido con su detalle. Contra entrega: al crearlo
 * (POST /payment/initialize y POST /order). Pasarela: cuando el pago queda
 * confirmado (`paymentConfirmed`, desde webhook / verify) — antes de eso el
 * cliente no recibe nada.
 */
async function sendOrderConfirmation({ order, consumer, paymentConfirmed = false }) {
  const to = orderRecipient(order, consumer);
  if (!to) return;
  const number = order.order_number || order._id;
  const subject = paymentConfirmed
    ? `${STORE_NAME()}: Pago confirmado — pedido #${number}`
    : `${STORE_NAME()}: Pedido #${number} recibido`;
  const greeting = `Hola${to.name ? ` ${escapeHtml(to.name)}` : ''}`;
  const intro = paymentConfirmed
    ? `${greeting}, tu pago fue confirmado y tu pedido <strong>#${number}</strong> ya está en preparación.`
    : `${greeting}, recibimos tu pedido <strong>#${number}</strong>.`;
  const html = wrapHtml(`
    <h2 style="margin-top:0;">${paymentConfirmed ? '¡Recibimos tu pago!' : '¡Gracias por tu compra!'}</h2>
    <p>${intro}</p>
    ${orderItemsTable(order)}
    <p style="text-align:right;font-size:16px;"><strong>Total: $${formatMoney(order.total)}</strong></p>
    <p>Método de pago: <strong>${escapeHtml(paymentLabel(order.payment_method))}</strong>.</p>
    ${viewOrderButton(orderLink(order, to))}
    ${guestTrackingHint(order, to)}
  `);
  return brevo.sendTransactionalEmail({ to, subject, htmlContent: html });
}

// Al ENTREGAR, el correo invita a calificar la compra. Solo para clientes
// con cuenta: un pedido de invitado no puede reseñar (no hay usuario al que
// atribuir la reseña).
function rateYourPurchaseBlock(order) {
  const items = (order.products || []).map((p) => `<li style="margin:4px 0;">${escapeHtml(p.name || '')}</li>`).join('');
  const link = `${STORE_URL()}/account/order/details/${order.order_number || order._id}`;
  return `
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <h3 style="margin:0 0 8px;">¿Qué tal tu compra?</h3>
    <p style="margin:0 0 8px;">Tu opinión ayuda a otros clientes. Califica los productos que recibiste:</p>
    <ul style="margin:0 0 16px;padding-left:20px;color:#444;">${items}</ul>
    <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0da487;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">Califica tu compra</a></p>
    <p style="color:#666;font-size:13px;">Las reseñas se publican tras una breve revisión de nuestro equipo.</p>
  `;
}

// Cambio de estado del pedido (manual desde el admin). Solo se llama con el
// pago confirmado (order.routes.js); `paymentConfirmed` cambia el encabezado
// cuando el aviso acompaña a la confirmación del cobro.
async function sendOrderStatusUpdate({ order, consumer, statusName, statusSlug, paymentConfirmed = false }) {
  const to = orderRecipient(order, consumer);
  if (!to) return;
  const number = order.order_number || order._id;
  const status = escapeHtml(statusName || 'actualizado');
  const subject = paymentConfirmed
    ? `${STORE_NAME()}: Pago confirmado — pedido #${number}`
    : `${STORE_NAME()}: Pedido #${number} — ${statusName}`;
  const askForReview = statusSlug === 'delivered' && !order.is_guest;
  const html = wrapHtml(`
    <h2 style="margin-top:0;">${paymentConfirmed ? '¡Recibimos tu pago!' : 'Actualización de tu pedido'}</h2>
    <p>Hola${to.name ? ` ${escapeHtml(to.name)}` : ''}, tu pedido <strong>#${number}</strong> ahora está en estado: <strong>${status}</strong>.</p>
    ${viewOrderButton(orderLink(order, to))}
    ${guestTrackingHint(order, to)}
    ${askForReview ? rateYourPurchaseBlock(order) : ''}
  `);
  return brevo.sendTransactionalEmail({ to, subject, htmlContent: html });
}

// ────────────────────────────── Newsletter ──────────────────────────────
async function subscribeToNewsletter({ email, name }) {
  const listId = process.env.BREVO_NEWSLETTER_LIST_ID;
  const attributes = name ? { FIRSTNAME: name } : undefined;
  return brevo.addContactToList({ email, attributes, listId });
}

module.exports = {
  sendPasswordResetOTP,
  sendTestEmail,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  subscribeToNewsletter,
  isConfigured: brevo.isConfigured,
  logMailError,
};
