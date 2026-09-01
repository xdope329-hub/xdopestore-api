/**
 * Envío por zonas (ciudad → tarifa) — quoteShipping + /shipping endpoints
 * + integración con la vista previa de /checkout.
 *
 * Zona 1: ciudades principales ($9.900 por defecto)
 * Zona 2: resto del país ($14.900 por defecto)
 * Gratis desde free_shipping_threshold ($200.000 por defecto), todas las zonas.
 */

const request = require('supertest');

describe('shipping zones', () => {
  let app;
  let shippingDoc;
  const Shipping = { findOne: jest.fn(async () => shippingDoc) };
  const Coupon = { findOne: jest.fn(async () => null) };
  const Address = { findOne: jest.fn(async ({ _id }) => (_id === 'addr1' ? { city: 'Leticia' } : null)) };
  const cartItems = [{ sub_total: 120000 }, { sub_total: 30000 }];
  const Cart = { find: jest.fn(() => ({ populate: async () => cartItems })) };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Shipping', () => Shipping);
    jest.doMock('../src/models/Coupon', () => Coupon);
    jest.doMock('../src/models/Address', () => Address);
    jest.doMock('../src/models/Cart', () => Cart);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([
      { prefix: '/shipping', modulePath: '../src/routes/shipping.routes' },
      { prefix: '/checkout', modulePath: '../src/routes/checkout.routes' },
    ]);
  });

  beforeEach(() => {
    shippingDoc = {
      status: 1,
      zones: [
        { zone: 1, name: 'Zona 1 — Ciudades principales', amount: 9900 },
        { zone: 2, name: 'Zona 2 — Resto del país', amount: 14900 },
      ],
      free_shipping_threshold: 200000,
    };
  });

  describe('quoteShipping', () => {
    // Requerir DESPUÉS de que el beforeAll externo registre los mocks:
    // jest.doMock solo afecta requires posteriores. Requerirlo al definir el
    // describe traía el modelo Shipping REAL → 10s de buffering de mongoose
    // esperando una base de datos que no existe en los tests.
    let quoteShipping;
    beforeAll(() => { ({ quoteShipping } = require('../src/utils/shippingQuote')); });

    test('ciudad principal → Zona 1', async () => {
      const q = await quoteShipping('Bogotá', 100000);
      expect(q).toMatchObject({ zone: 1, amount: 9900, free_shipping: false });
    });

    test('insensible a tildes y mayúsculas', async () => {
      expect((await quoteShipping('BOGOTA', 1)).zone).toBe(1);
      expect((await quoteShipping('itagui', 1)).zone).toBe(1);
    });

    test('ciudad no listada → Zona 2', async () => {
      const q = await quoteShipping('Mi Pueblo Perdido', 100000);
      expect(q).toMatchObject({ zone: 2, amount: 14900 });
    });

    test('subtotal ≥ umbral → gratis en cualquier zona', async () => {
      const q = await quoteShipping('Leticia', 250000);
      expect(q).toMatchObject({ amount: 0, free_shipping: true });
    });

    test('tarifas y umbral se leen del documento Shipping (editable)', async () => {
      shippingDoc = { status: 1, zones: [{ zone: 1, amount: 5000 }, { zone: 2, amount: 8000 }], free_shipping_threshold: 300000 };
      const q = await quoteShipping('Bogotá', 250000);
      expect(q).toMatchObject({ amount: 5000, free_shipping: false });
    });
  });

  describe('endpoints', () => {
    test('GET /shipping/cities agrupa por departamento con zona', async () => {
      const res = await request(app).get('/shipping/cities');
      expect(res.status).toBe(200);
      const bogota = res.body.data.find((d) => d.department === 'Bogotá D.C.');
      expect(bogota.cities[0]).toMatchObject({ name: 'Bogotá', zone: 1 });
    });

    test('GET /shipping/quote cotiza por ciudad', async () => {
      const res = await request(app).get('/shipping/quote?city=Cali&subtotal=50000');
      expect(res.body).toMatchObject({ zone: 1, amount: 9900 });
    });

    test('POST /checkout suma el envío por ciudad inline', async () => {
      const res = await request(app).post('/checkout').send({ city: 'Pereira' });
      expect(res.body).toMatchObject({ sub_total: 150000, shipping_total: 9900, total: 159900 });
    });

    test('POST /checkout resuelve la ciudad desde la dirección guardada', async () => {
      const res = await request(app).post('/checkout').send({ shipping_address_id: 'addr1' });
      expect(res.body).toMatchObject({ shipping_total: 14900, total: 164900 });
    });

    test('POST /checkout sin ciudad → envío 0', async () => {
      const res = await request(app).post('/checkout').send({});
      expect(res.body.shipping_total).toBe(0);
    });
  });
});
