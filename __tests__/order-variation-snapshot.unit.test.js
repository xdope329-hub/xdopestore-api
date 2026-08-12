/**
 * Order variation snapshot tests
 *
 * When a cart line points at a product variation (size/color), the order
 * created by POST /payment/initialize must snapshot:
 *  - variation_name (e.g. "S / Negro") so admin & storefront order views
 *    can show what was actually bought,
 *  - the VARIANT's unit price (not the parent product's).
 * Simple products keep the old behaviour (variation_name null, parent price).
 */

const request = require('supertest');

describe('POST /payment/initialize — variation snapshot', () => {
  let app;
  const Cart = { find: jest.fn(), deleteMany: jest.fn() };
  const Order = { create: jest.fn(), findByIdAndUpdate: jest.fn() };
  const OrderStatus = { findOne: jest.fn() };
  const Address = { findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn() };

  const codGatewaySpy = {
    initializePayment: jest.fn(async (order) => ({ success: true, order_id: String(order._id) })),
  };

  const VARIATION_ID = '64b00000000000000000c001';

  const variableProduct = {
    _id: 'p-var',
    name: 'Gato curioso',
    price: 160000,
    sale_price: 160000,
    variations: [
      { _id: VARIATION_ID, name: 'S / Negro', price: 115900, sale_price: 89900 },
      { _id: '64b00000000000000000c002', name: 'M / Beige', price: 115900, sale_price: 89900 },
    ],
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
    OrderStatus.findOne.mockReset();
    Address.findOne.mockReset();
    Address.create.mockReset();
    Address.countDocuments.mockReset();
    codGatewaySpy.initializePayment.mockClear();

    OrderStatus.findOne.mockResolvedValue({ _id: 'status-pending' });
    Address.findOne.mockResolvedValue({
      toObject: () => ({ title: 'Home', street: '123', city: 'Bogotá', pincode: '11', phone: '5', country_code: '57' }),
    });
    Order.create.mockResolvedValue({ _id: 'order-1', payment_method: 'cod' });
  });

  const placeOrder = () =>
    request(app).post('/payment/initialize').send({
      payment_method: 'cod',
      billing_address_id: 'addr1',
      shipping_address_id: 'addr1',
    });

  test('snapshots variation_name and uses the variant price for a variable product', async () => {
    Cart.find.mockReturnValue({
      populate: () => Promise.resolve([
        { product_id: variableProduct, variation_id: VARIATION_ID, quantity: 2, sub_total: 179800 },
      ]),
    });

    const res = await placeOrder();

    expect(res.status).toBe(201);
    expect(Order.create).toHaveBeenCalledTimes(1);
    const line = Order.create.mock.calls[0][0].products[0];
    expect(line.variation_id).toBe(VARIATION_ID);
    expect(line.variation_name).toBe('S / Negro');
    expect(line.price).toBe(89900); // variant sale price, NOT parent 160000
    expect(line.name).toBe('Gato curioso');
  });

  test('keeps variation_name null and the parent price for a simple product', async () => {
    Cart.find.mockReturnValue({
      populate: () => Promise.resolve([
        { product_id: { _id: 'p1', name: 'P', sale_price: 100, price: 120 }, variation_id: null, quantity: 1, sub_total: 100 },
      ]),
    });

    const res = await placeOrder();

    expect(res.status).toBe(201);
    const line = Order.create.mock.calls[0][0].products[0];
    expect(line.variation_name).toBeNull();
    expect(line.price).toBe(100);
  });

  test('is resilient when variation_id no longer matches any variant', async () => {
    Cart.find.mockReturnValue({
      populate: () => Promise.resolve([
        { product_id: variableProduct, variation_id: '64b00000000000000000dead', quantity: 1, sub_total: 160000 },
      ]),
    });

    const res = await placeOrder();

    expect(res.status).toBe(201);
    const line = Order.create.mock.calls[0][0].products[0];
    expect(line.variation_name).toBeNull();
    expect(line.price).toBe(160000); // falls back to the parent price
  });
});
