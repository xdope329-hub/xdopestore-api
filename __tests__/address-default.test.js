/**
 * PATCH /address/:id/default tests
 *
 * Covers the storefront feature where selecting a billing address radio
 * promotes that address to be the user's account-wide default. The route
 * (1) clears `is_default` on every other address belonging to the user
 * and (2) flips the target to true.
 */

const request = require('supertest');

describe('PATCH /address/:id/default', () => {
  let app;
  const Address = {
    findOne: jest.fn(),
    updateMany: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
  };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Address', () => Address);
    jest.doMock('../src/data/countries', () => ({
      findCountry: () => null,
      findState: () => null,
    }));
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/address', modulePath: '../src/routes/address.routes' }]);
  });

  beforeEach(() => {
    Object.values(Address).forEach((fn) => fn.mockReset && fn.mockReset());
  });

  test('promotes the target address: clears other defaults and saves target as default', async () => {
    const target = { _id: 'a1', is_default: false, save: jest.fn().mockResolvedValue(true) };
    Address.findOne.mockResolvedValue(target);
    Address.updateMany.mockResolvedValue({ matchedCount: 2 });

    const res = await request(app).patch('/address/a1/default').send();

    expect(res.status).toBe(200);
    // Other addresses cleared
    expect(Address.updateMany).toHaveBeenCalledWith(
      { user_id: expect.anything() },
      { is_default: false },
    );
    // Target flipped & saved
    expect(target.is_default).toBe(true);
    expect(target.save).toHaveBeenCalled();
  });

  test('returns 404 when the address does not belong to the user', async () => {
    Address.findOne.mockResolvedValue(null);

    const res = await request(app).patch('/address/missing/default').send();

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
    expect(Address.updateMany).not.toHaveBeenCalled();
  });
});
