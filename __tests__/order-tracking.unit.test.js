/**
 * Reglas puras del seguimiento público de pedidos (src/utils/orderTracking.js).
 * Sin base de datos.
 */

const { orderMatchesContact } = require('../src/utils/orderTracking');

const guestOrder = {
  guest_email: 'Invitado.E2E@example.com',
  consumer_id: null,
  shipping_address: { phone: '3105550199', country_code: '57' },
  billing_address: { phone: '(601) 555-0147', country_code: '57' },
};

const accountOrder = {
  guest_email: null,
  consumer_id: { email: 'isabella@xdope.com', phone: '+57 310 555 0147' },
  shipping_address: { phone: '3001112233', country_code: '57' },
};

describe('correo', () => {
  test('coincide sin distinguir mayúsculas ni espacios', () => {
    expect(orderMatchesContact(guestOrder, '  invitado.e2e@EXAMPLE.com ')).toBe(true);
    expect(orderMatchesContact(accountOrder, 'ISABELLA@xdope.com')).toBe(true);
  });

  test('otro correo no abre el pedido', () => {
    expect(orderMatchesContact(guestOrder, 'otro@example.com')).toBe(false);
    expect(orderMatchesContact(accountOrder, 'invitado.e2e@example.com')).toBe(false);
  });
});

describe('teléfono', () => {
  test('acepta el teléfono de la cuenta o de las direcciones, con o sin indicativo', () => {
    expect(orderMatchesContact(guestOrder, '3105550199')).toBe(true);
    expect(orderMatchesContact(guestOrder, '+57 310 555 0199')).toBe(true);
    expect(orderMatchesContact(guestOrder, '601 555 0147')).toBe(true);
    expect(orderMatchesContact(accountOrder, '3105550147')).toBe(true);
    expect(orderMatchesContact(accountOrder, '57 300 111 2233')).toBe(true);
  });

  test('un teléfono distinto o demasiado corto no abre el pedido', () => {
    expect(orderMatchesContact(guestOrder, '3000000000')).toBe(false);
    expect(orderMatchesContact(guestOrder, '0199')).toBe(false);
    expect(orderMatchesContact(guestOrder, '57')).toBe(false);
  });
});

describe('entradas vacías', () => {
  test('sin contacto, sin pedido o sin datos del comprador → falso', () => {
    expect(orderMatchesContact(guestOrder, '')).toBe(false);
    expect(orderMatchesContact(guestOrder, undefined)).toBe(false);
    expect(orderMatchesContact(null, 'invitado.e2e@example.com')).toBe(false);
    expect(orderMatchesContact({}, 'invitado.e2e@example.com')).toBe(false);
    expect(orderMatchesContact({}, '3105550199')).toBe(false);
  });
});
