/**
 * Una sola definición de "administrador" y de permisos para todo el API.
 *
 * Antes convivían tres criterios distintos (role.name === 'admin',
 * role.system_reserve === '1' y un role.slug inexistente) y la matriz de
 * permisos por módulo solo se usaba para pintar el menú del admin: ningún
 * endpoint la comprobaba. Ahora:
 *  - isAdminUser(user): rol reservado del sistema o llamado "admin".
 *  - hasPermission(user, 'product.create'): admin → siempre; otros roles →
 *    solo si su rol incluye el id de ese permiso (data/permissions.js).
 *  - moduleForRequest(req): traduce la ruta y el método a "módulo.acción"
 *    para que adminOnly aplique la matriz sin tocar cada archivo de rutas.
 */
const { PERMISSIONS } = require('../data/permissions');

const permissionIdByName = new Map(PERMISSIONS.map((p) => [p.name, p.id]));

function isAdminUser(user) {
  const role = user?.role;
  if (!role) return false;
  return role.system_reserve === '1' || String(role.name || '').toLowerCase() === 'admin';
}

function hasPermission(user, permissionName) {
  if (isAdminUser(user)) return true;
  const wantedId = permissionIdByName.get(permissionName);
  if (!wantedId) return false;
  const ids = Array.isArray(user?.role?.permissions) ? user.role.permissions.map(Number) : [];
  return ids.includes(wantedId);
}

// Primer segmento de la ruta → módulo de la matriz de permisos. Lo que no
// aparece aquí (media, menú, presets, estadísticas…) queda reservado al
// administrador.
const MODULE_BY_PATH = {
  user: 'user',
  product: 'product',
  category: 'category',
  brand: 'brand',
  attribute: 'attribute',
  tag: 'tag',
  order: 'order',
  orderstatus: 'order',
  review: 'review',
  coupon: 'coupon',
  shipping: 'shipping',
  tax: 'tax',
  role: 'role',
  blog: 'blog',
  page: 'page',
  faq: 'faq',
  currency: 'currency',
  settings: 'setting',
  themeoptions: 'theme_option',
  homepage: 'banner',
  home: 'banner',
  statistics: 'report',
  dashboard: 'report',
};

const ACTION_BY_METHOD = { GET: 'index', HEAD: 'index', POST: 'create', PUT: 'edit', PATCH: 'edit', DELETE: 'destroy' };

function moduleForRequest(req) {
  const full = `${req.baseUrl || ''}${req.path || ''}`;
  const first = full.split('/').filter(Boolean)[0];
  const module = first ? MODULE_BY_PATH[first.toLowerCase()] : null;
  const action = ACTION_BY_METHOD[String(req.method || '').toUpperCase()];
  if (!module || !action) return null;
  return `${module}.${action}`;
}

/** true si el usuario puede ejecutar la petición administrativa. */
function canAccessAdminRequest(user, req) {
  if (isAdminUser(user)) return true;
  const permission = moduleForRequest(req);
  return permission ? hasPermission(user, permission) : false;
}

module.exports = { isAdminUser, hasPermission, moduleForRequest, canAccessAdminRequest, MODULE_BY_PATH };
