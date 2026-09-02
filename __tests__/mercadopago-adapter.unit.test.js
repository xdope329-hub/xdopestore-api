/**
 * Unit tests for MercadoPagoAdapter.initializePayment — verifies the
 * preference body adapts to local vs public URLs:
 *  - localhost STORE_URL  -> no auto_return (MP rejects it for unreachable
 *    back_urls with "auto_return invalid. back_url.success must be defined")
 *  - localhost BASE_URL   -> no notification_url (MP can't reach localhost)
 *  - public URLs          -> auto_return + notification_url present
 * The mercadopago SDK is mocked; no network involved.
 */

let capturedBody;
let mockPreferenceResponse;

jest.mock('mercadopago', () => ({
  MercadoPagoConfig: jest.fn().mockImplementation(() => ({})),
  Preference: jest.fn().mockImplementation(() => ({
    create: async ({ body }) => {
      capturedBody = body;
      return mockPreferenceResponse;
    },
  })),
  Payment: jest.fn(),
}));

const MercadoPagoAdapter = require('../src/services/payment/adapters/MercadoPagoAdapter');

const ORDER = {
  _id: 'order123',
  products: [{ product_id: 'p1', name: 'Producto', quantity: 1, price: 1000 }],
  coupon_total_discount: 0,
  shipping_total: 0,
  total: 1000,
};

const ENV_KEYS = ['STORE_URL', 'BASE_URL', 'MP_ACCESS_TOKEN', 'MP_SANDBOX'];
const savedEnv = {};

beforeAll(() => ENV_KEYS.forEach((k) => (savedEnv[k] = process.env[k])));
afterAll(() => ENV_KEYS.forEach((k) => (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k]))));

beforeEach(() => {
  mockPreferenceResponse = { id: 'pref_1', init_point: 'https://mp/init', sandbox_init_point: 'https://mp/sandbox' };
  capturedBody = undefined;
  process.env.MP_ACCESS_TOKEN = 'APP_USR-test';
  process.env.MP_SANDBOX = 'false';
});

describe('MercadoPagoAdapter.initializePayment', () => {
  test('local URLs: omits auto_return and notification_url, keeps back_urls', async () => {
    process.env.STORE_URL = 'http://localhost:3001';
    process.env.BASE_URL = 'http://localhost:5000';

    const result = await new MercadoPagoAdapter().initializePayment(ORDER);

    expect(capturedBody.back_urls.success).toBe('http://localhost:3001/order/success?id=order123');
    expect(capturedBody).not.toHaveProperty('auto_return');
    expect(capturedBody).not.toHaveProperty('notification_url');
    expect(result.redirect_url).toBe('https://mp/init');
    expect(result.preference_id).toBe('pref_1');
  });

  test('public URLs: includes auto_return and notification_url', async () => {
    process.env.STORE_URL = 'https://xdope.vercel.app';
    process.env.BASE_URL = 'https://xdope-api.onrender.com';

    await new MercadoPagoAdapter().initializePayment(ORDER);

    expect(capturedBody.auto_return).toBe('approved');
    expect(capturedBody.notification_url).toBe('https://xdope-api.onrender.com/payment/webhook');
    expect(capturedBody.back_urls.success).toBe('https://xdope.vercel.app/order/success?id=order123');
  });

  test('always redirects to init_point, even with MP_SANDBOX=true (sandbox_init_point is a legacy domain that loops)', async () => {
    process.env.STORE_URL = 'https://xdope.vercel.app';
    process.env.BASE_URL = 'https://xdope-api.onrender.com';
    process.env.MP_SANDBOX = 'true';

    const result = await new MercadoPagoAdapter().initializePayment(ORDER);
    expect(result.redirect_url).toBe('https://mp/init');
  });

  test('MP_SANDBOX=false also uses init_point', async () => {
    process.env.MP_SANDBOX = 'false';

    const result = await new MercadoPagoAdapter().initializePayment(ORDER);
    expect(result.redirect_url).toBe('https://mp/init');
  });

  test('throws instead of returning undefined when MP returns no init_point', async () => {
    process.env.MP_SANDBOX = 'true';
    mockPreferenceResponse = { id: 'pref_1' };

    await expect(new MercadoPagoAdapter().initializePayment(ORDER)).rejects.toThrow(/init_point/);
  });
});

describe('MercadoPagoAdapter — el monto cobrado es exactamente order.total', () => {
  const mpTotal = (b) => b.items.reduce((s, i) => s + i.unit_price * i.quantity, 0) + (b.shipments?.cost || 0);

  beforeEach(() => {
    process.env.STORE_URL = 'https://xdope.com.co';
    process.env.BASE_URL = 'https://api.xdope.com.co';
  });

  test('con envío: shipments.cost suma al total', async () => {
    const order = { _id: 'o2', products: [{ product_id: 'p1', name: 'Hoodie', price: 150000, quantity: 1 }], coupon_total_discount: 0, shipping_total: 9900, total: 159900 };
    await new MercadoPagoAdapter().initializePayment(order);
    expect(capturedBody.shipments).toEqual({ cost: 9900, mode: 'not_specified' });
    expect(mpTotal(capturedBody)).toBe(159900);
  });

  test('con cupón: ítem consolidado con el descuento ya aplicado', async () => {
    const order = { _id: 'o3', products: [{ product_id: 'p1', name: 'Hoodie', price: 150000, quantity: 1 }], coupon_code: 'HOODIE10', coupon_total_discount: 15000, shipping_total: 9900, total: 144900 };
    await new MercadoPagoAdapter().initializePayment(order);
    expect(capturedBody.items).toHaveLength(1);
    expect(capturedBody.items[0].unit_price).toBe(135000);
    expect(capturedBody.items[0].title).toContain('HOODIE10');
    expect(mpTotal(capturedBody)).toBe(144900);
  });

  test('sin cupón: productos itemizados tal cual', async () => {
    const order = { _id: 'o4', products: [{ product_id: 'p1', name: 'Hoodie A', price: 120000, quantity: 2 }, { product_id: 'p2', name: 'Hoodie B', price: 90000, quantity: 1 }], coupon_total_discount: 0, shipping_total: 0, total: 330000 };
    await new MercadoPagoAdapter().initializePayment(order);
    expect(capturedBody.items).toHaveLength(2);
    expect(mpTotal(capturedBody)).toBe(330000);
  });

  test('guardia: un total inconsistente bloquea el pago', async () => {
    const order = { _id: 'o5', products: [{ product_id: 'p1', name: 'Hoodie', price: 150000, quantity: 1 }], coupon_total_discount: 0, shipping_total: 9900, total: 999999 };
    await expect(new MercadoPagoAdapter().initializePayment(order)).rejects.toThrow(/inconsistente/);
  });
});
