/**
 * Endurecimiento de autorización y del flujo de recuperación de contraseña:
 *  - cambiar el estado de un pedido, la biblioteca de medios y el borrado de
 *    líneas de carrito ajenas ya no están al alcance de un cliente;
 *  - /trackOrder y /order/invoice/:id solo devuelven pedidos propios;
 *  - el OTP sale de un CSPRNG, se envía por correo, tiene límite de intentos
 *    y /update-password exige el token de un solo uso de /verify-otp.
 * Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const ME = '64b0000000000000000000a1'; // TEST_USER en _support/helpers.js
const OTHER = id(7);
const chain = (doc) => ({ populate() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

describe('autorización: acciones que un cliente ya no puede hacer', () => {
  let app;
  const Cart = { findOneAndDelete: jest.fn(async () => null), findByIdAndDelete: jest.fn(), findOne: jest.fn(async () => null), create: jest.fn(async (d) => d), find: jest.fn(() => ({ populate: async () => [] })) };
  const Order = {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Order', () => Order);
    jest.doMock('../src/models/OrderStatus', () => ({ findOne: jest.fn(async () => null), findById: jest.fn(async () => null), find: jest.fn(async () => []) }));
    jest.doMock('../src/models/Cart', () => Cart);
    jest.doMock('../src/models/Product', () => ({ findById: jest.fn(async () => ({ _id: id(1), price: 1000, variations: [] })), countDocuments: jest.fn(async () => 0) }));
    jest.doMock('../src/models/Attachment', () => ({ find: jest.fn(), findById: jest.fn(), create: jest.fn(), countDocuments: jest.fn() }));
    jest.doMock('../src/middleware/upload', () => ({ multer: { any: () => (req, _res, next) => next() }, cloudinary: {}, ensureCloudinaryConfigured: () => {} }));
    jest.doMock('../src/utils/attachmentUsage', () => ({ getUsedAttachmentIds: jest.fn(async () => ({ usedIds: new Set(), usedUrls: new Set() })) }));
    jest.doMock('../src/services/mail', () => ({ sendOrderStatusUpdate: jest.fn(async () => {}), logMailError: () => () => {} }));
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([
      { prefix: '/order', modulePath: '../src/routes/order.routes' },
      { prefix: '/attachment', modulePath: '../src/routes/attachment.routes' },
      { prefix: '/', modalPath: undefined, modulePath: '../src/routes/cart.sync.routes' },
      { prefix: '/', modulePath: '../src/routes/misc.routes' },
    ]);
  });

  beforeEach(() => {
    Order.findOne.mockReset();
    Order.findById.mockReset();
    Cart.findOneAndDelete.mockClear();
    Cart.findByIdAndDelete.mockClear();
  });

  test('un cliente no puede cambiar el estado de un pedido (PUT/POST /order/:id, POST /order)', async () => {
    expect((await request(app).put(`/order/${id(100)}`).send({ order_status_id: id(2) })).status).toBe(403);
    expect((await request(app).post(`/order/${id(100)}`).send({ _method: 'put', order_status_id: id(2) })).status).toBe(403);
    expect((await request(app).post('/order').send({ order_status_id: id(2) })).status).toBe(403);
    expect(Order.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('la biblioteca de medios es solo para administradores', async () => {
    expect((await request(app).post('/attachment')).status).toBe(403);
    expect((await request(app).get('/attachment')).status).toBe(403);
    expect((await request(app).delete('/attachment/deleteAll').send({ ids: [id(5)] })).status).toBe(403);
    expect((await request(app).delete(`/attachment/${id(5)}`)).status).toBe(403);
  });

  test('/trackOrder: pedido de otro cliente → 404; propio → 200', async () => {
    Order.findOne.mockReturnValueOnce(chain({ order_number: 1000, consumer_id: OTHER, total: 1 }));
    expect((await request(app).get('/trackOrder?order_number=1000')).status).toBe(404);
    Order.findOne.mockReturnValueOnce(chain({ order_number: 1001, consumer_id: ME, total: 1 }));
    expect((await request(app).get('/trackOrder?order_number=1001')).status).toBe(200);
  });

  test('/order/invoice/:id: solo el dueño', async () => {
    Order.findById.mockReturnValueOnce(chain({ _id: id(100), consumer_id: { _id: OTHER } }));
    expect((await request(app).get(`/order/invoice/${id(100)}`)).status).toBe(404);
    Order.findById.mockReturnValueOnce(chain({ _id: id(101), consumer_id: { _id: ME } }));
    expect((await request(app).get(`/order/invoice/${id(101)}`)).status).toBe(200);
  });

  test('reemplazar una línea del carrito solo borra líneas propias', async () => {
    const res = await request(app).put('/replace/cart').send({ id: id(55), product_id: id(1), quantity: 1 });
    expect(res.status).toBeLessThan(500);
    expect(Cart.findByIdAndDelete).not.toHaveBeenCalled();
    expect(Cart.findOneAndDelete).toHaveBeenCalledWith({ _id: id(55), consumer_id: ME });
  });
});

describe('recuperación de contraseña', () => {
  const mail = { sendPasswordResetOTP: jest.fn(async () => {}), logMailError: () => () => {} };
  const refresh = { issueRefreshToken: jest.fn(async () => 'rt'), rotateRefreshToken: jest.fn(), revokeRefreshToken: jest.fn(), revokeAllForUser: jest.fn(async () => {}) };
  let app;
  let user;

  const freshUser = () => ({
    _id: ME, name: 'Ana', email: 'ana@example.com', password: 'hash', status: 1,
    otp: undefined, otp_expires_at: undefined, otp_attempts: 0,
    save: jest.fn(async function () { return this; }),
  });

  const build = ({ realLimiter = false } = {}) => {
    jest.resetModules();
    user = freshUser();
    jest.doMock('../src/models/User', () => ({ findOne: jest.fn(async (q) => (q?.email === user.email ? user : null)), findById: jest.fn(async () => user) }));
    jest.doMock('../src/services/mail', () => mail);
    jest.doMock('../src/config/refreshTokens', () => refresh);
    jest.doMock('../src/config/googleAuth', () => ({ verifyGoogleIdToken: jest.fn() }));
    // Los doMock sobreviven a resetModules: para probar el limitador real
    // hay que retirar explícitamente el mock de paso.
    if (realLimiter) {
      jest.dontMock('../src/middleware/rateLimiters');
    } else {
      const pass = (_req, _res, next) => next();
      jest.doMock('../src/middleware/rateLimiters', () => ({ loginLimiter: pass, registerLimiter: pass, passwordResetLimiter: pass, otpLimiter: pass, refreshLimiter: pass, checkoutLimiter: pass, uploadLimiter: pass, publicFormLimiter: pass }));
    }
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    return buildApp([{ prefix: '/', modulePath: '../src/routes/auth.routes' }]);
  };

  beforeEach(() => {
    mail.sendPasswordResetOTP.mockClear();
    refresh.revokeAllForUser.mockClear();
    app = build();
  });

  test('forgot-password: OTP de 6 dígitos, enviado por correo, contador en cero', async () => {
    const res = await request(app).post('/forgot-password').send({ email: 'ana@example.com' });
    expect(res.status).toBe(200);
    expect(user.otp).toMatch(/^\d{6}$/);
    expect(user.otp_attempts).toBe(0);
    expect(mail.sendPasswordResetOTP).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@example.com', otp: user.otp }));
    // Correo desconocido: misma respuesta, sin correo enviado.
    const other = await request(app).post('/forgot-password').send({ email: 'nadie@example.com' });
    expect(other.status).toBe(200);
    expect(mail.sendPasswordResetOTP).toHaveBeenCalledTimes(1);
  });

  test('verify-otp: 5 intentos fallidos invalidan el código', async () => {
    await request(app).post('/forgot-password').send({ email: 'ana@example.com' });
    const good = user.otp;
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/verify-otp').send({ email: 'ana@example.com', otp: '000000' });
      expect(res.status).toBe(422);
    }
    expect(user.otp).toBeUndefined();
    const late = await request(app).post('/verify-otp').send({ email: 'ana@example.com', otp: good });
    expect(late.status).toBe(422);
  });

  test('verify-otp correcto (también como `token`) → reset_token de un solo uso', async () => {
    await request(app).post('/forgot-password').send({ email: 'ana@example.com' });
    const res = await request(app).post('/verify-otp').send({ email: 'ana@example.com', token: user.otp });
    expect(res.status).toBe(200);
    expect(res.body.reset_token).toMatch(/^[a-f0-9]{64}$/);
    expect(user.password_reset_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(user.password_reset_token_hash).not.toBe(res.body.reset_token);
    expect(user.otp).toBeUndefined();
  });

  test('update-password: sin token → 422; token incorrecto → 422; correcto → cambia y cierra sesiones', async () => {
    await request(app).post('/forgot-password').send({ email: 'ana@example.com' });
    const verified = await request(app).post('/verify-otp').send({ email: 'ana@example.com', otp: user.otp });
    const token = verified.body.reset_token;

    expect((await request(app).post('/update-password').send({ email: 'ana@example.com', password: 'Nueva1234' })).status).toBe(422);
    expect((await request(app).post('/update-password').send({ email: 'ana@example.com', password: 'Nueva1234', reset_token: 'f'.repeat(64) })).status).toBe(422);
    expect(user.password).toBe('hash');

    const ok = await request(app).post('/update-password').send({ email: 'ana@example.com', password: 'Nueva1234', reset_token: token });
    expect(ok.status).toBe(200);
    expect(user.password).toBe('Nueva1234');
    expect(user.password_reset_token_hash).toBeUndefined();
    expect(refresh.revokeAllForUser).toHaveBeenCalledWith(ME);

    // El token es de un solo uso.
    expect((await request(app).post('/update-password').send({ email: 'ana@example.com', password: 'Otra12345', reset_token: token })).status).toBe(422);
  });

  test('limitador real: el intento 11 de verify-otp responde 429', async () => {
    app = build({ realLimiter: true });
    let last;
    for (let i = 0; i < 11; i++) {
      last = await request(app).post('/verify-otp').send({ email: 'ana@example.com', otp: '123456' });
    }
    expect(last.status).toBe(429);
  });
});
