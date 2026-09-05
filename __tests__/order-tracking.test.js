/**
 * Seguimiento público de pedidos (GET /trackOrder, routes/misc.routes.js):
 * número de pedido + correo o teléfono del comprador. El dueño con sesión y
 * el administrador no necesitan el contacto. Antes la ruta exigía sesión
 * (401) y un invitado nunca podía seguir su pedido; "no existe" y "no
 * coincide" responden igual (404). Sin base de datos: modelos simulados.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const ME = '64b0000000000000000000a1';
const chain = (doc) => ({ populate() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

const status = { _id: id(9), slug: 'pending', name: 'Pendiente', sequence: 1 };
const line = { product_id: { _id: id(1), name: 'Camisa', product_thumbnail_id: null, is_return: true }, name: 'Camisa', quantity: 2, price: 100, sub_total: 200 };

function order(extra = {}) {
  const doc = {
    _id: id(100),
    order_number: 2004,
    is_guest: true,
    guest_email: 'Invitado.E2E@example.com',
    consumer_id: null,
    status_id: status,
    products: [line],
    amount: 200,
    total: 200,
    payment_method: 'cod',
    payment_status: 'pending',
    shipping_address: { street: 'Calle 1', city: 'Bogotá', phone: '3105550199', country_code: '57' },
    billing_address: { street: 'Calle 1', city: 'Bogotá', phone: '3105550199', country_code: '57' },
    payment_gateway_response: { raw: 'secret' },
    ...extra,
  };
  doc.toJSON = () => {
    const { toJSON, ...plain } = doc;
    return plain;
  };
  return doc;
}

function setup(role, doc = order()) {
  jest.resetModules();
  const Order = { findOne: jest.fn(() => chain(doc)) };
  jest.doMock('../src/models/Order', () => Order);
  const { mockAuth, buildApp } = require('./_support/helpers');
  if (role) mockAuth(role);
  else jest.doMock('../src/middleware/optionalAuth', () => (req, _res, next) => { req.user = null; next(); });
  const app = buildApp([{ prefix: '/', modulePath: '../src/routes/misc.routes' }]);
  return { app, Order };
}

describe('invitado', () => {
  test('número de pedido + correo del comprador → el pedido, sin datos de cuenta ni de la pasarela', async () => {
    const { app, Order } = setup(null);
    const res = await request(app).get('/trackOrder').query({ order_number: '2004', email_or_phone: 'invitado.e2e@EXAMPLE.com' });
    expect(res.status).toBe(200);
    expect(Order.findOne).toHaveBeenCalledWith({ order_number: 2004 });
    expect(res.body.order_number).toBe(2004);
    expect(res.body.order_status).toMatchObject({ slug: 'pending', sequence: 1 });
    expect(res.body.products[0].pivot).toMatchObject({ single_price: 100, quantity: 2, subtotal: 200 });
    expect(res.body.consumer).toBeUndefined();
    expect(res.body.consumer_id).toBeUndefined();
    expect(res.body.payment_gateway_response).toBeUndefined();
  });

  test('también con el teléfono de la compra, con indicativo y espacios', async () => {
    const { app } = setup(null);
    const res = await request(app).get('/trackOrder').query({ order_number: 2004, email_or_phone: '+57 310 555 0199' });
    expect(res.status).toBe(200);
  });

  test('otro correo, sin contacto o pedido inexistente → 404 (sin confirmar el número)', async () => {
    const { app } = setup(null);
    expect((await request(app).get('/trackOrder').query({ order_number: 2004, email_or_phone: 'otro@example.com' })).status).toBe(404);
    expect((await request(app).get('/trackOrder').query({ order_number: 2004 })).status).toBe(404);
    const missing = setup(null, null);
    expect((await request(missing.app).get('/trackOrder').query({ order_number: 9999, email_or_phone: 'invitado.e2e@example.com' })).status).toBe(404);
  });

  test('número de pedido inválido → 404 sin consultar', async () => {
    const { app, Order } = setup(null);
    const res = await request(app).get('/trackOrder').query({ order_number: 'abc', email_or_phone: 'invitado.e2e@example.com' });
    expect(res.status).toBe(404);
    expect(Order.findOne).not.toHaveBeenCalled();
  });
});

describe('con sesión', () => {
  test('el dueño lo ve sin indicar contacto', async () => {
    const { app } = setup('consumer', order({ is_guest: false, guest_email: null, consumer_id: { _id: ME, email: 'isabella@xdope.com' } }));
    const res = await request(app).get('/trackOrder').query({ order_number: 2004 });
    expect(res.status).toBe(200);
    expect(res.body.order_number).toBe(2004);
  });

  test('otro cliente: 404, salvo que indique el contacto de la compra', async () => {
    const doc = order({ is_guest: false, guest_email: null, consumer_id: { _id: id(77), email: 'otra@xdope.com', phone: '3000000000' } });
    const { app } = setup('consumer', doc);
    expect((await request(app).get('/trackOrder').query({ order_number: 2004 })).status).toBe(404);
    expect((await request(app).get('/trackOrder').query({ order_number: 2004, email_or_phone: 'otra@xdope.com' })).status).toBe(200);
  });

  test('el administrador lo ve con los campos de diagnóstico de la pasarela', async () => {
    const { app } = setup('admin');
    const res = await request(app).get('/trackOrder').query({ order_number: 2004 });
    expect(res.status).toBe(200);
    expect(res.body.payment_gateway_response).toEqual({ raw: 'secret' });
  });
});
