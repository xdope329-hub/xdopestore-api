/**
 * /page routes tests
 *
 * CMS pages (Terms & Conditions, Privacy Policy) managed from the admin
 * dashboard's "Pages" section and rendered by the storefront by slug.
 * Covers: paginated list shape, id-vs-slug lookup (slug only returns
 * published pages), create with auto-slug, Laravel-style _method:"put"
 * update, and delete.
 */

const request = require('supertest');

// Chainable query mock: find().skip().limit().sort().populate() → resolves
// to `result`; findOne().populate() → resolves to `result`.
function chainable(result) {
  const chain = {};
  ['skip', 'limit', 'sort', 'populate'].forEach((m) => {
    chain[m] = jest.fn(() => chain);
  });
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('/page routes', () => {
  let app;
  const Page = {
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/models/Page', () => Page);
    const { mockAuth, buildApp } = require('./_support/helpers');
    mockAuth('admin');
    app = buildApp([{ prefix: '/page', modulePath: '../src/routes/page.routes' }]);
  });

  beforeEach(() => {
    Object.values(Page).forEach((fn) => fn.mockReset && fn.mockReset());
  });

  test('GET /page returns the paginated list shape the admin table expects', async () => {
    Page.countDocuments.mockResolvedValue(2);
    Page.find.mockReturnValue(chainable([
      { _id: 'p1', title: 'Términos y Condiciones', slug: 'terms-and-conditions', status: 1, createdAt: '2026-08-27' },
      { _id: 'p2', title: 'Política de Privacidad', slug: 'privacy-policy', status: 1, createdAt: '2026-08-27' },
    ]));

    const res = await request(app).get('/page');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ current_page: 1, last_page: 1, total: 2 });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].created_at).toBe('2026-08-27'); // timestamp alias
  });

  test('GET /page/:slug looks up published pages by slug', async () => {
    Page.findOne.mockReturnValue(chainable({ _id: 'p1', title: 'Términos y Condiciones', slug: 'terms-and-conditions', status: 1 }));

    const res = await request(app).get('/page/terms-and-conditions');

    expect(res.status).toBe(200);
    expect(Page.findOne).toHaveBeenCalledWith({ slug: 'terms-and-conditions', status: 1 });
    expect(res.body.title).toBe('Términos y Condiciones');
  });

  test('GET /page/:id looks up by _id when the param is a valid ObjectId', async () => {
    Page.findOne.mockReturnValue(chainable({ _id: '64b0000000000000000000c1', title: 'X' }));

    const res = await request(app).get('/page/64b0000000000000000000c1');

    expect(res.status).toBe(200);
    expect(Page.findOne).toHaveBeenCalledWith({ _id: '64b0000000000000000000c1' });
  });

  test('GET /page/:slug returns 404 for missing pages', async () => {
    Page.findOne.mockReturnValue(chainable(null));
    const res = await request(app).get('/page/nope');
    expect(res.status).toBe(404);
  });

  test('POST /page creates a page and auto-generates the slug from the title', async () => {
    Page.create.mockImplementation(async (body) => ({ _id: 'p3', ...body }));

    const res = await request(app).post('/page').send({ title: 'Política de Envíos', content: '<p>hola</p>', status: 1 });

    expect(res.status).toBe(201);
    expect(Page.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'politica-de-envios' }));
  });

  test('POST /page/:id with _method:"put" updates the page (admin form flow)', async () => {
    Page.findByIdAndUpdate.mockResolvedValue({ _id: 'p1', title: 'Nuevo título', slug: 'nuevo-titulo' });

    const res = await request(app).post('/page/p1').send({ _method: 'put', title: 'Nuevo título', content: '<p>v2</p>' });

    expect(res.status).toBe(200);
    expect(Page.findByIdAndUpdate).toHaveBeenCalledWith('p1', expect.objectContaining({ title: 'Nuevo título' }), { new: true });
  });

  test('DELETE /page/:id deletes the page', async () => {
    Page.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/page/p1');
    expect(res.status).toBe(200);
    expect(Page.findByIdAndDelete).toHaveBeenCalledWith('p1');
  });
});
