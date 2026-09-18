const request = require('supertest');

const parentId = '111111111111111111111111';
const childId = '222222222222222222222222';
const smallId = '333333333333333333333333';
const largeId = '444444444444444444444444';
const selection = (variation_id = largeId) => [{ product_id: childId, variation_id }];
const baseOrder = { terms_accepted: true, terms_version: 'bundled-2026-08-27', payment_method: 'cod', name: 'QA Buyer', email: 'qa@example.com', shipping_address: { street: 'Calle 1', city: 'Bogotá' }, billing_address: { street: 'Calle 1', city: 'Bogotá' } };

describe('bundle checkout and cart persistence', () => {
  let app, parent, child, rows, signedIn, createdOrder, guestCart;
  const initializePayment = jest.fn(async () => ({ success: true }));
  const createOrder = jest.fn(async (doc) => { createdOrder = doc; return { _id: 'order-1', ...doc }; });
  const findCart = jest.fn(async (query) => rows.find((row) => {
    if (String(row.product_id) !== String(query.product_id)) return false;
    const composition = query.bundle_selections;
    return !composition || (row.bundle_selections.length === composition.$size && composition.$all.every(({ $elemMatch: wanted }) => row.bundle_selections.some((s) => s.product_id === wanted.product_id && s.variation_id === wanted.variation_id)));
  }));

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Product', () => ({ find: async () => [parent], findById: async (id) => String(id) === parentId ? parent : String(id) === childId ? child : null }));
    jest.doMock('../src/models/Page', () => ({ findOne: async () => null }));
    jest.doMock('../src/models/Cart', () => ({
      findOne: findCart,
      create: async (doc) => { const row = { _id: `line-${rows.length}`, ...doc, save: async () => {} }; rows.push(row); return row; },
      find: () => ({ populate: async () => rows.map((row) => ({ ...row, product_id: parent, bundle_selections: row.bundle_selections.map((s) => ({ ...s, product_id: child })) })) }),
      deleteMany: async () => {},
    }));
    jest.doMock('../src/models/Order', () => ({ create: createOrder, findById: () => ({ populate: async () => ({ _id: 'order-1', ...createdOrder }) }) }));
    jest.doMock('../src/models/OrderStatus', () => ({ findOne: async () => ({ _id: 'pending' }) }));
    jest.doMock('../src/models/Address', () => ({ countDocuments: async () => 0, create: async () => ({}), findOne: async () => null }));
    jest.doMock('../src/utils/shippingQuote', () => ({ quoteShipping: async () => ({ amount: 0 }) }));
    jest.doMock('../src/utils/stock', () => ({ stockProblems: () => [], reserveStock: async () => {} }));
    jest.doMock('../src/utils/capacity', () => ({ capacityProblem: async () => null }));
    jest.doMock('../src/services/mail', () => ({ sendOrderConfirmation: async () => {}, logMailError: () => () => {} }));
    jest.doMock('../src/services/payment/PaymentFactory', () => ({ getGateway: () => ({ initializePayment }) }));
    jest.doMock('../src/middleware/auth', () => (req, res, next) => { req.user = { _id: 'user-1' }; next(); });
    jest.doMock('../src/middleware/optionalAuth', () => (req, res, next) => { req.user = signedIn ? { _id: 'user-1' } : null; next(); });
    guestCart = require('../src/utils/guestCart');
    app = require('./_support/helpers').buildApp([
      { prefix: '/checkout', modulePath: '../src/routes/checkout.routes' },
      { prefix: '/payment', modulePath: '../src/routes/payment.routes' },
      { prefix: '/cart', modulePath: '../src/routes/cart.routes' },
      { prefix: '/', modulePath: '../src/routes/cart.sync.routes' },
    ]);
  });

  beforeEach(() => {
    parent = { _id: parentId, name: 'Bundle', type: 'bundle', price: 90000, sale_price: 90000, status: 1, variations: [], bundle_items: [{ product_id: childId, allowed_variation_ids: [smallId, largeId] }] };
    child = { _id: childId, name: 'Hoodie', status: 1, variations: [
      { _id: smallId, name: 'Small', status: 1, price: 40000, attribute_values: [{ name: 'Size', value: 'S' }] },
      { _id: largeId, name: 'Large', status: 1, price: 80000, attribute_values: [{ name: 'Size', value: 'L' }] },
    ] };
    rows = []; signedIn = false; createdOrder = null; createOrder.mockClear(); initializePayment.mockClear(); findCart.mockClear();
  });

  test('guest orders keep trusted child names and sizes while charging the fixed parent price', async () => {
    const line = { product_id: parentId, quantity: 2, price: 1, sub_total: 1, bundle_selections: [{ ...selection()[0], product_name: 'Forged', variation_name: 'Wrong' }] };
    const quote = await request(app).post('/checkout').send({ products: [line], city: 'Bogotá' });
    expect(quote.status).toBe(200);
    expect(quote.body.total).toBe(180000);
    const order = await request(app).post('/payment/initialize').send({ ...baseOrder, products: [line] });
    expect(order.status).toBe(201);
    expect(createdOrder.products[0]).toMatchObject({ price: 90000, sub_total: 180000, bundle_selections: [{ product_id: childId, product_name: 'Hoodie', variation_id: largeId, variation_name: 'Large', variation_attributes: [{ name: 'Size', value: 'L' }] }] });
  });

  test.each([undefined, [], {}, [{ product_id: childId }], selection('555555555555555555555555'), [...selection(), ...selection()]])('rejects invalid composition %p before payment or order creation', async (bundle_selections) => {
    const products = [{ product_id: parentId, quantity: 1, bundle_selections }];
    expect((await request(app).post('/checkout').send({ products })).status).toBe(422);
    expect((await request(app).post('/payment/initialize').send({ ...baseOrder, products })).status).toBe(422);
    expect((await request(app).post('/cart').send(products[0])).status).toBe(422);
    expect(createOrder).not.toHaveBeenCalled();
    expect(initializePayment).not.toHaveBeenCalled();
  });

  test('disallowed variants are rejected by guest, account and login-sync paths', async () => {
    parent.bundle_items[0].allowed_variation_ids = [smallId];
    const line = { product_id: parentId, quantity: 1, bundle_selections: selection(largeId) };
    expect((await request(app).post('/checkout').send({ products: [line] })).status).toBe(422);
    expect((await request(app).post('/cart').send(line)).status).toBe(422);
    const sync = await request(app).post('/sync/cart').send({ cart: [line] });
    expect(sync.body.skipped).toHaveLength(1);
    expect(rows).toHaveLength(0);
  });

  test('children without variants are preserved with a null variation', async () => {
    child.variations = [];
    const [line] = await guestCart.buildGuestCartItems([{ product_id: parentId, quantity: 1, bundle_selections: selection(null) }]);
    expect(line.bundle_selections).toEqual([{ product_id: child, variation_id: null }]);
  });

  test('a parent variation cannot override the bundle price', async () => {
    parent.variations = [{ _id: 'cheap', price: 1 }];
    const [line] = await guestCart.buildGuestCartItems([{ product_id: parentId, variation_id: 'cheap', quantity: 1, bundle_selections: selection() }]);
    expect(line.sub_total).toBe(90000);
    expect(line.variation_id).toBeNull();
  });

  test('login preserves two compositions, is idempotent, and yields a complete account order', async () => {
    const cart = [smallId, largeId].map((id) => ({ product_id: parentId, quantity: 1, bundle_selections: selection(id) }));
    expect((await request(app).post('/sync/cart').send({ cart })).status).toBe(200);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.bundle_selections[0].variation_id)).toEqual([smallId, largeId]);
    await request(app).post('/sync/cart').send({ cart });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.quantity)).toEqual([1, 1]);
    // Adding the second composition must update that line, not create a duplicate.
    await request(app).post('/cart').send(cart[1]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.quantity)).toEqual([1, 2]);
    signedIn = true;
    expect((await request(app).post('/payment/initialize').send(baseOrder)).status).toBe(201);
    expect(createdOrder.products.map((line) => line.bundle_selections[0].variation_name)).toEqual(['Small', 'Large']);
    expect(createdOrder.total).toBe(270000);
  });
});
