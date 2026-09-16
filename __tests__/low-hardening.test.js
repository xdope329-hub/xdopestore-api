/**
 * Hallazgos de severidad baja de la revisión de seguridad:
 *  - GET /settings no entrega credenciales a anónimos ni clientes;
 *  - el catálogo de cupones es de administración y los clientes solo ven
 *    una vista recortada de los vigentes;
 *  - crear reseñas no acepta campos internos por asignación masiva;
 *  - el payload crudo de la pasarela no llega a los clientes;
 *  - CORS solo confía en los proyectos de Vercel conocidos.
 * Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');
const { redactSettingValues, redactSettingsFor } = require('../src/utils/settingsRedaction');
const { buildAllowedOrigins, parseOriginList } = require('../src/utils/corsOrigins');

const id = (n) => n.toString(16).padStart(24, '0');
const ME = '64b0000000000000000000a1';
const chain = (doc) => ({ populate() { return this; }, skip() { return this; }, limit() { return this; }, sort() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

describe('settings: redacción para no administradores', () => {
  const values = {
    general: { site_name: 'XDOPE' },
    activation: { guest_checkout: true },
    payment_methods: [{ name: 'mercadopago', status: true }],
    maintenance: { maintenance_mode: false, maintenance_password: 'shh' },
    email: { smtp_password: 'secret' },
    payment_method: { mercadopago: { access_token: 'APP_USR-secret' } },
    sms_configuration: { token: 'x' },
    google_recaptcha: { secret_key: 'y' },
    google_map_key: 'z',
    google_analytics: { measurement_id: 'G-1' },
  };

  test('quita credenciales y deja lo que el storefront necesita', () => {
    const out = redactSettingValues(values);
    expect(out.email).toBeUndefined();
    expect(out.payment_method).toBeUndefined();
    expect(out.sms_configuration).toBeUndefined();
    expect(out.google_recaptcha).toBeUndefined();
    expect(out.google_map_key).toBeUndefined();
    expect(out.maintenance).toEqual({ maintenance_mode: false });
    expect(out.general).toEqual({ site_name: 'XDOPE' });
    expect(out.activation).toEqual({ guest_checkout: true });
    expect(out.payment_methods).toHaveLength(1);
    expect(out.google_analytics).toEqual({ measurement_id: 'G-1' });
  });

  test('el administrador recibe el documento completo; el anónimo no', () => {
    const setting = { _id: id(1), values };
    expect(redactSettingsFor({ role: { name: 'admin', system_reserve: '1' } }, setting).values.email).toBeDefined();
    expect(redactSettingsFor(null, setting).values.email).toBeUndefined();
    expect(redactSettingsFor({ role: { name: 'consumer' } }, setting).values.payment_method).toBeUndefined();
  });
});

describe('cupones: vista de cliente vs catálogo', () => {
  const coupons = [
    { _id: id(10), id: id(10), title: 'Bienvenida', description: '15%', code: 'BIENVENIDO15', type: 'percentage', amount: 15, min_spend: 0, status: 1, is_expired: false, usage_per_coupon: 100, used: 7, is_first_order: true },
  ];
  const Coupon = { find: jest.fn(() => chain(coupons)), countDocuments: jest.fn(async () => 1), findById: jest.fn(async () => coupons[0]) };

  const build = (role) => {
    jest.resetModules();
    jest.doMock('../src/models/Coupon', () => Coupon);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth(role);
    return buildApp([{ prefix: '/coupon', modulePath: '../src/routes/coupon.routes' }]);
  };

  test('cliente: /coupon/public sin límites ni contadores; /coupon → 403', async () => {
    const app = build('consumer');
    const pub = await request(app).get('/coupon/public');
    expect(pub.status).toBe(200);
    expect(pub.body.data[0]).toEqual({ id: id(10), title: 'Bienvenida', description: '15%', code: 'BIENVENIDO15', type: 'percentage', amount: 15, min_spend: 0 });
    expect(pub.body.data[0].usage_per_coupon).toBeUndefined();
    expect((await request(app).get('/coupon')).status).toBe(403);
    expect((await request(app).get(`/coupon/${id(10)}`)).status).toBe(403);
  });

  test('administrador: catálogo completo', async () => {
    const app = build('admin');
    const res = await request(app).get('/coupon');
    expect(res.status).toBe(200);
    expect(res.body.data[0].usage_per_coupon).toBe(100);
  });
});

describe('reseñas: sin asignación masiva', () => {
  test('status y consumer_id del body se ignoran', async () => {
    jest.resetModules();
    const Review = { create: jest.fn(async (d) => ({ _id: id(5), ...d })), findOne: jest.fn(async () => null) };
    jest.doMock('../src/models/Review', () => Review);
    jest.doMock('../src/models/OrderStatus', () => ({ findOne: jest.fn(async () => ({ _id: id(9) })) }));
    // findOne cubre la compra entregada y la línea aún sin calificar; updateMany
    // es la marca products[].reviewed_at que deja la reseña creada.
    jest.doMock('../src/models/Order', () => ({ findOne: jest.fn(async () => ({ _id: id(8) })), updateMany: jest.fn(async () => ({ modifiedCount: 1 })) }));
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    const app = buildApp([{ prefix: '/review', modulePath: '../src/routes/review.routes' }]);
    const res = await request(app).post('/review').send({ product_id: id(1), rating: 5, description: 'Genial', status: 1, consumer_id: id(7), is_approved: true });
    expect(res.status).toBe(201);
    // El estado siempre nace en pendiente (0), diga lo que diga el body.
    expect(Review.create).toHaveBeenCalledWith({ product_id: id(1), rating: 5, description: 'Genial', review_image_id: undefined, consumer_id: ME, status: 0 });
  });
});

describe('pedidos: el payload de la pasarela no llega al cliente', () => {
  const order = {
    _id: id(100), consumer_id: { _id: ME }, products: [], status_id: null,
    payment_status: 'completed', payment_gateway_response: { card: 'xxxx' }, payment_error: null, payment_gateway_status: 'approved',
    toJSON() { const { toJSON, ...rest } = this; return { ...rest }; },
  };
  const build = (role) => {
    jest.resetModules();
    jest.doMock('../src/models/Order', () => ({ find: jest.fn(() => chain([order])), countDocuments: jest.fn(async () => 1), findById: jest.fn(() => chain(order)) }));
    jest.doMock('../src/models/OrderStatus', () => ({ findOne: jest.fn(async () => null), find: jest.fn(async () => []) }));
    jest.doMock('../src/models/Cart', () => ({}));
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth(role);
    return buildApp([{ prefix: '/order', modulePath: '../src/routes/order.routes' }]);
  };

  test('cliente: sin campos de la pasarela en lista y detalle', async () => {
    const app = build('consumer');
    const list = await request(app).get('/order');
    expect(list.status).toBe(200);
    expect(list.body.data[0].payment_status).toBe('completed');
    expect(list.body.data[0].payment_gateway_response).toBeUndefined();
    expect(list.body.data[0].payment_gateway_status).toBeUndefined();
    const detail = await request(app).get(`/order/${id(100)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.payment_gateway_response).toBeUndefined();
  });

  test('administrador: los ve', async () => {
    const app = build('admin');
    const detail = await request(app).get(`/order/${id(100)}`);
    expect(detail.body.payment_gateway_response).toEqual({ card: 'xxxx' });
  });
});

describe('CORS: solo proyectos conocidos de Vercel', () => {
  test('previews y producción de la tienda y el admin, nada más', () => {
    const { isAllowed } = buildAllowedOrigins({});
    expect(isAllowed('https://xdopestore-xdope-s-projects.vercel.app')).toBe(true);
    expect(isAllowed('https://xdopestore-abc123-xdope-s-projects.vercel.app')).toBe(true);
    expect(isAllowed('https://admin-dashboard-git-main-xdope-s-projects.vercel.app')).toBe(true);
    expect(isAllowed('https://evil-xdope-s-projects.vercel.app')).toBe(false);
    expect(isAllowed('https://xdopestore-xdope-s-projects.vercel.app.attacker.com')).toBe(false);
    expect(isAllowed('http://localhost:3001')).toBe(true);
    expect(isAllowed('http://localhost:9999')).toBe(false);
  });

  test('orígenes configurados se validan como URLs y se respeta VERCEL_PROJECTS', () => {
    const { isAllowed, list } = buildAllowedOrigins({ FRONTEND_URL: 'https://xdope.com.co', CORS_ORIGINS: 'https://admin.xdope.com.co, not a url, https://x.com/path', VERCEL_PROJECTS: 'tienda' });
    expect(isAllowed('https://xdope.com.co')).toBe(true);
    expect(isAllowed('https://admin.xdope.com.co')).toBe(true);
    expect(list).not.toContain('not a url');
    expect(isAllowed('https://tienda-xdope-s-projects.vercel.app')).toBe(true);
    expect(isAllowed('https://xdopestore-xdope-s-projects.vercel.app')).toBe(false);
    expect(parseOriginList('https://a.com,https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });
});
