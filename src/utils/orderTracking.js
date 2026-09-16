/**
 * Seguimiento público de pedidos (GET /trackOrder). Módulo PURO (sin modelos)
 * para testearlo en aislamiento (order-tracking.unit.test.js).
 *
 * Un invitado (o cualquier visitante) puede ver un pedido si, además del
 * número, indica el correo o el teléfono con los que se compró: el correo del
 * invitado o de la cuenta, o el teléfono de la cuenta / de las direcciones
 * del pedido. La comparación ignora mayúsculas, espacios y símbolos, y acepta
 * el teléfono con o sin indicativo ("310 555 0199" ~ "+57 3105550199").
 */

const MIN_PHONE_DIGITS = 7;

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
const digits = (value) => String(value ?? '').replace(/\D/g, '');

const samePhone = (a, b) =>
  a.length >= MIN_PHONE_DIGITS && b.length >= MIN_PHONE_DIGITS && (a === b || a.endsWith(b) || b.endsWith(a));

/** ¿El contacto indicado corresponde al comprador de este pedido? */
function orderMatchesContact(order, contact) {
  const raw = String(contact ?? '').trim();
  if (!order || !raw) return false;

  const consumer = order.consumer_id && typeof order.consumer_id === 'object' ? order.consumer_id : null;

  if (raw.includes('@')) {
    const wanted = normalizeEmail(raw);
    return [order.guest_email, consumer?.email].map(normalizeEmail).filter(Boolean).includes(wanted);
  }

  const wanted = digits(raw);
  if (wanted.length < MIN_PHONE_DIGITS) return false;
  const known = [consumer?.phone, order.shipping_address?.phone, order.billing_address?.phone].map(digits).filter(Boolean);
  return known.some((phone) => samePhone(phone, wanted));
}

module.exports = { orderMatchesContact, MIN_PHONE_DIGITS };
