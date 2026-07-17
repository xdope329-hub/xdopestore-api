// High-level mail dispatchers. Each helper is fire-and-forget safe: callers
// use `.catch(logMailError)` so a Brevo outage never breaks the business flow.
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

// ────────────────────────────── Orders ──────────────────────────────
function formatMoney(n) {
  const num = Number(n || 0);
  return num.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function orderItemsTable(order) {
  const rows = (order.products || [])
    .map(
      (p) => `<tr>
        <td style="padding:8px 4px;border-bottom:1px solid #eee;">${p.name || ''}</td>
        <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:center;">${p.quantity}</td>
        <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:right;">$${formatMoney(p.sub_total)}</td>
      </tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <thead><tr>
      <th style="text-align:left;padding:8px 4px;border-bottom:2px solid #212121;">Product</th>
      <th style="text-align:center;padding:8px 4px;border-bottom:2px solid #212121;">Qty</th>
      <th style="text-align:right;padding:8px 4px;border-bottom:2px solid #212121;">Subtotal</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function sendOrderConfirmation({ order, consumer }) {
  if (!consumer?.email) return;
  const subject = `${STORE_NAME()}: Order ${order.order_number || order._id} confirmed`;
  const html = wrapHtml(`
    <h2 style="margin-top:0;">Thanks for your order!</h2>
    <p>Hi${consumer.name ? ` ${consumer.name}` : ''}, we received your order <strong>#${order.order_number || order._id}</strong>.</p>
    ${orderItemsTable(order)}
    <p style="text-align:right;font-size:16px;"><strong>Total: $${formatMoney(order.total)}</strong></p>
    <p><a href="${STORE_URL()}/account/orders" style="display:inline-block;background:#212121;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">View order</a></p>
  `);
  return brevo.sendTransactionalEmail({ to: { email: consumer.email, name: consumer.name }, subject, htmlContent: html });
}

async function sendOrderStatusUpdate({ order, consumer, statusName }) {
  if (!consumer?.email) return;
  const subject = `${STORE_NAME()}: Order ${order.order_number || order._id} — ${statusName}`;
  const html = wrapHtml(`
    <h2 style="margin-top:0;">Order update</h2>
    <p>Hi${consumer.name ? ` ${consumer.name}` : ''}, your order <strong>#${order.order_number || order._id}</strong> is now <strong>${statusName}</strong>.</p>
    <p><a href="${STORE_URL()}/account/orders" style="display:inline-block;background:#212121;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">View order</a></p>
  `);
  return brevo.sendTransactionalEmail({ to: { email: consumer.email, name: consumer.name }, subject, htmlContent: html });
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
