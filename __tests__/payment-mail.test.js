/**
 * Correos del flujo de pago (routes/payment.routes.js):
 *  - POST /payment/initialize confirma el pedido por correo (cuenta o
 *    invitado); antes solo el POST /order heredado lo hacía y el checkout de
 *    la tienda no enviaba nada;
 *  - webhook / verify: al confirmarse el pago (pending → processing) se avisa
 *    al comprador.
 * Sin base de datos ni red: modelos y correo simulados.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const PENDING = { _id: id(1), slug: 'pending', name: 'Pendiente' };
const PROCESSING = { _id: id(2), slug: 'processing', name: 'Procesando' };
const flush = () => new Promise((r) => setTimeout(r, 30));

function setup({ role = null, orderSlug = 'pending', guest = true } = {}) {
  jest.resetModules();
  const mail = { sendOrderConfirmation: jest.fn(async () => ({})), sendOrderStatusUpdate: jest.fn(async () => ({})), logMailError: () => () => {} };
  jest.doMock('../src/services/mail', () => mail);

  const created = { _id: id(100), order_number: 2004, payment_method: 'cod', is_guest: guest, guest_name: guest ? 'Cliente Invitado' : null, guest_email: guest ? 'invitado@example.com' : null, products: [{ name: 'P', quantity: 1, sub_total: 100 }], total: 100 };
  created.toJSON = () => ({ ...created, toJSON: undefined });
  const state = { status_id: orderSlug === 'pending' ? PENDING._id : PROCESSING._id, payment_status: 'pending' };
  const consumerDoc = { _id: id(50), name: 'Ana', email: 'ana@example.com' };
  const stored = () => ({
    _id: id(100), order_number: 2004, payment_method: 'mercadopago', payment_status: state.payment_status, payment_transaction_id: 'tx1',
    status_id: state.status_id, payment_completed_at: null, is_guest: guest, guest_name: created.guest_name, guest_email: created.guest_email,
    consumer_id: guest ? null : consumerDoc._id, products: created.products, total: 100,
  });
  const Order = {
    create: jest.fn(async () => created),
    findByIdAndUpdate: jest.fn(async (_id, update) => { if (update.status_id) state.status_id = update.status_id; if (update.payment_status) state.payment_status = update.payment_status; return {}; }),
    findById: jest.fn(() => {
      const doc = stored();
      const populated = { ...doc, status_id: [PENDING, PROCESSING].find((s) => String(s._id) === String(doc.status_id)), consumer_id: guest ? null : consumerDoc };
      populated.toJSON = () => ({ ...populated, toJSON: undefined });
      return { populate: async () => populated, then: (r) => Promise.resolve(doc).then(r) };
    }),
  };
  const OrderStatus = {
    findOne: jest.fn(async (q) => [PENDING, PROCESSING].find((s) => s.slug === q?.slug) || null),
    findById: jest.fn(async (sid) => [PENDING, PROCESSING].find((s) => String(s._id) === String(sid)) || null),
  };
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/OrderStatus', () => OrderStatus);
  jest.doMock('../src/models/Cart', () => ({ find: jest.fn(), deleteMany: jest.fn(async () => ({})) }));
  jest.doMock('../src/models/Address', () => ({ findOne: async () => null, countDocuments: async () => 0, create: async (d) => d }));
  jest.doMock('../src/models/Shipping', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
  jest.doMock('../src/models/Product', () => ({ find: jest.fn(async () => [{ _id: id(3), name: 'P', price: 100, sale_price: 100, status: 1, stock_status: 'in_stock', quantity: 5, variations: [] }]) }));
  jest.doMock('../src/data/countries', () => ({ findCountry: () => ({ id: 1, name: 'Colombia' }), findState: () => ({ id: 103, name: 'Bogotá D.C.' }) }));
  jest.doMock('../src/services/payment/PaymentFactory', () => ({
    getGateway: () => ({
      initializePayment: async (order) => ({ success: true, order_id: String(order._id) }),
      handleWebhook: async () => ({ orderId: id(100), transactionId: 'tx1', status: 'approved', gatewayResponse: { id: 'tx1' } }),
      verifyPayment: async () => ({ status: 'approved' }),
    }),
  }));
  const { mockAuth, buildApp } = require('./_support/helpers');
  if (role) mockAuth(role);
  else jest.doMock('../src/middleware/optionalAuth', () => (req, _res, next) => { req.user = null; next(); });
  const app = buildApp([{ prefix: '/payment', modulePath: '../src/routes/payment.routes' }]);
  return { app, mail, Order };
}

const address = { title: 'Casa', street: 'Calle 1', city: 'Bogotá', country_id: 1, state_id: 103, phone: '3105550199', country_code: '57' };

describe('POST /payment/initialize', () => {
  test('invitado (contra entrega): se envía la confirmación al correo del pedido', async () => {
    const { app, mail } = setup({ guest: true });
    const res = await request(app).post('/payment/initialize').send({
      name: 'Cliente Invitado', email: 'invitado@example.com', payment_method: 'cod',
      shipping_address: address, billing_address: address,
      products: [{ product_id: id(3), quantity: 1 }],
    });
    expect(res.status).toBe(201);
    await flush();
    expect(mail.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    const { order, consumer } = mail.sendOrderConfirmation.mock.calls[0][0];
    expect(order).toMatchObject({ order_number: 2004, guest_email: 'invitado@example.com' });
    expect(consumer).toBeNull();
  });
});

describe('pago confirmado por la pasarela', () => {
  test('webhook aprobado con pedido pending → aviso "Procesando" al comprador', async () => {
    const { app, mail } = setup({ role: 'consumer', guest: false });
    expect((await request(app).post('/payment/webhook').send({ type: 'payment', data: { id: 'tx1' } })).status).toBe(200);
    await flush();
    expect(mail.sendOrderStatusUpdate).toHaveBeenCalledTimes(1);
    const args = mail.sendOrderStatusUpdate.mock.calls[0][0];
    expect(args.consumer).toEqual({ name: 'Ana', email: 'ana@example.com' });
    expect(args).toMatchObject({ statusName: 'Procesando', statusSlug: 'processing', paymentConfirmed: true });
  });

  test('verificación desde la tienda: mismo aviso, también para invitados', async () => {
    const { app, mail } = setup({ guest: true });
    const res = await request(app).get(`/payment/verify/${id(100)}`);
    expect(res.status).toBe(200);
    expect(res.body.payment_status).toBe('completed');
    await flush();
    expect(mail.sendOrderStatusUpdate).toHaveBeenCalledTimes(1);
    expect(mail.sendOrderStatusUpdate.mock.calls[0][0]).toMatchObject({ consumer: null, paymentConfirmed: true });
    expect(mail.sendOrderStatusUpdate.mock.calls[0][0].order).toMatchObject({ guest_email: 'invitado@example.com' });
  });

  test('pedido que ya estaba en processing: el pago repetido no reenvía el aviso', async () => {
    const { app, mail } = setup({ role: 'consumer', guest: false, orderSlug: 'processing' });
    await request(app).post('/payment/webhook').send({ type: 'payment', data: { id: 'tx1' } });
    await flush();
    expect(mail.sendOrderStatusUpdate).not.toHaveBeenCalled();
  });
});
