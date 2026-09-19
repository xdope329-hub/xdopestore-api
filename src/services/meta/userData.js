const {
  hashEmail, hashPhone, hashName, hashCity, hashState, hashZip, hashCountry, hashExternalId,
} = require('./hash');

// Corta el nombre completo en "first" y "last" (Meta hashea cada uno por separado).
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { fn: null, ln: null };
  if (parts.length === 1) return { fn: parts[0], ln: null };
  return { fn: parts[0], ln: parts.slice(1).join(' ') };
}

function pickAddress(order) {
  return order?.shipping_address || order?.billing_address || null;
}

/**
 * Construye el bloque `user_data` de un evento CAPI. Los campos personales se
 * hashean con SHA-256 (Meta rechaza personal en claro). fbp/fbc/ip/ua viajan
 * en claro por especificacion.
 * @param {Object} order  documento Order de Mongoose (o plain)
 * @param {Object} account  { name, email } si el pedido es de un usuario
 */
function buildUserData(order, account) {
  const email = account?.email || order?.guest_email || null;
  const fullName = account?.name || order?.guest_name || pickAddress(order)?.title || null;
  const { fn, ln } = splitName(fullName);
  const addr = pickAddress(order) || {};
  const phone = addr.phone || null;
  const country_code = addr.country_code || null;
  const phoneWithCC = phone ? (country_code ? `${country_code}${phone}` : phone) : null;
  const cityName = addr.city || null;
  const stateName = addr.state?.name || (typeof addr.state === 'string' ? addr.state : null);
  const countryName = addr.country?.name || (typeof addr.country === 'string' ? addr.country : null);
  const externalId = order?.consumer_id ? String(order.consumer_id) : (order?.guest_email || null);

  const ud = {};
  if (email) ud.em = [hashEmail(email)];
  if (phoneWithCC) ud.ph = [hashPhone(phoneWithCC)];
  if (fn) ud.fn = [hashName(fn)];
  if (ln) ud.ln = [hashName(ln)];
  if (cityName) ud.ct = [hashCity(cityName)];
  if (stateName) ud.st = [hashState(stateName)];
  if (addr.pincode) ud.zp = [hashZip(addr.pincode)];
  if (countryName) ud.country = [hashCountry(countryName)];
  if (externalId) ud.external_id = [hashExternalId(externalId)];
  if (order?.meta_fbp) ud.fbp = order.meta_fbp;
  if (order?.meta_fbc) ud.fbc = order.meta_fbc;
  if (order?.meta_client_ip) ud.client_ip_address = order.meta_client_ip;
  if (order?.meta_client_user_agent) ud.client_user_agent = order.meta_client_user_agent;
  return ud;
}

module.exports = { buildUserData };
