/**
 * Productos relacionados en la ficha (GET /product/:id y /product/slug/:slug).
 * Con "productos relacionados aleatorios" (valor por defecto) la tienda recibe
 * hasta 6 productos activos al azar, primero de las mismas categorías; con la
 * lista elegida en el admin se devuelve tal cual. `cross_sell_products` siempre
 * es la lista guardada. Antes estos campos ni siquiera existían en el esquema,
 * así que la selección del admin se perdía al guardar. Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');
const mongoose = require('mongoose');

const id = (n) => n.toString(16).padStart(24, '0');
const chain = (doc) => {
  const query = {
    populate: jest.fn(() => query),
    sort: jest.fn(() => query),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
  };
  return query;
};
const oid = (n) => new mongoose.Types.ObjectId(id(n));

const baseProduct = (extra = {}) => ({
  _id: oid(1), name: 'Camisa', slug: 'camisa', status: 1,
  categories: [{ _id: oid(10), name: 'Mujer' }], product_images: [], variations: [], attributes_ids: [],
  related_products: [], cross_sell_products: [oid(3)],
  ...extra,
});

function setup({ product, samples = [] }) {
  jest.resetModules();
  const Product = {
    findOne: jest.fn(() => chain(product)),
    aggregate: jest.fn(async () => samples.shift() || []),
  };
  const Review = { find: jest.fn(() => chain([])), findOne: jest.fn(async () => null) };
  jest.doMock('../src/models/Product', () => Product);
  jest.doMock('../src/models/Review', () => Review);
  // Visitante anónimo: no hay consultas de compras ni de reseña propia.
  jest.doMock('../src/middleware/optionalAuth', () => (req, _res, next) => { req.user = null; next(); });
  const { buildApp } = require('./_support/helpers');
  const app = buildApp([{ prefix: '/product', modulePath: '../src/routes/product.routes' }]);
  return { app, Product };
}

describe('productos relacionados', () => {
  test('aleatorios: hasta 6 al azar, primero de las mismas categorías, sin el propio producto', async () => {
    const { app, Product } = setup({
      product: baseProduct({ is_random_related_products: true }),
      samples: [[{ _id: oid(21) }, { _id: oid(22) }], [{ _id: oid(31) }, { _id: oid(32) }, { _id: oid(33) }, { _id: oid(34) }]],
    });
    const res = await request(app).get(`/product/${id(1)}`);
    expect(res.status).toBe(200);
    expect(res.body.is_random_related_products).toBe(true);
    expect(res.body.related_products).toEqual([id(21), id(22), id(31), id(32), id(33), id(34)]);
    expect(res.body.cross_sell_products).toEqual([id(3)]);

    expect(Product.aggregate).toHaveBeenCalledTimes(2);
    const [byCategory] = Product.aggregate.mock.calls[0];
    expect(byCategory[0].$match.status).toBe(1);
    expect(byCategory[0].$match.categories.$in.map(String)).toEqual([id(10)]);
    expect(byCategory[0].$match._id.$nin.map(String)).toEqual([id(1)]);
    expect(byCategory[1]).toEqual({ $sample: { size: 6 } });

    // La segunda muestra completa lo que falta y excluye lo ya elegido.
    const [fillUp] = Product.aggregate.mock.calls[1];
    expect(fillUp[0].$match.categories).toBeUndefined();
    expect(fillUp[0].$match._id.$nin.map(String)).toEqual([id(1), id(21), id(22)]);
    expect(fillUp[1]).toEqual({ $sample: { size: 4 } });
  });

  test('sin categorías se muestrea directamente el catálogo activo', async () => {
    const { app, Product } = setup({
      product: baseProduct({ is_random_related_products: true, categories: [] }),
      samples: [[{ _id: oid(41) }]],
    });
    const res = await request(app).get(`/product/slug/camisa`);
    expect(res.status).toBe(200);
    expect(res.body.related_products).toEqual([id(41)]);
    expect(Product.aggregate).toHaveBeenCalledTimes(1);
    expect(Product.aggregate.mock.calls[0][0][1]).toEqual({ $sample: { size: 6 } });
  });

  test('lista elegida por el admin: se devuelve tal cual y no se sortea nada', async () => {
    const { app, Product } = setup({
      product: baseProduct({ is_random_related_products: false, related_products: [oid(5), oid(6)] }),
    });
    const res = await request(app).get(`/product/${id(1)}`);
    expect(res.status).toBe(200);
    expect(res.body.is_random_related_products).toBe(false);
    expect(res.body.related_products).toEqual([id(5), id(6)]);
    expect(res.body.cross_sell_products).toEqual([id(3)]);
    expect(Product.aggregate).not.toHaveBeenCalled();
  });
});
