/**
 * Cambio MANUAL de estado (PUT /order/:id y PUT /orderStatus/:id con
 * order_id): los estados del pedido son secuenciales. Un salto devuelve 422
 * con los estados permitidos; nunca se toca payment_status. Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const STATUSES = {
  pending: { _id: id(1), slug: 'pending', name: 'Pendiente', sequence: 1 },
  processing: { _id: id(2), slug: 'processing', name: 'Procesando', sequence: 2 },
  shipped: { _id: id(3), slug: 'shipped', name: 'Enviado', sequence: 3 },
  out_for_delivery: { _id: id(4), slug: 'out_for_delivery', name: 'En Camino', sequence: 4 },
  delivered: { _id: id(5), slug: 'delivered', name: 'Entregado', sequence: 5 },
  cancelled: { _id: id(6), slug: 'cancelled', name: 'Cancelado', sequence: 6 },
};
const byId = (sid) => Object.values(STATUSES).find((s) => String(s._id) === String(sid)) || null;
const ORDER_ID = id(100);

function buildApp(currentSlug) {
  jest.resetModules();
  const state = { status_id: STATUSES[currentSlug]._id, payment_status: 'completed', updates: [] };
  const orderDoc = () => ({
    _id: ORDER_ID,
    order_number: 1234,
    status_id: state.status_id,
    payment_status: state.payment_status,
    consumer_id: { _id: id(7), name: 'Ana', email: 'ana@example.com' },
    products: [],
    toJSON() { return { ...this, status_id: byId(this.status_id) }; },
  });
  const chain = (doc) => ({ populate: async () => doc, then: (r) => Promise.resolve(doc).then(r) });
  const Order = {
    findById: jest.fn(() => {
      const doc = orderDoc();
      doc.status_id = state.status_id;
      const q = chain({ ...doc, status_id: byId(state.status_id), toJSON() { return { ...this }; } });
      q.populate = async () => ({ ...doc, status_id: byId(state.status_id), toJSON() { return { ...this }; } });
      return q;
    }),
    findOne: jest.fn(() => chain(orderDoc())),
    findByIdAndUpdate: jest.fn(async (_id, update) => { state.updates.push(update); if (update.status_id) state.status_id = update.status_id; return orderDoc(); }),
  };
  const OrderStatus = {
    findById: jest.fn(async (sid) => byId(sid)),
    findOne: jest.fn(async (q) => Object.values(STATUSES).find((s) => s.slug === q?.slug) || null),
    find: jest.fn(async (q) => Object.values(STATUSES).filter((s) => q?.slug?.$in?.includes(s.slug))),
    findByIdAndUpdate: jest.fn(),
    create: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/OrderStatus', () => OrderStatus);
  jest.doMock('../src/models/Cart', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
  jest.doMock('../src/services/mail', () => ({ sendOrderStatusUpdate: jest.fn(async () => {}), logMailError: () => () => {} }));
  const { mockAuth, buildApp } = require('./_support/helpers');
  mockAuth('admin');
  const app = buildApp([
    { prefix: '/order', modulePath: '../src/routes/order.routes' },
    { prefix: '/orderStatus', modulePath: '../src/routes/orderStatus.routes' },
  ]);
  return { app, state, Order };
}

const put = (app, slug) => request(app).put(`/order/${ORDER_ID}`).send({ order_status_id: STATUSES[slug]._id });

describe('PUT /order/:id — secuencia manual', () => {
  test('processing → shipped se aplica y devuelve los siguientes permitidos', async () => {
    const { app, state } = buildApp('processing');
    const res = await put(app, 'shipped');
    expect(res.status).toBe(200);
    expect(String(state.status_id)).toBe(STATUSES.shipped._id);
    expect(res.body.allowed_next_statuses.map((s) => s.slug)).toEqual(['out_for_delivery']);
    // El estado del pago no se toca.
    expect(state.updates.every((u) => !('payment_status' in u))).toBe(true);
  });

  test('processing → delivered (salto) → 422 y el pedido no cambia', async () => {
    const { app, state } = buildApp('processing');
    const res = await put(app, 'delivered');
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/secuenciales/);
    expect(res.body.allowed_next_statuses).toEqual(['shipped', 'cancelled']);
    expect(String(state.status_id)).toBe(STATUSES.processing._id);
  });

  test('shipped → processing (retroceso) → 422', async () => {
    const { app, state } = buildApp('shipped');
    const res = await put(app, 'processing');
    expect(res.status).toBe(422);
    expect(String(state.status_id)).toBe(STATUSES.shipped._id);
  });

  test('shipped → out_for_delivery → delivered, paso a paso', async () => {
    const { app, state } = buildApp('shipped');
    expect((await put(app, 'out_for_delivery')).status).toBe(200);
    expect((await put(app, 'delivered')).status).toBe(200);
    expect(String(state.status_id)).toBe(STATUSES.delivered._id);
    expect((await put(app, 'processing')).status).toBe(422);
  });

  test('cancelar: permitido en processing, prohibido una vez enviado', async () => {
    const a = buildApp('processing');
    expect((await put(a.app, 'cancelled')).status).toBe(200);
    const b = buildApp('shipped');
    expect((await put(b.app, 'cancelled')).status).toBe(422);
  });

  test('COD: pending → processing manual permitido', async () => {
    const { app } = buildApp('pending');
    expect((await put(app, 'processing')).status).toBe(200);
  });

  test('POST /order/:id (method override del admin) aplica la misma regla', async () => {
    const { app } = buildApp('processing');
    const res = await request(app).post(`/order/${ORDER_ID}`).send({ _method: 'put', order_status_id: STATUSES.delivered._id });
    expect(res.status).toBe(422);
  });

  test('GET /order/:id expone allowed_next_statuses', async () => {
    const { app } = buildApp('out_for_delivery');
    const res = await request(app).get(`/order/${ORDER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.allowed_next_statuses.map((s) => s.slug)).toEqual(['delivered']);
  });
});

describe('PUT /orderStatus/:id con order_id — misma regla', () => {
  test('rechaza el salto processing → delivered', async () => {
    const { app, state } = buildApp('processing');
    const res = await request(app).put(`/orderStatus/${STATUSES.delivered._id}`).send({ order_id: ORDER_ID, status_id: STATUSES.delivered._id });
    expect(res.status).toBe(422);
    expect(String(state.status_id)).toBe(STATUSES.processing._id);
  });

  test('acepta el siguiente paso', async () => {
    const { app, state } = buildApp('processing');
    const res = await request(app).put(`/orderStatus/${STATUSES.shipped._id}`).send({ order_id: ORDER_ID, status_id: STATUSES.shipped._id });
    expect(res.status).toBe(200);
    expect(String(state.status_id)).toBe(STATUSES.shipped._id);
  });
});
