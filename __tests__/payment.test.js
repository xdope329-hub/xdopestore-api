/**
 * /payment/initialize route tests
 *
 * Covers the place-order flow:
 *  - 422 with "El carrito está vacío" when the server cart is empty
 *  - 201 with order_id for COD and the server cart cleared afterwards
 *  - 502 when the gateway throws (real exception path, not a happy-path code)
 */

const request = require('supertest');

describe('POST /payment/initialize', () => {
  let app;
  const Cart = { find: jest.fn(), deleteMany: jest.fn() };
  const Order = { create: jest.fn(), findByIdAndUpdate: jest.fn() };
  const OrderStatus = { findOne: jest.fn() };
  const Address = { findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn() };

  const codGatewaySpy = {
    initializePayment: jest.fn(async (order) => ({ success: true, order_id: String(order._id) })),
  };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Cart', () => Cart);
    jest.doMock('../src/models/Order', () => Order);
    jest.doMock('../src/models/OrderStatus', () => OrderStatus);
    jest.doMock('../src/models/Address', () => Address);
    jest.doMock('../src/services/payment/PaymentFactory', () => ({
      getGateway: () => codGatewaySpy,
    }));
    // Country/state lookups: return a stub object so flattenInlineAddress doesn't blow up
    jest.doMock('../src/data/countries', () => ({
      findCountry: (id) => (id ? { id: Number(id), name: 'Colombia' } : null),
      findState: (_c, id) => (id ? { id: Number(id), name: 'Bogotá D.C.' } : null),
    }));
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/payment', modulePath: '../src/routes/payment.routes' }]);
  });

  beforeEach(() => {
    Cart.find.mockReset();
    Cart.deleteMany.mockReset();
    Order.create.mockReset();
    Order.findByIdAndUpdate.mockReset();
    OrderStatus.findOne.mockReset();
    Address.findOne.mockReset();
    Address.create.mockReset();
    Address.countDocuments.mockReset();
    codGatewaySpy.initializePayment.mockClear();

    OrderStatus.findOne.mockResolvedValue({ _id: 'status-pending' });
  });

  test('returns 422 "El carrito está vacío" when the cart is empty', async () => {
    Cart.find.mockReturnValue({ populate: () => Promise.resolve([]) });

    const res = await request(app).post('/payment/initialize').send({
      payment_method: 'cod',
      billing_address_id: 'addr1',
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/carrito está vacío/i);
  });

  test('COD happy path: creates order, returns 201 with order_id, and clears the server cart', async () => {
    Cart.find.mockReturnValue({
      populate: () => Promise.resolve([
        { product_id: { _id: 'p1', name: 'P', sale_price: 100 }, variation_id: null, quantity: 1, sub_total: 100 },
      ]),
    });
    // Existing saved address is what the resolver returns
    Address.findOne.mockResolvedValue({
      toObject: () => ({ title: 'Home', street: '123', city: 'Bogotá', pincode: '11', phone: '5', country_code: '57' }),
    });
    Order.create.mockResolvedValue({ _id: 'order-1', payment_method: 'cod' });

    const res = await request(app).post('/payment/initialize').send({
      payment_method: 'cod',
      billing_address_id: 'addr1',
      shipping_address_id: 'addr1',
    });

    expect(res.status).toBe(201);
    expect(res.body.order_id).toBe('order-1');
    expect(codGatewaySpy.initializePayment).toHaveBeenCalledTimes(1);
    // For COD the route deletes the cart immediately
    expect(Cart.deleteMany).toHaveBeenCalledWith({ consumer_id: expect.anything() });
  });

  test('returns 502 when the gateway throws on initialization', async () => {
    Cart.find.mockReturnValue({
      populate: () => Promise.resolve([{ product_id: { _id: 'p1', name: 'P', sale_price: 100 }, quantity: 1, sub_total: 100 }]),
    });
    Address.findOne.mockResolvedValue({
      toObject: () => ({ title: 'Home', street: '123', city: 'Bogotá', pincode: '11', phone: '5', country_code: '57' }),
    });
    Order.create.mockResolvedValue({ _id: 'order-2', payment_method: 'cod' });
    codGatewaySpy.initializePayment.mockImplementationOnce(() => { throw new Error('boom'); });

    const res = await request(app).post('/payment/initialize').send({
      payment_method: 'cod',
      billing_address_id: 'addr1',
    });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Error al inicializar el pago/i);
    expect(res.body.detail).toBe('boom');
    // On gateway failure the cart must NOT be cleared
    expect(Cart.deleteMany).not.toHaveBeenCalled();
  });
});
