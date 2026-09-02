/**
 * Webhook y verify de Mercado Pago: solo tocan el estado del PAGO. El único
 * efecto logístico es pending → processing al completarse el pago; una
 * notificación repetida o tardía nunca regresa un pedido enviado. Sin BD.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const STATUSES = {
  pending: { _id: id(1), slug: 'pending' },
  processing: { _id: id(2), slug: 'processing' },
  shipped: { _id: id(3), slug: 'shipped' },
  delivered: { _id: id(5), slug: 'delivered' },
};
const ORDER_ID = id(100);
// Mismo id que TEST_USER en _support/helpers.js: el dueño del pedido.
const CONSUMER_ID = '64b0000000000000000000a1';
const flush = () => new Promise((r) => setTimeout(r, 30));

function buildApp({ orderSlug, paymentStatus = 'pending', gatewayStatus }) {
  jest.resetModules();
  const state = { status_id: STATUSES[orderSlug]._id, payment_status: paymentStatus, updates: [] };
  const Order = {
    findById: jest.fn(() => {
      const doc = { _id: ORDER_ID, consumer_id: CONSUMER_ID, payment_method: 'mercadopago', payment_status: state.payment_status, payment_transaction_id: 'tx1', status_id: state.status_id, payment_completed_at: null };
      const populated = { ...doc, status_id: Object.values(STATUSES).find((s) => String(s._id) === String(state.status_id)) };
      return { populate: async () => populated, then: (r) => Promise.resolve(doc).then(r) };
    }),
    findByIdAndUpdate: jest.fn(async (_id, update) => {
      state.updates.push(update);
      if (update.status_id) state.status_id = update.status_id;
      if (update.payment_status) state.payment_status = update.payment_status;
      return {};
    }),
  };
  const OrderStatus = {
    findOne: jest.fn(async (q) => Object.values(STATUSES).find((s) => s.slug === q?.slug) || null),
    findById: jest.fn(async (sid) => Object.values(STATUSES).find((s) => String(s._id) === String(sid)) || null),
  };
  const Cart = { deleteMany: jest.fn(async () => ({})), find: jest.fn() };
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/OrderStatus', () => OrderStatus);
  jest.doMock('../src/models/Cart', () => Cart);
  jest.doMock('../src/models/Address', () => ({ findOne: async () => null, countDocuments: async () => 0, create: async (d) => d }));
  jest.doMock('../src/services/payment/PaymentFactory', () => ({
    getGateway: () => ({
      handleWebhook: async () => ({ orderId: ORDER_ID, transactionId: 'tx1', status: gatewayStatus, gatewayResponse: { id: 'tx1' } }),
      verifyPayment: async () => ({ status: gatewayStatus }),
      initializePayment: async () => ({ success: true }),
    }),
  }));
  const { mockAuth, buildApp } = require('./_support/helpers');
  mockAuth('consumer');
  const app = buildApp([{ prefix: '/payment', modulePath: '../src/routes/payment.routes' }]);
  return { app, state, Cart };
}

const webhook = (app) => request(app).post('/payment/webhook').send({ type: 'payment', data: { id: 'tx1' } });

describe('POST /payment/webhook', () => {
  test('pago aprobado con pedido pending → completed + processing (y limpia carrito)', async () => {
    const { app, state, Cart } = buildApp({ orderSlug: 'pending', gatewayStatus: 'approved' });
    expect((await webhook(app)).status).toBe(200);
    await flush();
    expect(state.payment_status).toBe('completed');
    expect(String(state.status_id)).toBe(STATUSES.processing._id);
    expect(state.updates[0].payment_gateway_status).toBe('approved');
    expect(state.updates[0].payment_completed_at).toBeInstanceOf(Date);
    expect(Cart.deleteMany).toHaveBeenCalledWith({ consumer_id: CONSUMER_ID });
  });

  test('webhook repetido con el pedido ya enviado NO lo regresa a processing', async () => {
    const { app, state, Cart } = buildApp({ orderSlug: 'shipped', paymentStatus: 'completed', gatewayStatus: 'approved' });
    await webhook(app);
    await flush();
    expect(String(state.status_id)).toBe(STATUSES.shipped._id);
    expect(state.updates[0].status_id).toBeUndefined();
    expect(state.payment_status).toBe('completed');
    expect(Cart.deleteMany).not.toHaveBeenCalled();
  });

  test('pedido entregado: una notificación tardía tampoco lo toca', async () => {
    const { app, state } = buildApp({ orderSlug: 'delivered', paymentStatus: 'completed', gatewayStatus: 'approved' });
    await webhook(app);
    await flush();
    expect(String(state.status_id)).toBe(STATUSES.delivered._id);
  });

  test('notificación "pending" después de un pago completado no lo degrada', async () => {
    const { app, state } = buildApp({ orderSlug: 'processing', paymentStatus: 'completed', gatewayStatus: 'pending' });
    await webhook(app);
    await flush();
    expect(state.payment_status).toBe('completed');
    expect(String(state.status_id)).toBe(STATUSES.processing._id);
  });

  test('pago rechazado: payment_status=rejected y el pedido sigue pending', async () => {
    const { app, state } = buildApp({ orderSlug: 'pending', gatewayStatus: 'rejected' });
    await webhook(app);
    await flush();
    expect(state.payment_status).toBe('rejected');
    expect(state.updates[0].payment_error).toMatch(/rejected/);
    expect(String(state.status_id)).toBe(STATUSES.pending._id);
  });

  test('reembolso: payment_status=refunded sin tocar la logística', async () => {
    const { app, state } = buildApp({ orderSlug: 'shipped', paymentStatus: 'completed', gatewayStatus: 'refunded' });
    await webhook(app);
    await flush();
    expect(state.payment_status).toBe('refunded');
    expect(String(state.status_id)).toBe(STATUSES.shipped._id);
  });
});

describe('GET /payment/verify/:orderId', () => {
  test('pago aún pending y la pasarela dice approved → completed + processing', async () => {
    const { app, state } = buildApp({ orderSlug: 'pending', gatewayStatus: 'approved' });
    const res = await request(app).get(`/payment/verify/${ORDER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.payment_status).toBe('completed');
    expect(res.body.order_status.slug).toBe('processing');
    expect(String(state.status_id)).toBe(STATUSES.processing._id);
  });

  test('pago ya completado: responde sin consultar la pasarela ni cambiar nada', async () => {
    const { app, state } = buildApp({ orderSlug: 'shipped', paymentStatus: 'completed', gatewayStatus: 'approved' });
    const res = await request(app).get(`/payment/verify/${ORDER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.payment_status).toBe('completed');
    expect(state.updates).toHaveLength(0);
  });
});
