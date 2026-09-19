const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// Normalizacion segun especificacion de Meta:
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
const normEmail = (v) => String(v || '').trim().toLowerCase();
const normPhone = (v) => String(v || '').replace(/[^\d]/g, '');
const normName = (v) => String(v || '').trim().toLowerCase();
const normCity = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, '');
const normState = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, '');
const normZip = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, '');
const normCountry = (v) => {
  const s = String(v || '').trim().toLowerCase();
  // Meta espera codigo ISO 3166-1 alpha-2. Nombres frecuentes de Colombia:
  if (['co', 'col', 'colombia'].includes(s)) return 'co';
  return s.slice(0, 2);
};

const hashEmail = (v) => (v ? sha256(normEmail(v)) : null);
const hashPhone = (v) => (v ? sha256(normPhone(v)) : null);
const hashName = (v) => (v ? sha256(normName(v)) : null);
const hashCity = (v) => (v ? sha256(normCity(v)) : null);
const hashState = (v) => (v ? sha256(normState(v)) : null);
const hashZip = (v) => (v ? sha256(normZip(v)) : null);
const hashCountry = (v) => (v ? sha256(normCountry(v)) : null);
const hashExternalId = (v) => (v ? sha256(String(v).trim()) : null);

module.exports = {
  sha256,
  hashEmail, hashPhone, hashName,
  hashCity, hashState, hashZip, hashCountry,
  hashExternalId,
};
