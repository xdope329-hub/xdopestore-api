/**
 * Stock y correos en el flujo de pedido:
 *  - POST /payment/initialize rechaza cantidades por encima del stock (422);
 *  - contra entrega: al crear el pedido se descuenta el stock y se envía la
 *    confirmación, y la entrega elegida queda guardada en el pedido;
 *  - Mercado Pago: al crear el pedido NO hay correo ni descuento de stock;
 *    ambos ocurren cuando la pasarela confirma el pago (webhook);
 *  - cambios de estado desde el admin: correo solo con pago confirmado, y
 *    cancelar repone el stock descontado.
 * Sin base de datos ni red.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');
const { fakeProductModel } = require('./_support/fakeProduct');

const id = (n) => n.toString(16).padStart(24, '0');
const PENDING = { _id: id(1), slug: 'pending', name: 'Pendiente' };
const PROCESSING = { _id: id(2), slug: 'processing', name: 'Procesando' };
const CANCELLED = { _id: id(6), slug: 'cancelled', name: 'Cancelado' };
const STATUSES = [PENDING, PROCESSING, CANCELLED];
const flush = () => new Promise((r) => setTimeout(r, 40));

function setupCheckout({ stock = 2, quantity = 1, capacity = null } = {}) {
  jest.resetModules();
  // Capacidad diaria (utils/capacity.js): null = hay cupo; un objeto = rechazo 422.
  jest.doMock('../src/utils/capacity', () => ({ capacityProblem: jest.fn(async () => capacity) }));
  const productDoc = { _id: id(3), name: 'Camisa', price: 100, sale_price: 100, status: 1, quantity: stock, stock_status: 'in_stock', variations: [] };
  const line = { product_id: productDoc, variation_id: null, quantity, sub_total: 100 * quantity };
  const state = { order: null, status_id: PENDING._id, payment_status: 'pending', reserved: false };
  const mail = { sendOrderConfirmation: jest.fn(async () => ({})), sendOrderStatusUpdate: jest.fn(async () => ({})), logMailError: () => () => {} };
  const Order = {
    create: jest.fn(async (doc) => {
      state.order = { _id: id(100), order_number: 3000, ...doc, toJSON() { return { ...this, toJSON: undefined }; } };
      return state.order;
    }),
    findById: jest.fn(() => {
      const doc = { ...(state.order || { _id: id(100), order_number: 3000, payment_method: 'mercadopago', products: [{ product_id: id(3), quantity }] }), stock_reserved: state.reserved, payment_status: state.payment_status, status_id: state.status_id, payment_transaction_id: 'tx1', payment_completed_at: null };
      const populated = { ...doc, status_id: STATUSES.find((s) => String(s._id) === String(state.status_id)), consumer_id: null };
      populated.toJSON = () => ({ ...populated, toJSON: undefined });
      return { populate: async () => populated, then: (r) => Promise.resolve(doc).then(r) };
    }),
    updateOne: jest.fn(async (filter, update) => {
      const value = update?.$set?.stock_reserved;
      if (value === undefined) return { matchedCount: 1, modifiedCount: 1 };
      const ok = filter.stock_reserved === true ? state.reserved === true : state.reserved !== true;
      if (!ok) return { matchedCount: 0, modifiedCount: 0 };
      state.reserved = value;
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    findOneAndUpdate: jest.fn(async (_guard, update) => { if (update.status_id) state.status_id = update.status_id; if (update.payment_status) state.payment_status = update.payment_status; return {}; }),
  };
  const Product = fakeProductModel(productDoc);
  jest.doMock('../src/services/mail', () => mail);
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/Product', () => Product);
  jest.doMock('../src/models/Cart', () => ({ find: () => ({ populate: async () => [line] }), deleteMany: jest.fn(async () => ({})) }));
  jest.doMock('../src/models/OrderStatus', () => ({
    findOne: jest.fn(async (q) => STATUSES.find((s) => s.slug === q?.slug) || null),
    findById: jest.fn(async (sid) => STATUSES.find((s) => String(s._id) === String(sid)) || null),
  }));
  jest.doMock('../src/models/Address', () => ({ findOne: async () => ({ toObject: () => ({ title: 'Casa', street: 'Calle 1', city: 'Bogotá', pincode: '1', phone: '5', country_code: '57' }) }), countDocuments: async () => 1, create: async (d) => d }));
  jest.doMock('../src/models/Shipping', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
  jest.doMock('../src/services/payment/PaymentFactory', () => ({
    getGateway: (method) => (method === 'mercadopago'
      ? { initializePayment: async () => ({ redirect_url: 'https://mp.example/pay' }), handleWebhook: async () => ({ orderId: id(100), transactionId: 'tx1', status: 'approved', gatewayResponse: { id: 'tx1' } }), verifyPayment: async () => ({ status: 'approved' }) }
      : { initializePayment: async (order) => ({ success: true, order_id: String(order._id) }) }),
  }));
  const { mockAuth, buildApp } = require('./_support/helpers');
  mockAuth('consumer');
  const app = buildApp([{ prefix: '/payment', modulePath: '../src/routes/payment.routes' }]);
  return { app, mail, Order, Product, productDoc, state };
}

const body = (payment_method) => ({ payment_method, shipping_address_id: 'addr1', billing_address_id: 'addr1', delivery_description: 'Envío estándar | 3–5 días hábiles' });

describe('POST /payment/initialize', () => {
  test('más unidades que el stock → 422 y no se crea el pedido', async () => {
    const { app, Order } = setupCheckout({ stock: 2, quantity: 3 });
    const res = await request(app).post('/payment/initialize').send(body('cod'));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Sin stock suficiente/);
    expect(res.body.stock).toMatchObject([{ name: 'Camisa', requested: 3, available: 2 }]);
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('cupo diario lleno → 422 con el estado de capacidad y sin crear el pedido', async () => {
    const blocked = { message: 'Hoy ya alcanzamos nuestra capacidad de pedidos. Escríbenos por WhatsApp y coordinamos tu pedido.', capacity: { enabled: true, reached: true, remaining: 0, daily_limit: 4, used: 4 } };
    const { app, Order, mail } = setupCheckout({ stock: 2, quantity: 1, capacity: blocked });
    const res = await request(app).post('/payment/initialize').send(body('cod'));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/WhatsApp/);
    expect(res.body.capacity).toMatchObject({ reached: true, remaining: 0 });
    expect(Order.create).not.toHaveBeenCalled();
    expect(mail.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  test('contra entrega: descuenta el stock, guarda la entrega elegida y envía la confirmación', async () => {
    const { app, mail, Order, Product, productDoc } = setupCheckout({ stock: 2, quantity: 2 });
    const res = await request(app).post('/payment/initialize').send(body('cod'));
    expect(res.status).toBe(201);
    await flush();
    expect(Order.create.mock.calls[0][0]).toMatchObject({ delivery_description: 'Envío estándar | 3–5 días hábiles', delivery_interval: null });
    expect(Product.findById).toHaveBeenCalledWith(id(3));
    expect(productDoc).toMatchObject({ quantity: 0, stock_status: 'out_of_stock' });
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: id(100), stock_reserved: { $ne: true } }, { $set: { stock_reserved: true } });
    expect(mail.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(mail.sendOrderConfirmation.mock.calls[0][0].paymentConfirmed).toBeFalsy();
  });

  test('Mercado Pago: al crear el pedido no hay correo ni descuento de stock', async () => {
    const { app, mail, Product, productDoc } = setupCheckout({ stock: 2, quantity: 1 });
    const res = await request(app).post('/payment/initialize').send(body('mercadopago'));
    expect(res.status).toBe(201);
    expect(res.body.redirect_url).toBe('https://mp.example/pay');
    await flush();
    expect(mail.sendOrderConfirmation).not.toHaveBeenCalled();
    expect(mail.sendOrderStatusUpdate).not.toHaveBeenCalled();
    expect(Product.findById).not.toHaveBeenCalled();
    expect(productDoc.quantity).toBe(2);
  });

  test('Mercado Pago: al confirmar el pago (webhook) se descuenta el stock y llega la confirmación', async () => {
    const { app, mail, Product, productDoc, Order, state } = setupCheckout({ stock: 2, quantity: 1 });
    expect((await request(app).post('/payment/initialize').send(body('mercadopago'))).status).toBe(201);
    await flush();
    expect((await request(app).post('/payment/webhook').send({ type: 'payment', data: { id: 'tx1' } })).status).toBe(200);
    await flush();
    expect(state.payment_status).toBe('completed');
    expect(String(state.status_id)).toBe(PROCESSING._id);
    expect(Product.findById).toHaveBeenCalledTimes(1);
    expect(productDoc.quantity).toBe(1);
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: id(100), stock_reserved: { $ne: true } }, { $set: { stock_reserved: true } });
    expect(mail.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(mail.sendOrderConfirmation.mock.calls[0][0]).toMatchObject({ paymentConfirmed: true });
  });
});

function setupStatusChange({ payment_method, payment_status, reserved, currentSlug = 'processing' }) {
  jest.resetModules();
  const productDoc = { _id: id(3), quantity: 0, stock_status: 'out_of_stock', variations: [] };
  const state = { status_id: STATUSES.find((s) => s.slug === currentSlug)._id, reserved };
  const orderDoc = () => ({ _id: id(100), order_number: 3000, payment_method, payment_status, stock_reserved: state.reserved, status_id: state.status_id, consumer_id: { _id: id(7), name: 'Ana', email: 'ana@example.com' }, products: [{ product_id: id(3), quantity: 1 }], toJSON() { return { ...this, toJSON: undefined }; } });
  const Order = {
    findById: jest.fn(() => {
      const doc = orderDoc();
      const populated = { ...doc, status_id: STATUSES.find((s) => String(s._id) === String(state.status_id)) };
      populated.toJSON = () => ({ ...populated, toJSON: undefined });
      return { populate: async () => populated, then: (r) => Promise.resolve(doc).then(r) };
    }),
    findByIdAndUpdate: jest.fn(async (_id, update) => { if (update.status_id) state.status_id = update.status_id; return orderDoc(); }),
    updateOne: jest.fn(async (filter, update) => {
      const value = update?.$set?.stock_reserved;
      if (value === undefined) return { matchedCount: 1, modifiedCount: 1 };
      const ok = filter.stock_reserved === true ? state.reserved === true : state.reserved !== true;
      if (!ok) return { matchedCount: 0, modifiedCount: 0 };
      state.reserved = value;
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
  const mail = { sendOrderConfirmation: jest.fn(async () => ({})), sendOrderStatusUpdate: jest.fn(async () => ({})), logMailError: () => () => {} };
  const Product = fakeProductModel(productDoc);
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/Product', () => Product);
  jest.doMock('../src/models/OrderStatus', () => ({
    findById: jest.fn(async (sid) => STATUSES.find((s) => String(s._id) === String(sid)) || null),
    findOne: jest.fn(async (q) => STATUSES.find((s) => s.slug === q?.slug) || null),
    find: jest.fn(async (q) => STATUSES.filter((s) => q?.slug?.$in?.includes(s.slug))),
  }));
  jest.doMock('../src/models/Cart', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
  jest.doMock('../src/services/mail', () => mail);
  const { mockAuth, buildApp } = require('./_support/helpers');
  mockAuth('admin');
  const app = buildApp([{ prefix: '/order', modulePath: '../src/routes/order.routes' }]);
  return { app, mail, Product, productDoc, Order, state };
}

describe('PUT /order/:id — correos y stock según el pago', () => {
  test('pedido de Mercado Pago sin pagar: el cambio de estado no envía correo', async () => {
    const { app, mail } = setupStatusChange({ payment_method: 'mercadopago', payment_status: 'pending', reserved: false, currentSlug: 'pending' });
    const res = await request(app).put(`/order/${id(100)}`).send({ order_status_id: PROCESSING._id });
    expect(res.status).toBe(200);
    await flush();
    expect(mail.sendOrderStatusUpdate).not.toHaveBeenCalled();
  });

  test('contra entrega: el cambio de estado sí avisa al cliente', async () => {
    const { app, mail } = setupStatusChange({ payment_method: 'cod', payment_status: 'pending', reserved: true, currentSlug: 'pending' });
    expect((await request(app).put(`/order/${id(100)}`).send({ order_status_id: PROCESSING._id })).status).toBe(200);
    await flush();
    expect(mail.sendOrderStatusUpdate).toHaveBeenCalledTimes(1);
    expect(mail.sendOrderStatusUpdate.mock.calls[0][0]).toMatchObject({ statusSlug: 'processing' });
  });

  test('cancelar un pedido con stock descontado lo repone', async () => {
    const { app, Product, productDoc, Order } = setupStatusChange({ payment_method: 'cod', payment_status: 'pending', reserved: true, currentSlug: 'processing' });
    expect((await request(app).put(`/order/${id(100)}`).send({ order_status_id: CANCELLED._id })).status).toBe(200);
    await flush();
    expect(Product.findById).toHaveBeenCalledWith(id(3));
    expect(productDoc).toMatchObject({ quantity: 1, stock_status: 'in_stock' });
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: id(100), stock_reserved: true }, { $set: { stock_reserved: false } });
  });

  test('cancelar un pedido que nunca descontó stock no toca el inventario', async () => {
    const { app, Product } = setupStatusChange({ payment_method: 'mercadopago', payment_status: 'pending', reserved: false, currentSlug: 'pending' });
    expect((await request(app).put(`/order/${id(100)}`).send({ order_status_id: CANCELLED._id })).status).toBe(200);
    await flush();
    expect(Product.findById).not.toHaveBeenCalled();
  });
});
