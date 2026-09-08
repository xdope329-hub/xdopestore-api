/**
 * POST /register/checkout — "Crear cuenta" desde el checkout de invitados.
 * No pasa por reCAPTCHA (el checkout no tiene widget; el /register público
 * sí lo exige y por eso el alta en segundo plano fallaba en producción); en
 * su lugar exige el pedido recién creado con ese mismo correo. Crea la
 * cuenta, adopta los pedidos de invitado y devuelve la sesión para que la
 * tienda deje al cliente logueado. Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const chain = (doc) => ({ populate() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

function setup({ order, existingUser = null } = {}) {
  jest.resetModules();
  const User = {
    findOne: jest.fn(async () => existingUser),
    create: jest.fn(async (d) => ({ _id: id(50), ...d })),
    findById: jest.fn(() => chain({ _id: id(50), name: 'Nueva', email: 'nueva@example.com', role: { name: 'consumer' } })),
  };
  const Order = { findById: jest.fn(async () => order || null), updateMany: jest.fn(async () => ({ modifiedCount: 1 })) };
  jest.doMock('../src/models/User', () => User);
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/Role', () => ({ findOne: jest.fn(async () => ({ _id: id(2), name: 'consumer' })) }));
  jest.doMock('../src/config/refreshTokens', () => ({ issueRefreshToken: async () => 'refresh-1', rotateRefreshToken: jest.fn(), revokeRefreshToken: jest.fn(), revokeAllForUser: jest.fn() }));
  const { buildApp } = require('./_support/helpers');
  const app = buildApp([{ prefix: '/', modulePath: '../src/routes/auth.routes' }]);
  return { app, User, Order };
}

const freshGuestOrder = { _id: id(100), guest_email: 'nueva@example.com', consumer_id: null, createdAt: new Date() };
const body = { name: 'Nueva', email: 'Nueva@Example.com', password: 'Nueva@12345', phone: '3105550199', country_code: '57', order_id: id(100) };

describe('POST /register/checkout', () => {
  test('pedido reciente con el mismo correo → cuenta creada, pedidos adoptados y sesión devuelta', async () => {
    const { app, User, Order } = setup({ order: freshGuestOrder });
    const res = await request(app).post('/register/checkout').send(body);
    expect(res.status).toBe(201);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBe('refresh-1');
    expect(res.body.data.email).toBe('nueva@example.com');
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'nueva@example.com', name: 'Nueva' }));
    expect(Order.updateMany).toHaveBeenCalledWith({ guest_email: 'nueva@example.com', consumer_id: null }, { $set: { consumer_id: id(50), is_guest: false } });
  });

  test('el correo no coincide con el del pedido → 422 y no se crea nada', async () => {
    const { app, User } = setup({ order: { ...freshGuestOrder, guest_email: 'otra@example.com' } });
    const res = await request(app).post('/register/checkout').send(body);
    expect(res.status).toBe(422);
    expect(User.create).not.toHaveBeenCalled();
  });

  test('pedido viejo (más de 30 minutos) o inexistente → 422', async () => {
    const old = setup({ order: { ...freshGuestOrder, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    expect((await request(old.app).post('/register/checkout').send(body)).status).toBe(422);
    const none = setup({ order: null });
    expect((await request(none.app).post('/register/checkout').send(body)).status).toBe(422);
    const badId = setup({ order: freshGuestOrder });
    expect((await request(badId.app).post('/register/checkout').send({ ...body, order_id: 'nope' })).status).toBe(422);
  });

  test('correo ya registrado → 422 con el mismo mensaje que /register', async () => {
    const { app } = setup({ order: freshGuestOrder, existingUser: { _id: id(7) } });
    const res = await request(app).post('/register/checkout').send(body);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/already registered/);
  });

  test('contraseña débil → 422', async () => {
    const { app } = setup({ order: freshGuestOrder });
    const res = await request(app).post('/register/checkout').send({ ...body, password: 'corta' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Password/);
  });
});
