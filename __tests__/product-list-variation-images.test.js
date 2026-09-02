/**
 * GET /product must populate `variations.variation_images` so the storefront
 * product cards can swap the photo when a color/size is picked. Without the
 * populate, transformProduct's `variation_image` alias was a bare ObjectId
 * and the card image never changed.
 */

process.env.JWT_SECRET = 'a1234567890bcdefa1234567890bcdefa1234567890bcdefa1234567890bcdef';

const request = require('supertest');

// Chainable, awaitable stand-in for a Mongoose query.
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

const RED_IMAGE = { _id: '64b0000000000000000000f1', id: '64b0000000000000000000f1', original_url: 'https://cdn.example/red.jpg' };

const product = {
  _id: '64b000000000000000000701',
  id: '64b000000000000000000701',
  name: 'Sudadera',
  slug: 'sudadera',
  product_images: [],
  variations: [
    { _id: '64b000000000000000000801', id: '64b000000000000000000801', name: 'Sudadera - Rojo', attribute_values: [], variation_images: [RED_IMAGE] },
    { _id: '64b000000000000000000802', id: '64b000000000000000000802', name: 'Sudadera - Azul', attribute_values: [], variation_images: [] },
  ],
};

describe('GET /product populates variation images for the storefront cards', () => {
  let app;
  let listQuery;
  const Product = { countDocuments: jest.fn(), find: jest.fn() };
  const Review = { aggregate: jest.fn() };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Product', () => Product);
    jest.doMock('../src/models/Review', () => Review);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/product', modulePath: '../src/routes/product.routes' }]);
  });

  beforeEach(() => {
    listQuery = makeQuery([product]);
    Product.countDocuments.mockReset().mockResolvedValue(1);
    Product.find.mockReset().mockReturnValue(listQuery);
    Review.aggregate.mockReset().mockResolvedValue([]);
  });

  test('asks Mongoose for the variation image attachments', async () => {
    const res = await request(app).get('/product?paginate=1');
    expect(res.status).toBe(200);
    expect(listQuery.populate).toHaveBeenCalledWith('variations.variation_images', 'asset_url original_url');
  });

  test('exposes a usable variation_image (with original_url) per variation', async () => {
    const res = await request(app).get('/product?paginate=1');
    const [first] = res.body.data;
    expect(first.variations[0].variation_image).toEqual(expect.objectContaining({ original_url: 'https://cdn.example/red.jpg' }));
    expect(first.variations[1].variation_image).toBeNull();
  });
});
