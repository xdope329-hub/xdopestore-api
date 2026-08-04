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

jest.mock('mercadopago', () => ({
  MercadoPagoConfig: jest.fn().mockImplementation(() => ({})),
  Preference: jest.fn().mockImplementation(() => ({
    create: async ({ body }) => {
      capturedBody = body;
      return { id: 'pref_1', init_point: 'https://mp/init', sandbox_init_point: 'https://mp/sandbox' };
    },
  })),
  Payment: jest.fn(),
}));

const MercadoPagoAdapter = require('../src/services/payment/adapters/MercadoPagoAdapter');

const ORDER = {
  _id: 'order123',
  products: [{ product_id: 'p1', name: 'Producto', quantity: 1, price: 1000 }],
};

const ENV_KEYS = ['STORE_URL', 'BASE_URL', 'MP_ACCESS_TOKEN', 'MP_SANDBOX'];
const savedEnv = {};

beforeAll(() => ENV_KEYS.forEach((k) => (savedEnv[k] = process.env[k])));
afterAll(() => ENV_KEYS.forEach((k) => (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k]))));

beforeEach(() => {
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

  test('sandbox flag picks sandbox_init_point', async () => {
    process.env.STORE_URL = 'https://xdope.vercel.app';
    process.env.BASE_URL = 'https://xdope-api.onrender.com';
    process.env.MP_SANDBOX = 'true';

    const result = await new MercadoPagoAdapter().initializePayment(ORDER);
    expect(result.redirect_url).toBe('https://mp/sandbox');
  });
});
