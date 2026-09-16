/**
 * Solicitudes de reembolso (utils/refundRules.js + routes/refund.routes.js):
 *  - solo el dueño de un pedido ENTREGADO y pagado, de un producto que admite
 *    devolución y sin solicitud previa;
 *  - la solicitud se copia a la línea del pedido (refund_status);
 *  - el admin ve todas y aprueba/rechaza; el cliente solo ve las suyas.
 * Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');
const rules = require('../src/utils/refundRules');

const id = (n) => n.toString(16).padStart(24, '0');
const ME = '64b0000000000000000000a1';
const chain = (doc) => ({ populate() { return this; }, select() { return this; }, skip() { return this; }, limit() { return this; }, sort() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

const deliveredOrder = (extra = {}) => ({
  _id: id(100),
  consumer_id: ME,
  status_id: { slug: 'delivered' },
  payment_status: 'completed',
  products: [{ product_id: id(1), variation_id: null, quantity: 2, sub_total: 50000, refund_status: null }],
  ...extra,
});

describe('reglas de elegibilidad', () => {
  const line = deliveredOrder().products[0];
  const product = { is_return: true };

  test('pedido entregado, pagado, producto devolvible y sin solicitud → ok', () => {
    expect(rules.refundEligibility({ order: deliveredOrder(), line, product })).toEqual({ ok: true });
    expect(rules.refundEligibility({ order: deliveredOrder({ payment_status: 'paid' }), line, product: { is_return: 1 } }).ok).toBe(true);
  });

  test('cada condición que bloquea', () => {
    expect(rules.refundEligibility({ order: null }).message).toMatch(/no encontrado/);
    expect(rules.refundEligibility({ order: deliveredOrder({ status_id: { slug: 'shipped' } }), line, product }).message).toMatch(/entregado/);
    expect(rules.refundEligibility({ order: deliveredOrder({ payment_status: 'pending' }), line, product }).message).toMatch(/pago/);
    expect(rules.refundEligibility({ order: deliveredOrder(), line: null, product }).message).toMatch(/no pertenece/);
    expect(rules.refundEligibility({ order: deliveredOrder(), line, product: { is_return: false } }).message).toMatch(/no admite/);
    expect(rules.refundEligibility({ order: deliveredOrder(), line: { ...line, refund_status: 'pending' }, product }).message).toMatch(/Ya existe/);
  });

  test('línea por producto y variante', () => {
    const order = { products: [{ product_id: id(1), variation_id: id(11) }, { product_id: id(1), variation_id: id(12) }, { product_id: { _id: id(2) } }] };
    expect(rules.findOrderLine(order, id(1), id(12)).variation_id).toBe(id(12));
    expect(rules.findOrderLine(order, id(1))).toBe(order.products[0]);
    expect(rules.findOrderLine(order, id(2))).toBe(order.products[2]);
    expect(rules.findOrderLine(order, id(9))).toBeNull();
  });

  test('entrada y estados', () => {
    expect(rules.validateRefundInput({}).ok).toBe(false);
    expect(rules.validateRefundInput({ reason: '  talla equivocada ', payment_type: 'PayPal' })).toEqual({ ok: true, values: { reason: 'talla equivocada', payment_type: 'paypal' } });
    expect(rules.validateRefundInput({ reason: 'x' }).values.payment_type).toBe('original');
    expect(rules.parseRefundStatus('Approved')).toBe('approved');
    expect(rules.parseRefundStatus('done')).toBeNull();
  });
});

function setup(role, models = {}) {
  jest.resetModules();
  const Refund = {
    create: jest.fn(async (d) => ({ _id: id(500), ...d, toJSON() { return { _id: id(500), ...d }; } })),
    find: jest.fn(() => chain([])),
    findById: jest.fn(async () => null),
    countDocuments: jest.fn(async () => 0),
    ...models.Refund,
  };
  const Order = { findById: jest.fn(() => chain(deliveredOrder())), updateOne: jest.fn(async () => ({})), ...models.Order };
  const Product = { findById: jest.fn(() => chain({ _id: id(1), name: 'Gorra', is_return: true })), ...models.Product };
  jest.doMock('../src/models/Refund', () => Refund);
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/Product', () => Product);
  const { mockAuth, buildApp } = require('./_support/helpers');
  mockAuth(role);
  const app = buildApp([{ prefix: '/refund', modulePath: '../src/routes/refund.routes' }]);
  return { app, Refund, Order, Product };
}

describe('POST /refund', () => {
  const body = { order_id: id(100), product_id: id(1), reason: 'Llegó con un defecto', payment_type: 'original' };

  test('el cliente crea la solicitud y la línea del pedido queda pendiente', async () => {
    const { app, Refund, Order } = setup('consumer');
    const res = await request(app).post('/refund').send({ ...body, status: 'approved', amount: 999999 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.amount).toBe(50000);
    expect(res.body.quantity).toBe(2);
    expect(Refund.create).toHaveBeenCalledWith(expect.objectContaining({ order_id: id(100), product_id: id(1), consumer_id: ME, reason: 'Llegó con un defecto', status: 'pending', amount: 50000 }));
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: id(100), 'products.product_id': id(1) }, { $set: { 'products.$.refund_status': 'pending' } });
  });

  test('pedido de otro cliente → 403', async () => {
    const { app, Refund } = setup('consumer', { Order: { findById: jest.fn(() => chain(deliveredOrder({ consumer_id: id(77) }))) } });
    expect((await request(app).post('/refund').send(body)).status).toBe(403);
    expect(Refund.create).not.toHaveBeenCalled();
  });

  test('pedido sin entregar, producto no devolvible o ya solicitado → 422', async () => {
    let s = setup('consumer', { Order: { findById: jest.fn(() => chain(deliveredOrder({ status_id: { slug: 'shipped' } }))) } });
    expect((await request(s.app).post('/refund').send(body)).status).toBe(422);
    s = setup('consumer', { Product: { findById: jest.fn(() => chain({ _id: id(1), is_return: false })) } });
    expect((await request(s.app).post('/refund').send(body)).body.message).toMatch(/no admite/);
    s = setup('consumer', { Order: { findById: jest.fn(() => chain(deliveredOrder({ products: [{ product_id: id(1), refund_status: 'rejected', sub_total: 1, quantity: 1 }] }))) } });
    expect((await request(s.app).post('/refund').send(body)).body.message).toMatch(/Ya existe/);
    expect(s.Refund.create).not.toHaveBeenCalled();
  });

  test('sin motivo o con ids inválidos → 422', async () => {
    const { app } = setup('consumer');
    expect((await request(app).post('/refund').send({ ...body, reason: '  ' })).status).toBe(422);
    expect((await request(app).post('/refund').send({ ...body, order_id: 'nope' })).status).toBe(422);
  });
});

describe('GET /refund', () => {
  test('el cliente solo ve las suyas; el admin todas y filtra por estado', async () => {
    let s = setup('consumer');
    await request(s.app).get('/refund');
    expect(s.Refund.find).toHaveBeenCalledWith({ consumer_id: ME });
    s = setup('admin');
    await request(s.app).get('/refund').query({ status: 'pending' });
    expect(s.Refund.find).toHaveBeenCalledWith({ status: 'pending' });
  });

  test('cada solicitud lleva pedido, cliente y producto', async () => {
    const doc = { _id: id(500), reason: 'x', payment_type: 'original', amount: 1, quantity: 1, status: 'pending', createdAt: new Date('2026-01-01'), order_id: { _id: id(100), order_number: 2002 }, consumer_id: { _id: ME, name: 'Ana', email: 'a@x.com' }, product_id: { _id: id(1), name: 'Gorra', product_thumbnail_id: null } };
    const { app } = setup('admin', { Refund: { find: jest.fn(() => chain([doc])), countDocuments: jest.fn(async () => 1) } });
    const res = await request(app).get('/refund');
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ id: id(500), status: 'pending', order: { order_number: 2002 }, user: { name: 'Ana' }, product: { name: 'Gorra' } });
  });
});

describe('PUT /refund/:id', () => {
  const pending = () => ({ _id: id(500), order_id: id(100), product_id: id(1), variation_id: null, status: 'pending', moderated_at: null, save: jest.fn(async function () { return this; }), toJSON() { return { _id: id(500), status: this.status, admin_note: this.admin_note }; } });

  test('el cliente no puede aprobar', async () => {
    const refund = pending();
    const { app } = setup('consumer', { Refund: { findById: jest.fn(async () => refund) } });
    expect((await request(app).put(`/refund/${id(500)}`).send({ status: 'approved' })).status).toBe(403);
    expect(refund.status).toBe('pending');
  });

  test('el admin aprueba y la línea del pedido se actualiza', async () => {
    const refund = pending();
    const { app, Order } = setup('admin', { Refund: { findById: jest.fn(async () => refund) } });
    const res = await request(app).put(`/refund/${id(500)}`).send({ status: 'approved', admin_note: 'Reembolsado a la tarjeta' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(refund.moderated_at).toBeInstanceOf(Date);
    expect(refund.admin_note).toBe('Reembolsado a la tarjeta');
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: id(100), 'products.product_id': id(1) }, { $set: { 'products.$.refund_status': 'approved' } });
  });

  test('estado desconocido → 422; inexistente → 404', async () => {
    const { app } = setup('admin');
    expect((await request(app).put(`/refund/${id(500)}`).send({ status: 'done' })).status).toBe(422);
    expect((await request(app).put(`/refund/${id(500)}`).send({ status: 'rejected' })).status).toBe(404);
  });
});
