/**
 * Cupones — validación central (couponValidation) + integración con la vista
 * previa (/checkout) y la creación del pedido (/payment/initialize).
 *
 * Reglas cubiertas: código inválido, ventana de fechas, gasto mínimo, límite
 * total de usos, límite por cliente, solo primer pedido; tipos percentage /
 * fixed / free_shipping; el descuento y el envío se recalculan SIEMPRE en el
 * servidor y el uso del cupón se incrementa al crear la orden.
 */

const request = require('supertest');

const now = Date.now();
const COUPONS = () => ({
  HOODIE10: { code: 'HOODIE10', status: 1, type: 'percentage', amount: 10, min_spend: 0, is_unlimited: true, used: 0 },
  FIJO20K: { code: 'FIJO20K', status: 1, type: 'fixed', amount: 20000, min_spend: 100000, is_unlimited: true, used: 0 },
  ENVIOGRATIS: { code: 'ENVIOGRATIS', status: 1, type: 'free_shipping', amount: 0, is_unlimited: true, used: 0 },
  VENCIDO: { code: 'VENCIDO', status: 1, type: 'percentage', amount: 10, end_date: new Date(now - 86400000), is_unlimited: true },
  AGOTADO: { code: 'AGOTADO', status: 1, type: 'percentage', amount: 10, is_unlimited: false, usage_per_coupon: 5, used: 5 },
  PORCLIENTE: { code: 'PORCLIENTE', status: 1, type: 'percentage', amount: 10, is_unlimited: false, usage_per_customer: 1 },
  PRIMERA: { code: 'PRIMERA', status: 1, type: 'percentage', amount: 15, is_first_order: true, is_unlimited: true },
  // Restricciones por producto (pestaña Restricciones del admin).
  SOLOHOODIE: { code: 'SOLOHOODIE', status: 1, type: 'percentage', amount: 50, is_unlimited: true, is_apply_all: false, products: ['p1'] },
  SINJEAN: { code: 'SINJEAN', status: 1, type: 'percentage', amount: 10, is_unlimited: true, is_apply_all: true, exclude_products: ['p2'] },
  SOLOJEAN: { code: 'SOLOJEAN', status: 1, type: 'fixed', amount: 5000, is_unlimited: true, is_apply_all: false, products: ['p2'] },
  MIL: { code: 'MIL', status: 1, type: 'percentage', amount: 150, is_unlimited: true },
});

describe('coupons', () => {
  let app;
  let coupons;
  let couponIncrement;

  const Coupon = {
    findOne: jest.fn(async ({ code }) => coupons[code] || null),
    updateOne: jest.fn(async ({ code }, upd) => { couponIncrement = { code, inc: upd.$inc.used }; }),
  };
  const Order = {
    countDocuments: jest.fn(async (q) => (q.coupon_code ? (q.coupon_code === 'PORCLIENTE' ? 1 : 0) : 1)),
    create: jest.fn(async (doc) => ({ _id: 'order1', ...doc })),
    findByIdAndUpdate: jest.fn(async () => ({})),
  };
  const cartItems = [{ sub_total: 150000, product_id: { _id: 'p1', name: 'Hoodie', price: 150000, variations: [] }, quantity: 1 }];

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Coupon', () => Coupon);
    jest.doMock('../src/models/Order', () => Order);
    jest.doMock('../src/models/Cart', () => ({ find: () => ({ populate: async () => cartItems }), deleteMany: async () => {} }));
    jest.doMock('../src/models/Shipping', () => ({ findOne: async () => ({ status: 1, zones: [{ zone: 1, amount: 9900 }, { zone: 2, amount: 14900 }], free_shipping_threshold: 200000 }) }));
    jest.doMock('../src/models/Address', () => ({ findOne: async () => null, countDocuments: async () => 1, create: async (d) => d }));
    jest.doMock('../src/models/OrderStatus', () => ({ findOne: async () => ({ _id: 'st-pending', slug: 'pending' }) }));
    jest.doMock('../src/services/payment/PaymentFactory', () => ({ getGateway: () => ({ initializePayment: async () => ({ success: true }) }) }));
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([
      { prefix: '/checkout', modulePath: '../src/routes/checkout.routes' },
      { prefix: '/payment', modulePath: '../src/routes/payment.routes' },
    ]);
  });

  beforeEach(() => {
    coupons = COUPONS();
    couponIncrement = null;
  });

  test('porcentaje: 10% de 150.000 → 15.000 y total con envío', async () => {
    const res = await request(app).post('/checkout').send({ coupon_code: 'HOODIE10', city: 'Bogotá' });
    expect(res.body).toMatchObject({ coupon_total_discount: 15000, shipping_total: 9900, total: 144900 });
  });

  test('fijo con gasto mínimo cumplido → aplica completo', async () => {
    const res = await request(app).post('/checkout').send({ coupon_code: 'FIJO20K', city: 'Bogotá' });
    expect(res.body).toMatchObject({ coupon_total_discount: 20000, total: 139900 });
  });

  test('free_shipping → envío 0 incluso en Zona 2', async () => {
    const res = await request(app).post('/checkout').send({ coupon_code: 'ENVIOGRATIS', city: 'Leticia' });
    expect(res.body).toMatchObject({ shipping_total: 0, coupon_total_discount: 0, total: 150000 });
  });

  test.each([
    ['NOEXISTE', 'inválido'],
    ['VENCIDO', 'expiró'],
    ['AGOTADO', 'límite de usos'],
    ['PORCLIENTE', 'máximo de veces'],
    ['PRIMERA', 'primer pedido'],
  ])('%s → 422 con mensaje claro', async (code, msgPart) => {
    const res = await request(app).post('/checkout').send({ coupon_code: code, city: 'Bogotá' });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain(msgPart);
  });

  test('pago: recalcula descuento/envío en servidor, guarda el código e incrementa el uso', async () => {
    const res = await request(app).post('/payment/initialize').send({
      payment_method: 'cod',
      coupon_code: 'HOODIE10',
      coupon_total_discount: 999999, // el cliente miente — debe ignorarse
      shipping_total: 0,
      shipping_address: { city: 'Bogotá', street: 'x' },
    });
    expect([200, 201]).toContain(res.status);
    const created = Order.create.mock.calls[0][0];
    expect(created).toMatchObject({ coupon_total_discount: 15000, coupon_code: 'HOODIE10', shipping_total: 9900, total: 144900 });
    expect(couponIncrement).toEqual({ code: 'HOODIE10', inc: 1 });
  });

  describe('restricción por productos', () => {
    const jean = { sub_total: 50000, product_id: { _id: 'p2', name: 'Jean', price: 50000, variations: [] }, quantity: 1 };
    beforeEach(() => { cartItems.push(jean); });
    afterEach(() => { cartItems.length = 1; });

    test('solo productos incluidos: el porcentaje se aplica a esos productos, no a todo el carrito', async () => {
      const res = await request(app).post('/checkout').send({ coupon_code: 'SOLOHOODIE', city: 'Bogotá' });
      expect(res.status).toBe(200);
      // 50% del hoodie (150.000); el jean (50.000) no entra.
      expect(res.body.coupon_total_discount).toBe(75000);
      expect(res.body.sub_total).toBe(200000);
    });

    test('productos excluidos: se descuenta el resto del carrito', async () => {
      const res = await request(app).post('/checkout').send({ coupon_code: 'SINJEAN', city: 'Bogotá' });
      expect(res.status).toBe(200);
      expect(res.body.coupon_total_discount).toBe(15000);
    });

    test('ningún producto elegible en el carrito → 422', async () => {
      cartItems.length = 1; // solo el hoodie; SOLOJEAN exige el jean
      const res = await request(app).post('/checkout').send({ coupon_code: 'SOLOJEAN', city: 'Bogotá' });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/no aplica a los productos/);
    });
  });

  test('un porcentaje mayor a 100 nunca descuenta más que el subtotal', async () => {
    const res = await request(app).post('/checkout').send({ coupon_code: 'MIL', city: 'Bogotá' });
    expect(res.status).toBe(200);
    expect(res.body.coupon_total_discount).toBe(150000);
    expect(res.body.total).toBe(9900);
  });

  test('invitado: el límite por cliente y "primer pedido" se comprueban por su correo', async () => {
    const { validateCoupon } = require('../src/utils/couponValidation');
    Order.countDocuments.mockClear();
    await expect(validateCoupon('PORCLIENTE', { userId: null, email: 'Ana@Example.com', subtotal: 150000, cartItems })).rejects.toThrow(/máximo de veces/);
    expect(Order.countDocuments).toHaveBeenLastCalledWith({ guest_email: 'ana@example.com', coupon_code: 'PORCLIENTE' });
    await expect(validateCoupon('PRIMERA', { userId: null, email: 'ana@example.com', subtotal: 150000, cartItems })).rejects.toThrow(/primer pedido/);
    // Sin correo (vista previa del invitado antes de escribirlo) no se puede comprobar: se deja pasar y el pago lo valida con el correo.
    await expect(validateCoupon('PRIMERA', { userId: null, subtotal: 150000, cartItems })).resolves.toMatchObject({ discount: 22500 });
  });

  test('pago con cupón inválido → 422 y no crea orden', async () => {
    Order.create.mockClear();
    const res = await request(app).post('/payment/initialize').send({
      payment_method: 'cod', coupon_code: 'VENCIDO', shipping_address: { city: 'Bogotá', street: 'x' },
    });
    expect(res.status).toBe(422);
    expect(Order.create).not.toHaveBeenCalled();
  });
});
