/**
 * Qué parte de Setting.values puede ver quien no es administrador.
 * GET /settings es público (el storefront lo necesita antes de iniciar
 * sesión), pero el documento completo incluye secciones que guardan
 * credenciales (correo SMTP, pasarela, SMS, clave secreta de reCAPTCHA).
 * Módulo puro; testeable sin base de datos.
 */
const { isAdminUser } = require('./roles');

// Secciones que nunca salen a un cliente anónimo o consumidor.
const PRIVATE_SECTIONS = ['email', 'payment_method', 'sms_configuration', 'google_recaptcha'];
const PRIVATE_KEYS = ['google_map_key'];
// De `maintenance` el storefront solo necesita la bandera.
const MAINTENANCE_PUBLIC_KEYS = ['maintenance_mode'];

function redactSettingValues(values) {
  if (!values || typeof values !== 'object') return values;
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (PRIVATE_SECTIONS.includes(key) || PRIVATE_KEYS.includes(key)) continue;
    if (key === 'maintenance' && value && typeof value === 'object') {
      out.maintenance = Object.fromEntries(MAINTENANCE_PUBLIC_KEYS.filter((k) => k in value).map((k) => [k, value[k]]));
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Documento de settings tal como debe responderse a `user` (null = anónimo). */
function redactSettingsFor(user, setting) {
  if (!setting) return setting;
  if (isAdminUser(user)) return setting;
  const obj = setting.toJSON ? setting.toJSON() : { ...setting };
  return { ...obj, values: redactSettingValues(obj.values) };
}

module.exports = { redactSettingValues, redactSettingsFor, PRIVATE_SECTIONS, PRIVATE_KEYS };
