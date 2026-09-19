/**
 * Meta CAPI: eventId estable, user_data hasheado y payload de Purchase.
 * Sin base de datos ni red — el modulo se construye contra un pedido plain.
 */

const { purchaseEventId } = require('../src/services/meta/eventId');
const { buildUserData } = require('../src/services/meta/userData');
const { buildPurchaseEvent, buildContents, buildContentIds } = require('../src/services/meta/purchase');
const { hashEmail } = require('../src/services/meta/hash');

describe('meta: purchaseEventId', () => {
  test('estable y determinista por orderId', () => {
    expect(purchaseEventId('507f1f77bcf86cd799439011')).toBe('purchase_507f1f77bcf86cd799439011');
    expect(purchaseEventId('507f1f77bcf86cd799439011')).toBe(purchaseEventId('507f1f77bcf86cd799439011'));
    expect(purchaseEventId('a')).not.toBe(purchaseEventId('b'));
  });
});

describe('meta: buildUserData', () => {
  const order = {
    guest_email: 'CLIENT@Example.com  ',
    guest_name: 'Juan Perez Diaz',
    shipping_address: { city: 'Bogota', state: { name: 'Cundinamarca' }, pincode: '110111', country: { name: 'Colombia' }, phone: '3001234567', country_code: '57' },
    meta_fbp: 'fb.1.1234.5678',
    meta_fbc: 'fb.1.9999.zzzz',
    meta_client_ip: '203.0.113.1',
    meta_client_user_agent: 'Mozilla/5.0',
  };
  const ud = buildUserData(order, null);
  test('hashea email normalizado (lowercase+trim)', () => {
    expect(ud.em).toEqual([hashEmail('client@example.com')]);
  });
  test('separa first/last name y los hashea por separado', () => {
    expect(ud.fn).toHaveLength(1);
    expect(ud.ln).toHaveLength(1);
    // No queda nombre en claro en el payload
    for (const v of Object.values(ud)) if (Array.isArray(v)) v.forEach((x) => expect(x).not.toMatch(/juan/i));
  });
  test('fbp/fbc/ip/ua viajan sin hashear', () => {
    expect(ud.fbp).toBe('fb.1.1234.5678');
    expect(ud.fbc).toBe('fb.1.9999.zzzz');
    expect(ud.client_ip_address).toBe('203.0.113.1');
    expect(ud.client_user_agent).toBe('Mozilla/5.0');
  });
});

describe('meta: buildPurchaseEvent', () => {
  const order = {
    _id: '507f1f77bcf86cd799439011',
    payment_completed_at: new Date('2026-01-15T10:00:00Z'),
    total: 189000,
    products: [
      { product_id: 'p1', variation_id: 'v1', quantity: 2, price: 89500, sku: 'HD-BLK-M' },
      { product_id: 'p2', quantity: 1, price: 10000 },
    ],
    shipping_address: { city: 'Medellin', country: { name: 'Colombia' } },
  };
  const evt = buildPurchaseEvent(order, null);
  test('event_id compartido con browser', () => {
    expect(evt.event_id).toBe('purchase_507f1f77bcf86cd799439011');
  });
  test('event_name Purchase, action_source website', () => {
    expect(evt.event_name).toBe('Purchase');
    expect(evt.action_source).toBe('website');
  });
  test('custom_data usa total del pedido (no recalcula) y moneda COP', () => {
    expect(evt.custom_data.currency).toBe('COP');
    expect(evt.custom_data.value).toBe(189000);
  });
  test('contents prefiere variation_id sobre product_id', () => {
    const cs = buildContents(order);
    expect(cs[0].id).toBe('v1');
    expect(cs[0].quantity).toBe(2);
    expect(cs[0].item_price).toBe(89500);
    expect(cs[1].id).toBe('p2');
  });
  test('content_ids alineado con contents', () => {
    expect(buildContentIds(order)).toEqual(['v1', 'p2']);
    expect(evt.custom_data.num_items).toBe(3);
  });
});
