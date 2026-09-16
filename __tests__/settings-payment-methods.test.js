/**
 * PUT /settings: las secciones que son listas (payment_methods) se guardan
 * como lista. Antes se fusionaban como objeto ({ 0: …, 1: … }), el GET las
 * descartaba por "no ser una lista" y volvía a los valores por defecto: el
 * admin no podía activar contra entrega. Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

function setup(values) {
  jest.resetModules();
  const doc = { values, markModified: jest.fn(), save: jest.fn(async function () { return this; }), toJSON() { return { values: this.values }; } };
  jest.doMock('../src/models/Setting', () => ({ findOne: jest.fn(async () => doc), create: jest.fn() }));
  jest.doMock('../src/utils/settingsRedaction', () => ({ redactSettingsFor: (_user, s) => ({ values: s.values }), redactSettingValues: (v) => v }));
  const { mockAuth, buildApp } = require('./_support/helpers');
  mockAuth('admin');
  const app = buildApp([{ prefix: '/settings', modulePath: '../src/routes/settings.routes' }]);
  return { app, doc };
}

describe('PUT /settings', () => {
  test('payment_methods se reemplaza como lista y conserva el orden', async () => {
    const { app, doc } = setup({ payment_methods: [{ name: 'cod', status: 0 }, { name: 'mercadopago', status: 1 }], general: { site_name: 'XDOPE' } });
    const res = await request(app).put('/settings').send({ values: { payment_methods: [{ name: 'cod', status: 1 }, { name: 'mercadopago', status: 1 }] } });
    expect(res.status).toBe(200);
    expect(Array.isArray(doc.values.payment_methods)).toBe(true);
    expect(doc.values.payment_methods).toEqual([{ name: 'cod', status: 1 }, { name: 'mercadopago', status: 1 }]);
    // Las demás secciones no se tocan.
    expect(doc.values.general).toEqual({ site_name: 'XDOPE' });
    expect(doc.save).toHaveBeenCalled();
  });

  test('las secciones objeto se siguen fusionando campo a campo', async () => {
    const { app, doc } = setup({ general: { site_name: 'XDOPE', site_tagline: 'Moda' } });
    await request(app).put('/settings').send({ values: { general: { site_tagline: 'Nueva' } } });
    expect(doc.values.general).toEqual({ site_name: 'XDOPE', site_tagline: 'Nueva' });
  });
});
