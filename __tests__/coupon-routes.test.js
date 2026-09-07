/**
 * Rutas de cupones (routes/coupon.routes.js):
 *  - /coupon/public lista los cupones vigentes también para invitados y no
 *    esconde los que tienen ventana de fechas (antes `is_expired` = "tiene
 *    fechas" los ocultaba aunque estuvieran vigentes);
 *  - crear/editar limpia los ids de productos y responde 422 ante un código
 *    repetido en vez de un 500;
 *  - el detalle puebla los productos para el formulario del admin.
 * Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const chain = (doc) => ({ populate() { return this; }, skip() { return this; }, limit() { return this; }, sort() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

function setup({ role = null, models = {} } = {}) {
  jest.resetModules();
  const Coupon = {
    find: jest.fn(() => chain([{ _id: id(1), title: 'Bienvenida', code: 'BIENVENIDO15', type: 'percentage', amount: 15, min_spend: 0, end_date: null, used: 3, usage_per_coupon: 10, is_expired: true, toJSON() { return { ...this }; } }])),
    findById: jest.fn(() => chain({ _id: id(1), code: 'X', products: [{ _id: id(5), name: 'Hoodie' }] })),
    findOne: jest.fn(async () => null),
    countDocuments: jest.fn(async () => 1),
    create: jest.fn(async (d) => ({ _id: id(9), ...d })),
    findByIdAndUpdate: jest.fn(async (_id, ops) => ({ _id, ...ops.$set })),
    ...models,
  };
  jest.doMock('../src/models/Coupon', () => Coupon);
  const { mockAuth, buildApp } = require('./_support/helpers');
  if (role) mockAuth(role);
  else jest.doMock('../src/middleware/optionalAuth', () => (req, _res, next) => { req.user = null; next(); });
  const app = buildApp([{ prefix: '/coupon', modulePath: '../src/routes/coupon.routes' }]);
  return { app, Coupon };
}

describe('GET /coupon/public', () => {
  test('invitado: ve los cupones vigentes con campos públicos (sin contadores ni límites)', async () => {
    const { app, Coupon } = setup();
    const res = await request(app).get('/coupon/public');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: id(1), title: 'Bienvenida', description: undefined, code: 'BIENVENIDO15', type: 'percentage', amount: 15, min_spend: 0, end_date: null }]);
    const filter = Coupon.find.mock.calls[0][0];
    expect(filter.status).toBe(1);
    expect(filter).not.toHaveProperty('is_expired');
    expect(JSON.stringify(filter)).toMatch(/start_date/);
    expect(JSON.stringify(filter)).toMatch(/end_date/);
  });
});

describe('POST /coupon (admin)', () => {
  test('limpia los ids de productos, recorta el código y guarda', async () => {
    const { app, Coupon } = setup({ role: 'admin' });
    const res = await request(app).post('/coupon').send({ title: 'Solo hoodie', code: '  solohoodie ', type: 'percentage', amount: 50, is_apply_all: 0, products: [id(5), '', null, 'nope', id(5)], exclude_products: 'x' });
    expect(res.status).toBe(201);
    const doc = Coupon.create.mock.calls[0][0];
    expect(doc.code).toBe('solohoodie');
    expect(doc.products).toEqual([id(5)]);
    expect(doc.exclude_products).toEqual([]);
  });

  test('código repetido → 422 legible (antes 500 por índice único)', async () => {
    const dup = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const { app } = setup({ role: 'admin', models: { create: jest.fn(async () => { throw dup; }) } });
    const res = await request(app).post('/coupon').send({ title: 'x', code: 'BIENVENIDO15', type: 'fixed', amount: 1 });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Ya existe un cupón/);
  });

  test('consumidor: 403', async () => {
    const { app } = setup({ role: 'consumer' });
    expect((await request(app).post('/coupon').send({ code: 'X' })).status).toBe(403);
  });
});

describe('PUT /coupon/:id (admin)', () => {
  test('editar: mismos filtros de ids y quita las fechas al desactivar la vigencia', async () => {
    const { app, Coupon } = setup({ role: 'admin' });
    const res = await request(app).put(`/coupon/${id(1)}`).send({ code: 'X', is_expired: 0, start_date: '2026-01-01', end_date: '2026-02-01', products: ['bad', id(6)] });
    expect(res.status).toBe(200);
    const [, ops] = Coupon.findByIdAndUpdate.mock.calls[0];
    expect(ops.$set.products).toEqual([id(6)]);
    expect(ops.$set).not.toHaveProperty('start_date');
    expect(ops.$unset).toEqual({ start_date: 1, end_date: 1 });
  });
});

describe('GET /coupon/:id (admin)', () => {
  test('puebla los productos para el formulario de edición', async () => {
    const { app, Coupon } = setup({ role: 'admin' });
    const res = await request(app).get(`/coupon/${id(1)}`);
    expect(res.status).toBe(200);
    expect(res.body.products[0].name).toBe('Hoodie');
    expect(Coupon.findById).toHaveBeenCalledWith(id(1));
  });
});
