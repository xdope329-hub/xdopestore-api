/**
 * PUT /address/:id — edición de una dirección guardada (cuenta y checkout):
 * solo del dueño, sin campos internos por asignación masiva y con nombres
 * de país/departamento resueltos. Sin base de datos.
 */

const request = require('supertest');

describe('PUT /address/:id', () => {
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
      findCountry: (id) => (Number(id) === 47 ? { id: 47, name: 'Colombia' } : null),
      findState: (countryId, id) => (Number(countryId) === 47 && Number(id) === 3 ? { id: 3, name: 'Cundinamarca' } : null),
    }));
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('consumer');
    app = buildApp([{ prefix: '/address', modulePath: '../src/routes/address.routes' }]);
  });

  beforeEach(() => {
    Object.values(Address).forEach((fn) => fn.mockReset && fn.mockReset());
  });

  test('actualiza solo la dirección del usuario con los campos permitidos', async () => {
    Address.findOneAndUpdate.mockResolvedValue({ _id: 'a1', title: 'Casa' });
    const res = await request(app)
      .put('/address/a1')
      .send({ title: ' Casa ', street: ' Calle 1 ', city: 'Bogotá', country_id: '47', state_id: '3', pincode: 110111, phone: 3105550147, is_default: 0, user_id: 'otro', _id: 'zz', id: 'zz', createdAt: 'x', _method: 'PUT', country: {}, state: {} });
    expect(res.status).toBe(200);
    const [filter, body] = Address.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'a1', user_id: expect.anything() });
    expect(body).toEqual({ title: 'Casa', street: 'Calle 1', city: 'Bogotá', country_id: 47, country_name: 'Colombia', state_id: 3, state_name: 'Cundinamarca', pincode: '110111', phone: '3105550147', is_default: false });
    expect(Address.updateMany).not.toHaveBeenCalled();
  });

  test('marcarla como predeterminada quita la marca a las demás', async () => {
    Address.updateMany.mockResolvedValue({});
    Address.findOneAndUpdate.mockResolvedValue({ _id: 'a1', is_default: true });
    const res = await request(app).put('/address/a1').send({ title: 'Casa', is_default: true });
    expect(res.status).toBe(200);
    expect(Address.updateMany).toHaveBeenCalledWith({ user_id: expect.anything() }, { is_default: false });
  });

  test('dirección de otro usuario → 404', async () => {
    Address.findOneAndUpdate.mockResolvedValue(null);
    const res = await request(app).put('/address/a9').send({ title: 'Casa' });
    expect(res.status).toBe(404);
  });
});
