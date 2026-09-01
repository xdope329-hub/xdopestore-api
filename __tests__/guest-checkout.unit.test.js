/**
 * Checkout de invitados — comprar sin cuenta.
 *
 * Cubre: reconstrucción del carrito en el servidor (precios desde la BD,
 * nunca del cliente), nombre/correo obligatorios, creación de la orden con
 * campos de invitado y totales del servidor (cupón + envío por zona), verify
 * sin sesión para órdenes de invitado, y que el carrito del servidor no se
 * toca en pedidos COD de invitados.
 */

const request = require('supertest');

const hoodie = { _id: 'p1', name: 'Hoodie Negro', price: 150000, sale_price: 0, status: 1, variations: [{ _id: 'v1', name: 'Negro/M', price: 150000, sale_price: 140000 }] };

describe('guest checkout', () => {
  let app;
  let createdOrder;
  const Order = {
    countDocuments: jest.fn(async () => 0),
    create: jest.fn(async (doc) => { createdOrder = doc; return { _id: 'o1', ...doc }; }),
    findByIdAndUpdate: jest.fn(async () => ({})),
    findById: jest.fn(() => ({ populate: async () => ({ _id: 'o1', consumer_id: null, payment_status: 'completed', status_id: { slug: 'processing' } }) })),
  };
  const Cart = {
    find: jest.fn(() => ({ populate: async () => [] })),
    deleteMany: jest.fn(async () => { throw new Error('no debe limpiar carrito de invitado'); }),
  };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Product', () => ({ find: async () => [hoodie] }));
    jest.doMock('../src/models/Coupon', () => ({
      findOne: async ({ code }) => (code === 'HOODIE10' ? { code: 'HOODIE10', status: 1, type: 'percentage', amount: 10, is_unlimited: true, used: 0 } : null),
      updateOne: async () => {},
    }));
    jest.doMock('../src/models/Order', () => Order);
    jest.doMock('../src/models/Cart', () => Cart);
    jest.doMock('../src/models/Shipping', () => ({ findOne: async () => ({ status: 1, zones: [{ zone: 1, amount: 9900 }, { zone: 2, amount: 14900 }], free_shipping_threshold: 200000 }) }));
    jest.doMock('../src/models/Address', () => ({ findOne: async () => null, countDocuments: async () => 0, create: async (d) => d }));
    jest.doMock('../src/models/OrderStatus', () => ({ findOne: async () => ({ _id: 'st', slug: 'pending' }) }));
    // Invitado: sin sesión — optionalAuth debe dejar pasar con req.user = null
    jest.doMock('../src/middleware/optionalAuth', () => (req, _res, next) => { req.user = null; next(); });
    jest.doMock('../src/services/payment/PaymentFactory', () => ({ getGateway: () => ({ initializePayment: async () => ({ success: true }), verifyPayment: async () => ({ status: 'approved' }) }) }));
    const { buildApp } = require('./_support/helpers');
    app = buildApp([
      { prefix: '/checkout', modulePath: '../src/routes/checkout.routes' },
      { prefix: '/payment', modulePath: '../src/routes/payment.routes' },
    ]);
  });

  beforeEach(() => { createdOrder = undefined; });

  test('vista previa: precios reconstruidos desde la BD, no del cliente', async () => {
    const res = await request(app).post('/checkout').send({
      products: [{ product_id: 'p1', variation_id: 'v1', quantity: 2, sub_total: 2 }],
      city: 'Bogotá',
    });
    // 2 × 140.000 (precio real de la variación) = 280.000 ≥ umbral → envío gratis
    expect(res.body).toMatchObject({ sub_total: 280000, shipping_total: 0, total: 280000 });
  });

  test('pedido sin nombre/correo → 422', async () => {
    const res = await request(app).post('/payment/initialize').send({
      payment_method: 'cod',
      products: [{ product_id: 'p1', quantity: 1 }],
      shipping_address: { city: 'Bogotá', street: 'x' },
    });
    expect(res.status).toBe(422);
  });

  test('pedido de invitado: totales del servidor + campos de invitado', async () => {
    const res = await request(app).post('/payment/initialize').send({
      payment_method: 'cod', name: 'Oscar', email: 'oscar@test.com', coupon_code: 'HOODIE10',
      products: [{ product_id: 'p1', variation_id: 'v1', quantity: 1, price: 1 }],
      shipping_address: { city: 'Leticia', street: 'Calle 1' },
    });
    expect([200, 201]).toContain(res.status);
    // 140.000 − 14.000 (10%) + 14.900 (Zona 2) = 140.900
    expect(createdOrder).toMatchObject({ total: 140900, is_guest: true, guest_email: 'oscar@test.com', consumer_id: null });
    // COD de invitado: NUNCA toca el carrito del servidor
    expect(Cart.deleteMany).not.toHaveBeenCalled();
  });

  test('verify de orden de invitado sin sesión → 200', async () => {
    const res = await request(app).get('/payment/verify/o1');
    expect(res.status).toBe(200);
    expect(res.body.payment_status).toBe('completed');
  });
});
