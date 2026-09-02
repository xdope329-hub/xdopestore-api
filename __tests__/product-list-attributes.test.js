/**
 * GET /product must resolve the attribute catalog for products that have no
 * linked `attributes_ids`, exactly like the product page does. Otherwise the
 * fallback derived from variations hard-codes style "rectangle": the same
 * "Color" attribute showed as text buttons on some home cards and as color
 * circles on others. No database needed.
 */

process.env.JWT_SECRET = 'a1234567890bcdefa1234567890bcdefa1234567890bcdefa1234567890bcdef';

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');

const makeQuery = (result) => {
  const query = {
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    sort: jest.fn(() => query),
    populate: jest.fn(() => query),
    lean: jest.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

// Catalog: "Color" is configured as color swatches, "Talla" as rectangles.
const COLOR_ATTR = { _id: id(1), id: id(1), name: 'Color', style: 'color', attribute_values: [{ _id: id(11), id: id(11), value: 'Cafe', hex_color: '#6f4e37' }, { _id: id(12), id: id(12), value: 'Beige', hex_color: '#f5f5dc' }] };
const SIZE_ATTR = { _id: id(2), id: id(2), name: 'Talla', style: 'rectangle', attribute_values: [{ _id: id(21), id: id(21), value: 'M' }] };

// Product WITHOUT linked attributes: only its variations know the values.
const unlinked = {
  _id: id(100), id: id(100), name: 'RinRin', slug: 'rinrin', product_images: [], attributes_ids: [],
  variations: [
    { _id: id(200), id: id(200), name: 'Cafe/M', attribute_values: [{ id: id(11), name: 'Color', value: 'Cafe', attribute_id: id(1) }, { id: id(21), name: 'Talla', value: 'M', attribute_id: id(2) }], variation_images: [] },
    { _id: id(201), id: id(201), name: 'Beige/M', attribute_values: [{ id: id(12), name: 'Color', value: 'Beige', attribute_id: id(1) }, { id: id(21), name: 'Talla', value: 'M', attribute_id: id(2) }], variation_images: [] },
  ],
};
// Product WITH linked attributes keeps them untouched.
const linked = { _id: id(101), id: id(101), name: 'Caballero', slug: 'caballero', product_images: [], attributes_ids: [COLOR_ATTR], variations: [] };

describe('GET /product resolves the attribute catalog for every card', () => {
  let app;
  const Product = { countDocuments: jest.fn(), find: jest.fn() };
  const Review = { aggregate: jest.fn() };
  const Attribute = { find: jest.fn() };

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
    Product.countDocuments.mockReset().mockResolvedValue(2);
    Product.find.mockReset().mockReturnValue(makeQuery([unlinked, linked]));
    Review.aggregate.mockReset().mockResolvedValue([]);
    Attribute.find.mockReset().mockResolvedValue([COLOR_ATTR, SIZE_ATTR]);
  });

  test('unlinked product gets the catalog style and hex colors (one query for the whole page)', async () => {
    const res = await request(app).get('/product?paginate=1');
    expect(res.status).toBe(200);
    expect(Attribute.find).toHaveBeenCalledTimes(1);

    const rinrin = res.body.data.find((p) => p.slug === 'rinrin');
    const color = rinrin.attributes.find((a) => a.name === 'Color');
    expect(color.style).toBe('color');
    expect(color.attribute_values.map((v) => v.hex_color)).toEqual(['#6f4e37', '#f5f5dc']);
    expect(rinrin.attributes.find((a) => a.name === 'Talla').style).toBe('rectangle');
  });

  test('both products expose the same style for "Color"', async () => {
    const res = await request(app).get('/product?paginate=1');
    const styles = res.body.data.map((p) => p.attributes.find((a) => a.name === 'Color')?.style);
    expect(styles).toEqual(['color', 'color']);
  });

  test('no catalog match keeps the derived fallback (no crash)', async () => {
    Attribute.find.mockResolvedValue([]);
    const res = await request(app).get('/product?paginate=1');
    expect(res.status).toBe(200);
    const rinrin = res.body.data.find((p) => p.slug === 'rinrin');
    expect(rinrin.attributes.find((a) => a.name === 'Color').style).toBe('rectangle');
  });
});
