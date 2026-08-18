/**
 * /sync/cart route tests
 *
 * Locks in the contract fixed when the storefront started sending its guest
 * cart on login: the body is accepted under either `cart` or `items` so a
 * mismatch between the two never silently no-ops the merge again.
 */

const request = require('supertest');

describe('POST /sync/cart', () => {
  let app;
  const Cart = {
    findOne: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn(),
  };
  const Product = { findById: jest.fn() };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Cart', () => Cart);
    jest.doMock('../src/models/Product', () => Product);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/', modulePath: '../src/routes/cart.sync.routes' }]);
  });

  beforeEach(() => {
    Cart.findOne.mockReset();
    Cart.create.mockReset();
    Cart.find.mockReset();
    Cart.deleteMany.mockReset();
    Product.findById.mockReset();

    // Return a viable product for every lookup the route may do
    Product.findById.mockImplementation(async (id) => ({
      _id: id,
      sale_price: 100,
      price: 100,
    }));

    // The route post-processes by re-listing items + computing total
    Cart.find.mockReturnValue({
      populate: () => ({
        then: (resolve) => resolve([]),
      }),
    });
    // Allow `for await ... of items.map(i => i.toJSON ? ...)` shape — getCartItems
    // returns items.map(...) where each item has toJSON. We just return empty.
  });

  test('accepts the payload under the `cart` key (canonical contract)', async () => {
    const payload = {
      cart: [
        { product_id: 'p1', variation_id: '', quantity: 2 },
      ],
    };

    // Existing lookup returns null → create path
    Cart.findOne.mockResolvedValue(null);

    const res = await request(app).post('/sync/cart').send(payload);

    expect(res.status).toBe(200);
    expect(Product.findById).toHaveBeenCalledWith('p1');
    expect(Cart.create).toHaveBeenCalledTimes(1);
    expect(Cart.create).toHaveBeenCalledWith(expect.objectContaining({
      product_id: 'p1',
      quantity: 2,
      sub_total: 200,
    }));
  });

  test('accepts the same payload under the legacy `items` key', async () => {
    const payload = {
      items: [
        { product_id: 'p2', quantity: 3 },
      ],
    };
    Cart.findOne.mockResolvedValue(null);

    const res = await request(app).post('/sync/cart').send(payload);

    expect(res.status).toBe(200);
    expect(Cart.create).toHaveBeenCalledWith(expect.objectContaining({
      product_id: 'p2',
      quantity: 3,
    }));
  });

  test('merges quantity by taking max() when the item already exists in the user cart', async () => {
    const existing = { quantity: 1, sub_total: 100, save: jest.fn() };
    Cart.findOne.mockResolvedValue(existing);

    await request(app).post('/sync/cart').send({
      cart: [{ product_id: 'p3', quantity: 5 }],
    });

    expect(existing.quantity).toBe(5); // max(1, 5)
    expect(existing.sub_total).toBe(500);
    expect(existing.save).toHaveBeenCalled();
    expect(Cart.create).not.toHaveBeenCalled();
  });

  test('uses the selected variation price when synchronizing a guest cart', async () => {
    Product.findById.mockResolvedValue({
      _id: 'p-variable',
      price: 200,
      sale_price: 150,
      variations: [
        { _id: 'variation-red', price: 120, sale_price: 80 },
      ],
    });
    Cart.findOne.mockResolvedValue(null);

    const res = await request(app).post('/sync/cart').send({
      cart: [{ product_id: 'p-variable', variation_id: 'variation-red', quantity: 2 }],
    });

    expect(res.status).toBe(200);
    expect(Cart.create).toHaveBeenCalledWith(expect.objectContaining({
      product_id: 'p-variable',
      variation_id: 'variation-red',
      quantity: 2,
      sub_total: 160,
    }));
  });

  test('uses the selected variation price when replacing a cart variation', async () => {
    Product.findById.mockResolvedValue({
      _id: 'p-variable',
      price: 200,
      sale_price: 150,
      variations: [
        { _id: 'variation-blue', price: 110, sale_price: 75 },
      ],
    });
    Cart.findOne.mockResolvedValue(null);

    const res = await request(app).post('/replace/cart').send({
      product_id: 'p-variable',
      variation_id: 'variation-blue',
      quantity: 3,
    });

    expect(res.status).toBe(200);
    expect(Cart.create).toHaveBeenCalledWith(expect.objectContaining({
      product_id: 'p-variable',
      variation_id: 'variation-blue',
      quantity: 3,
      sub_total: 225,
    }));
  });

  test('skips items whose product no longer exists rather than throwing', async () => {
    Product.findById.mockResolvedValue(null);

    const res = await request(app).post('/sync/cart').send({
      cart: [{ product_id: 'gone', quantity: 1 }],
    });

    expect(res.status).toBe(200);
    expect(Cart.create).not.toHaveBeenCalled();
  });

  test('is a no-op when neither key is provided', async () => {
    const res = await request(app).post('/sync/cart').send({});
    expect(res.status).toBe(200);
    expect(Cart.create).not.toHaveBeenCalled();
  });

  test('clears every cart line for the signed-in user', async () => {
    Cart.deleteMany.mockResolvedValue({ deletedCount: 3 });

    const res = await request(app).delete('/clear/cart');

    expect(res.status).toBe(200);
    expect(Cart.deleteMany).toHaveBeenCalledWith({ consumer_id: '64b0000000000000000000a1' });
    expect(res.body).toEqual(expect.objectContaining({ items: [], total: 0 }));
  });
});
