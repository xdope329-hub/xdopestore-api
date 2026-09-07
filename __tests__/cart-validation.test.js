/**
 * POST /cart (routes/cart.routes.js): un product_id vacío o inválido es una
 * petición inválida (422). Antes llegaba a Mongoose y reventaba con un
 * CastError (500) cuando la ficha de producto no había cargado. Sin base
 * de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

describe('POST /cart', () => {
  let app;
  const Product = { findById: jest.fn() };
  const Cart = { findOne: jest.fn(), create: jest.fn(), find: jest.fn() };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Product', () => Product);
    jest.doMock('../src/models/Cart', () => Cart);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/cart', modulePath: '../src/routes/cart.routes' }]);
  });

  beforeEach(() => {
    Product.findById.mockReset();
  });

  test('id vacío o inválido → 422 sin consultar la base de datos', async () => {
    for (const bad of ['', 'nope', 123]) {
      const res = await request(app).post('/cart').send({ product_id: bad, quantity: 1 });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Producto inválido/);
    }
    const res = await request(app).post('/cart').send({ quantity: 1 });
    expect(res.status).toBe(422);
    expect(Product.findById).not.toHaveBeenCalled();
  });

  test('producto inexistente → 404', async () => {
    Product.findById.mockResolvedValue(null);
    const res = await request(app).post('/cart').send({ product_id: '64b0000000000000000000a1', quantity: 1 });
    expect(res.status).toBe(404);
  });
});

describe('Product schema', () => {
  test('guarda la imagen SEO (product_meta_image_id) que envía el admin', () => {
    // El bloque anterior simuló el modelo con jest.doMock; aquí hace falta el real.
    const Product = jest.requireActual('../src/models/Product');
    expect(Product.schema.path('product_meta_image_id')).toBeDefined();
    expect(Product.schema.path('product_meta_image_id').options.ref).toBe('Attachment');
  });
});
