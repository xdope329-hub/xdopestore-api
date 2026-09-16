/**
 * Orden del listado de productos (GET /product). La tienda manda `sortBy` +
 * `field` (portada y colecciones); el admin manda `sort` + `field` (columna de
 * la tabla). `created_at` ascendente devuelve los productos en el orden en que
 * se agregaron en el admin (portada → "Compra por Categoría"). Antes todos los
 * parámetros se ignoraban y siempre salían los más recientes primero.
 * Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

describe('resolveProductSort', () => {
  const { resolveProductSort } = require('../src/routes/product.routes');

  test('sin parámetros (o inválidos): más recientes primero', () => {
    expect(resolveProductSort({})).toEqual({ createdAt: -1 });
    expect(resolveProductSort({ sort: 'asc', field: '' })).toEqual({ createdAt: -1 });
    expect(resolveProductSort({ sortBy: 'asc', field: 'password' })).toEqual({ createdAt: -1 });
    expect(resolveProductSort({ sortBy: 'sideways', field: 'created_at' })).toEqual({ createdAt: -1 });
    expect(resolveProductSort({ field: 'created_at' })).toEqual({ createdAt: -1 });
  });

  test('created_at ascendente = el orden en que se agregaron los productos', () => {
    expect(resolveProductSort({ sortBy: 'asc', field: 'created_at' })).toEqual({ createdAt: 1 });
    expect(resolveProductSort({ sort: '', sortBy: 'desc', field: 'created_at' })).toEqual({ createdAt: -1 });
    expect(resolveProductSort({ sort: 'ASC', field: 'Created_At' })).toEqual({ createdAt: 1 });
  });

  test('columnas de la tabla del admin', () => {
    expect(resolveProductSort({ sort: 'desc', field: 'name' })).toEqual({ name: -1 });
    expect(resolveProductSort({ sort: 'asc', field: 'sale_price' })).toEqual({ sale_price: 1 });
    expect(resolveProductSort({ sort: 'asc', field: 'sku' })).toEqual({ sku: 1 });
  });

  test('atajos del selector "Ordenar" de la tienda', () => {
    expect(resolveProductSort({ sortBy: 'low-high' })).toEqual({ price: 1 });
    expect(resolveProductSort({ sortBy: 'high-low', field: 'created_at' })).toEqual({ price: -1 });
    expect(resolveProductSort({ sortBy: 'a-z' })).toEqual({ name: 1 });
    expect(resolveProductSort({ sortBy: 'z-a' })).toEqual({ name: -1 });
    expect(resolveProductSort({ sortBy: 'discount-high-low' })).toEqual({ discount: -1 });
  });
});

describe('GET /product aplica el orden pedido', () => {
  let app;
  const Product = { countDocuments: jest.fn(), find: jest.fn() };
  const Review = { aggregate: jest.fn() };
  const Attribute = { find: jest.fn() };
  const makeQuery = () => {
    const query = {
      skip: jest.fn(() => query),
      limit: jest.fn(() => query),
      sort: jest.fn(() => query),
      collation: jest.fn(() => query),
      populate: jest.fn(() => query),
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    };
    return query;
  };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Product', () => Product);
    jest.doMock('../src/models/Review', () => Review);
    jest.doMock('../src/models/Attribute', () => Attribute);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/product', modulePath: '../src/routes/product.routes' }]);
  });

  beforeEach(() => {
    Product.countDocuments.mockReset().mockResolvedValue(0);
    Review.aggregate.mockReset().mockResolvedValue([]);
    Attribute.find.mockReset().mockResolvedValue([]);
  });

  test('la portada pide los productos de la categoría en orden de creación', async () => {
    const query = makeQuery();
    Product.find.mockReturnValue(query);
    const res = await request(app).get('/product').query({ status: 1, paginate: 8, sortBy: 'asc', field: 'created_at' });
    expect(res.status).toBe(200);
    expect(query.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(query.collation).not.toHaveBeenCalled();
  });

  test('sin orden: más recientes primero, como antes', async () => {
    const query = makeQuery();
    Product.find.mockReturnValue(query);
    const res = await request(app).get('/product').query({ status: 1, sort: 'asc', field: '' });
    expect(res.status).toBe(200);
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  test('a-z ordena por nombre sin distinguir mayúsculas', async () => {
    const query = makeQuery();
    Product.find.mockReturnValue(query);
    const res = await request(app).get('/product').query({ status: 1, sortBy: 'a-z', field: 'created_at' });
    expect(res.status).toBe(200);
    expect(query.sort).toHaveBeenCalledWith({ name: 1 });
    expect(query.collation).toHaveBeenCalledWith({ locale: 'es', strength: 2 });
  });
});
