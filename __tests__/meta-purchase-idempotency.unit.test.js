/**
 * Idempotencia de Purchase CAPI: la primera llamada envia, las siguientes NO.
 * Sin base de datos: se mockean Order.findOneAndUpdate + fetch (Meta).
 */

const path = require('path');

const ORDER_ID = '507f1f77bcf86cd799439012';
const orderDoc = {
  _id: ORDER_ID,
  total: 250000,
  payment_completed_at: new Date('2026-02-01T12:00:00Z'),
  products: [{ product_id: 'p1', variation_id: 'v1', quantity: 1, price: 250000 }],
  shipping_address: { city: 'Cali', country: { name: 'Colombia' } },
  consumer_id: null,
  guest_email: 'g@example.com',
};

describe('meta: maybeSendPurchase (idempotencia)', () => {
  let originalEnv;
  let originalFetch;
  let fetchCalls;

  beforeEach(() => {
    jest.resetModules();
    originalEnv = { ...process.env };
    process.env.META_PIXEL_ID = '1234567890';
    process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
    delete process.env.META_TEST_EVENT_CODE;

    fetchCalls = [];
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url, opts) => {
      fetchCalls.push({ url, opts });
      return {
        ok: true,
        status: 200,
        json: async () => ({ events_received: 1 }),
      };
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.resetModules();
  });

  function mockOrder(state) {
    const orderModulePath = path.resolve(__dirname, '..', 'src', 'models', 'Order.js');
    jest.doMock(orderModulePath, () => ({
      findOneAndUpdate: jest.fn(() => {
        // Mongoose devuelve una Query encadenable; .populate() devuelve otra
        // Query; y hacer `await` sobre la Query resuelve con el documento.
        const doc = state.sent ? null : { ...orderDoc, meta_purchase_sent_at: new Date() };
        if (!state.sent) state.sent = true;
        return {
          populate() { return this; },
          then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); },
        };
      }),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    }));
    return require(orderModulePath);
  }

  test('primer llamado envia, segundo llamado es no-op', async () => {
    const state = { sent: false };
    mockOrder(state);
    const { maybeSendPurchase } = require('../src/services/meta/purchase');

    const r1 = await maybeSendPurchase(ORDER_ID);
    expect(r1.ok).toBe(true);
    expect(r1.event_id).toBe(`purchase_${ORDER_ID}`);
    expect(fetchCalls).toHaveLength(1);

    const r2 = await maybeSendPurchase(ORDER_ID);
    expect(r2.skipped).toBe('already_sent');
    expect(fetchCalls).toHaveLength(1); // no se llamo de nuevo a Meta
  });

  test('sin META_PIXEL_ID o token, no envia y no marca guard', async () => {
    delete process.env.META_PIXEL_ID;
    const state = { sent: false };
    mockOrder(state);
    const { maybeSendPurchase } = require('../src/services/meta/purchase');
    const r = await maybeSendPurchase(ORDER_ID);
    expect(r.skipped).toBe('meta_disabled');
    expect(state.sent).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  test('si Meta responde error, libera el guard para reintento', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: { message: 'bad token' } }),
    }));
    const state = { sent: false };
    const OrderMock = mockOrder(state);
    const { maybeSendPurchase } = require('../src/services/meta/purchase');
    const r = await maybeSendPurchase(ORDER_ID);
    expect(r.ok).toBe(false);
    // Se llamo updateOne para rollback del timestamp.
    expect(OrderMock.updateOne).toHaveBeenCalled();
  });
});
