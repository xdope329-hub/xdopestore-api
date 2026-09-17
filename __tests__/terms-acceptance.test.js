const request = require('supertest');

describe('checkout terms acceptance', () => {
  let app, terms, page, created, signedIn;
  const create = jest.fn(async (doc) => {
    created = { _id: 'order-1', ...doc };
    return created;
  });
  const initializePayment = jest.fn(async () => ({ success: true }));
  const address = { street: 'Calle 1', city: 'Bogotá' };
  const item = { product_id: { _id: 'p1', name: 'Hoodie', price: 50000 }, quantity: 1 };
  const base = { name: 'Customer', email: 'customer@example.com', payment_method: 'cod', shipping_address: address, billing_address: address };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Page', () => ({ findOne: jest.fn(async () => page) }));
    jest.doMock('../src/models/Order', () => ({
      create,
      findById: () => ({ populate: async () => ({ ...created, toJSON() { return { ...created }; } }) }),
    }));
    jest.doMock('../src/models/Cart', () => ({ find: () => ({ populate: async () => [item] }), deleteMany: async () => {} }));
    jest.doMock('../src/models/OrderStatus', () => ({ findOne: async () => ({ _id: 'pending' }) }));
    jest.doMock('../src/models/Address', () => ({ countDocuments: async () => 0, create: async () => ({}), findOne: async () => null }));
    jest.doMock('../src/utils/guestCart', () => ({ buildGuestCartItems: async () => [item] }));
    jest.doMock('../src/utils/shippingQuote', () => ({ quoteShipping: async () => ({ amount: 0 }) }));
    jest.doMock('../src/utils/stock', () => ({ stockProblems: () => [], reserveStock: async () => {} }));
    jest.doMock('../src/utils/capacity', () => ({ capacityProblem: async () => null }));
    jest.doMock('../src/services/mail', () => ({ sendOrderConfirmation: async () => {}, logMailError: () => () => {} }));
    jest.doMock('../src/services/payment/PaymentFactory', () => ({ getGateway: () => ({ initializePayment }) }));
    jest.doMock('../src/middleware/optionalAuth', () => (req, res, next) => { req.user = signedIn ? { _id: 'user-1' } : null; next(); });
    jest.doMock('../src/middleware/auth', () => (req, res, next) => { req.user = { _id: 'user-1' }; next(); });
    const { buildApp } = require('./_support/helpers');
    terms = require('../src/utils/termsAcceptance');
    app = buildApp([
      { prefix: '/checkout', modulePath: '../src/routes/checkout.routes' },
      { prefix: '/payment', modulePath: '../src/routes/payment.routes' },
      { prefix: '/order', modulePath: '../src/routes/order.routes' },
    ]);
  });
  beforeEach(() => { page = null; signedIn = false; created = null; create.mockClear(); initializePayment.mockClear(); });

  test('returns the bundled revision without caching or exposing the archive', async () => {
    const res = await request(app).get('/checkout/terms');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ source: 'bundled', version: 'bundled-2026-08-27', path: '/terms-and-conditions' });
  });

  test.each([undefined, false, 'true', 'false', 1, 0, null])('rejects non-explicit acceptance %p for guests and accounts', async (accepted) => {
    for (const isSignedIn of [false, true]) {
      signedIn = isSignedIn;
      const res = await request(app).post('/payment/initialize').send({ ...base, terms_accepted: accepted, terms_version: 'bundled-2026-08-27' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
    }
    expect(create).not.toHaveBeenCalled();
    expect(initializePayment).not.toHaveBeenCalled();
  });

  test.each([false, true])('persists server timestamp, version and text (signed in: %s)', async (isSignedIn) => {
    signedIn = isSignedIn;
    const before = Date.now();
    const res = await request(app).post('/payment/initialize').send({ ...base, terms_accepted: true, terms_version: 'bundled-2026-08-27', terms_acceptance: { accepted_at: '2000-01-01', content: 'forged' } });
    expect(res.status).toBe(201);
    expect(created.terms_acceptance).toMatchObject({ accepted: true, version: 'bundled-2026-08-27', path: '/terms-and-conditions', source: 'bundled' });
    expect(created.terms_acceptance.accepted_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(created.terms_acceptance.content).toContain('Términos y Condiciones');
    expect(created.terms_acceptance.content).not.toContain('forged');
  });

  test('CMS edits invalidate acceptance; the accepted text remains on the order', async () => {
    page = { title: 'Terms', content: '<p>Original terms</p>' };
    const original = await terms.currentTerms();
    const body = { ...base, terms_accepted: true, terms_version: original.version };
    page.content = '<p>Updated terms</p>';
    const rejected = await request(app).post('/payment/initialize').send(body);
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('TERMS_VERSION_CHANGED');
    expect(create).not.toHaveBeenCalled();
    const current = await terms.currentTerms();
    const accepted = await request(app).post('/payment/initialize').send({ ...body, terms_version: current.version });
    expect(accepted.status).toBe(201);
    page.content = '<p>Later terms</p>';
    expect(JSON.parse(created.terms_acceptance.content).content).toBe('<p>Updated terms</p>');
  });

  test('legacy order creation cannot bypass acceptance', async () => {
    expect((await request(app).post('/order').send(base)).body.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
    expect(create).not.toHaveBeenCalled();
    const res = await request(app).post('/order').send({ ...base, terms_accepted: true, terms_version: 'bundled-2026-08-27' });
    expect(res.status).toBe(201);
    expect(created.terms_acceptance.accepted).toBe(true);
  });

  test('an unchecked quote can still be calculated', async () => {
    const res = await request(app).post('/checkout').send({ ...base, terms_accepted: false });
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
  });
});

test('order schema preserves acceptance evidence and leaves historical orders unmarked', () => {
  jest.resetModules();
  jest.dontMock('../src/models/Order');
  const Order = require('../src/models/Order');
  expect(new Order().terms_acceptance).toBeNull();
  const accepted_at = new Date();
  const doc = new Order({ terms_acceptance: { accepted: true, accepted_at, version: 'cms-hash', source: 'cms', path: '/terms-and-conditions', content: 'snapshot' } });
  expect(doc.terms_acceptance.toObject()).toMatchObject({ accepted: true, accepted_at, content: 'snapshot', version: 'cms-hash' });
});
