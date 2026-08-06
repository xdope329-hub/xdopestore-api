process.env.JWT_SECRET = 'a1234567890bcdefa1234567890bcdefa1234567890bcdefa1234567890bcdef';

const productRouter = require('../src/routes/product.routes');

describe('product list ID filtering', () => {
  test('keeps explicit ID filtering for normal storefront requests', async () => {
    const ids = '64b000000000000000000001,64b000000000000000000002';

    const filter = await productRouter.buildFilter({ ids, status: '1' });

    expect(filter).toEqual({
      status: 1,
      _id: { $in: ids.split(',') },
    });
  });

  test('does not let stale saved IDs hide current admin picker options', async () => {
    const filter = await productRouter.buildFilter({
      ids: '64b000000000000000000099',
      status: '1',
      with_union_products: '1',
    });

    expect(filter).toEqual({ status: 1 });
  });
});
