/**
 * Una sola definición de administrador y permisos por módulo aplicados en
 * el servidor (utils/roles.js + middleware/adminOnly.js). Sin base de datos.
 */

const { PERMISSIONS } = require('../src/data/permissions');
const { isAdminUser, hasPermission, moduleForRequest, canAccessAdminRequest } = require('../src/utils/roles');
const adminOnly = require('../src/middleware/adminOnly');

const idOf = (name) => PERMISSIONS.find((p) => p.name === name).id;
const admin = { role: { name: 'admin', system_reserve: '1' } };
const reservedRenamed = { role: { name: 'Superusuario', system_reserve: '1' } };
const staff = { role: { name: 'staff', system_reserve: '0', permissions: [idOf('product.index'), idOf('product.create'), idOf('order.edit')] } };
const consumer = { role: { name: 'consumer', system_reserve: '0', permissions: [] } };

const run = (user, method, baseUrl, path = '/') =>
  new Promise((resolve) => {
    const req = { user, method, baseUrl, path };
    const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }) };
    adminOnly(req, res, () => resolve({ code: 200 }));
  });

describe('isAdminUser', () => {
  test('rol reservado del sistema o llamado admin, sin importar mayúsculas', () => {
    expect(isAdminUser(admin)).toBe(true);
    expect(isAdminUser(reservedRenamed)).toBe(true);
    expect(isAdminUser({ role: { name: 'Admin', system_reserve: '0' } })).toBe(true);
    expect(isAdminUser(staff)).toBe(false);
    expect(isAdminUser(consumer)).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser({})).toBe(false);
  });
});

describe('hasPermission', () => {
  test('el administrador tiene todo; otros roles solo lo asignado', () => {
    expect(hasPermission(admin, 'setting.edit')).toBe(true);
    expect(hasPermission(staff, 'product.create')).toBe(true);
    expect(hasPermission(staff, 'product.destroy')).toBe(false);
    expect(hasPermission(staff, 'no.such')).toBe(false);
    expect(hasPermission(consumer, 'product.index')).toBe(false);
  });
});

describe('moduleForRequest', () => {
  test('traduce ruta + método a módulo.acción', () => {
    expect(moduleForRequest({ baseUrl: '/product', path: '/', method: 'POST' })).toBe('product.create');
    expect(moduleForRequest({ baseUrl: '/product', path: '/abc', method: 'DELETE' })).toBe('product.destroy');
    expect(moduleForRequest({ baseUrl: '/orderStatus', path: '/1', method: 'PUT' })).toBe('order.edit');
    expect(moduleForRequest({ baseUrl: '/', path: '/tag/1', method: 'PUT' })).toBe('tag.edit');
    expect(moduleForRequest({ baseUrl: '/settings', path: '/', method: 'PUT' })).toBe('setting.edit');
    expect(moduleForRequest({ baseUrl: '/statistics', path: '/count', method: 'GET' })).toBe('report.index');
    // Sin módulo en la matriz → reservado al administrador.
    expect(moduleForRequest({ baseUrl: '/attachment', path: '/', method: 'POST' })).toBeNull();
    expect(moduleForRequest({ baseUrl: '/', path: '/menu', method: 'POST' })).toBeNull();
  });
});

describe('adminOnly', () => {
  test('administrador: pasa en cualquier ruta', async () => {
    expect((await run(admin, 'DELETE', '/attachment', '/x')).code).toBe(200);
    expect((await run(reservedRenamed, 'PUT', '/settings')).code).toBe(200);
  });

  test('rol con permisos: solo las acciones asignadas', async () => {
    expect((await run(staff, 'POST', '/product')).code).toBe(200);
    expect((await run(staff, 'GET', '/product')).code).toBe(200);
    expect((await run(staff, 'PUT', '/order', '/abc')).code).toBe(200);
    expect((await run(staff, 'DELETE', '/product', '/abc')).code).toBe(403);
    expect((await run(staff, 'PUT', '/settings')).code).toBe(403);
    expect((await run(staff, 'POST', '/attachment')).code).toBe(403);
  });

  test('cliente y anónimo: 403', async () => {
    expect((await run(consumer, 'POST', '/product')).code).toBe(403);
    expect((await run(undefined, 'GET', '/statistics', '/count')).code).toBe(403);
    expect(canAccessAdminRequest(consumer, { baseUrl: '/product', path: '/', method: 'GET' })).toBe(false);
  });
});
