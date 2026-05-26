/**
 * /checkout route tests
 *
 * Covers the bug fix that returned 422 "Cart is empty" when an authenticated
 * user with a populated server cart entered the checkout page (root cause
 * was on the storefront side, but the API contract is what the storefront
 * leans on, so we lock its behaviour in here).
 */

const request = require('supertest');

describe('POST /checkout', () => {
  let app;
  const Cart = { find: jest.fn() };
  const Coupon = { findOne: jest.fn() };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Cart', () => Cart);
    jest.doMock('../src/models/Coupon', () => Coupon);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/checkout', modulePath: '../src/routes/checkout.routes' }]);
  });

  beforeEach(() => {
    Cart.find.mockReset();
    Coupon.findOne.mockReset();
  });

  test('returns 422 with "Cart is empty" when the server cart has zero items', async () => {
    Cart.find.mockReturnValue({ populate: () => Promise.resolve([]) });

    const res = await request(app).post('/checkout').send({});

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ message: 'Cart is empty' });
  });

  test('returns totals (subtotal + zero discount + total) when cart has items and no coupon', async () => {
    Cart.find.mockReturnValue({
      populate: () => Promise.resolve([
        { sub_total: 100 },
        { sub_total: 50 },
      ]),
    });

    const res = await request(app).post('/checkout').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sub_total: 150,
      coupon_total_discount: 0,
      shipping_total: 0,
      total: 150,
    });
  });

  test('applies a fixed-amount coupon discount to the total', async () => {
    Cart.find.mockReturnValue({ populate: () => Promise.resolve([{ sub_total: 200 }]) });
    Coupon.findOne.mockResolvedValue({
      code: 'BIENVENIDO15',
      type: 'fixed',
      amount: 15,
      status: 1,
      min_spend: 0,
    });

    const res = await request(app).post('/checkout').send({ coupon_code: 'bienvenido15' });

    expect(res.status).toBe(200);
    expect(res.body.sub_total).toBe(200);
    expect(res.body.coupon_total_discount).toBe(15);
    expect(res.body.total).toBe(185);
    // Coupon lookup must be case-insensitive (uppercased before query)
    expect(Coupon.findOne).toHaveBeenCalledWith({ code: 'BIENVENIDO15', status: 1 });
  });

  test('applies a percentage coupon discount', async () => {
    Cart.find.mockReturnValue({ populate: () => Promise.resolve([{ sub_total: 100 }]) });
    Coupon.findOne.mockResolvedValue({
      code: 'VERANO20',
      type: 'percentage',
      amount: 20,
      status: 1,
      min_spend: 0,
    });

    const res = await request(app).post('/checkout').send({ coupon_code: 'VERANO20' });

    expect(res.status).toBe(200);
    expect(res.body.coupon_total_discount).toBe(20);
    expect(res.body.total).toBe(80);
  });

  test('rejects an unknown coupon code with 422', async () => {
    Cart.find.mockReturnValue({ populate: () => Promise.resolve([{ sub_total: 100 }]) });
    Coupon.findOne.mockResolvedValue(null);

    const res = await request(app).post('/checkout').send({ coupon_code: 'NOPE' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/invalid coupon/i);
  });

  test('rejects a coupon whose min_spend exceeds the subtotal', async () => {
    Cart.find.mockReturnValue({ populate: () => Promise.resolve([{ sub_total: 50 }]) });
    Coupon.findOne.mockResolvedValue({
      code: 'BIG100',
      type: 'fixed',
      amount: 5,
      status: 1,
      min_spend: 100,
    });

    const res = await request(app).post('/checkout').send({ coupon_code: 'BIG100' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Minimum spend/);
  });
});
