/**
 * Sección "Compra por Categoría" de la portada (utils/homeCategoryProduct.js)
 * y su uso en GET /home: lo que el administrador quita en Front → Category
 * Products deja de mostrarse en la tienda. Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');
const { buildCategoryIndex, resolveCategoryIds } = require('../src/utils/homeCategoryProduct');

const id = (n) => n.toString(16).padStart(24, '0');
const cat = (n, extra = {}) => ({ _id: id(n), parent_id: null, status: 1, type: 'product', createdAt: new Date(2026, 0, n), ...extra });

// Árbol: 1 Mujer (hija 11 Vestidos), 2 Hombre (hija 21 Camisas), 3 Accesorios,
// 4 Calzado (inactiva), 5 Blog (tipo post). Productos activos en 11, 21 y 4.
const categories = [cat(1), cat(11, { parent_id: id(1) }), cat(2), cat(21, { parent_id: id(2) }), cat(3), cat(4, { status: 0 }), cat(5, { type: 'post' })];
const usedCategoryIds = [id(11), id(21), id(4)];

describe('índice de categorías con productos', () => {
  const index = buildCategoryIndex({ categories, usedCategoryIds });

  test('una categoría cuenta como "con productos" por sus descendientes', () => {
    expect([...index.withProducts].sort()).toEqual([id(1), id(11), id(2), id(21), id(4)].sort());
  });

  test('la lista viva son las raíces activas con productos, por orden de creación', () => {
    expect(index.liveTopLevelIds).toEqual([id(1), id(2)]);
  });

  test('seleccionables: activas, de producto y con productos (subcategorías incluidas)', () => {
    expect([...index.selectableIds].sort()).toEqual([id(1), id(11), id(2), id(21)].sort());
  });

  test('ids sueltos que no existen no rompen el recorrido', () => {
    const out = buildCategoryIndex({ categories, usedCategoryIds: [id(99), null] });
    expect(out.liveTopLevelIds).toEqual([]);
  });
});

describe('lista final de la sección', () => {
  const index = buildCategoryIndex({ categories, usedCategoryIds });
  const live = index.liveTopLevelIds;

  test('sin lista guardada → lista viva', () => {
    expect(resolveCategoryIds({ savedIds: undefined, liveIds: live, selectableIds: index.selectableIds })).toEqual({ category_ids: [id(1), id(2)], source: 'live' });
  });

  test('el admin quitó Hombre → solo queda lo que eligió, en su orden', () => {
    const out = resolveCategoryIds({ savedIds: [id(2), id(1)], liveIds: live, selectableIds: index.selectableIds });
    expect(out.category_ids).toEqual([id(2), id(1)]);
    const removed = resolveCategoryIds({ savedIds: [id(1)], liveIds: live, selectableIds: index.selectableIds });
    expect(removed).toEqual({ category_ids: [id(1)], source: 'admin' });
  });

  test('el admin quitó todas → lista vacía (la tienda oculta la sección)', () => {
    expect(resolveCategoryIds({ savedIds: [], liveIds: live, selectableIds: index.selectableIds })).toEqual({ category_ids: [], source: 'admin' });
  });

  test('se descartan las eliminadas, inactivas, sin productos, vacías o repetidas', () => {
    const out = resolveCategoryIds({ savedIds: [id(1), '', null, id(1), id(3), id(4), id(5), id(77), id(11)], liveIds: live, selectableIds: index.selectableIds });
    expect(out.category_ids).toEqual([id(1), id(11)]);
  });

  test('todo lo guardado quedó obsoleto → lista viva', () => {
    expect(resolveCategoryIds({ savedIds: [id(77), id(4)], liveIds: live, selectableIds: index.selectableIds })).toEqual({ category_ids: [id(1), id(2)], source: 'live' });
  });
});

describe('GET /home', () => {
  const chain = (doc) => ({ limit() { return this; }, select() { return this; }, sort() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

  function build(savedConfig) {
    jest.resetModules();
    jest.doMock('../src/models/Category', () => ({ find: jest.fn(() => chain(categories)) }));
    jest.doMock('../src/models/Product', () => ({ find: jest.fn(() => chain([{ _id: id(500) }])), distinct: jest.fn(async () => usedCategoryIds) }));
    jest.doMock('../src/models/Brand', () => ({ find: jest.fn(() => chain([])) }));
    jest.doMock('../src/models/Homepage', () => ({ findOne: jest.fn(async () => (savedConfig ? { config: savedConfig } : null)), findOneAndUpdate: jest.fn() }));
    const { buildApp } = require('./_support/helpers');
    return buildApp([{ prefix: '/home', modulePath: '../src/routes/home.routes' }]);
  }

  test('sin configuración guardada: todas las raíces vivas', async () => {
    const res = await request(build(null)).get('/home/fashion_one');
    expect(res.status).toBe(200);
    expect(res.body.content.category_product).toEqual({ status: 1, title: 'Compra por Categoría', category_ids: [id(1), id(2)] });
  });

  test('el admin dejó solo Mujer: la tienda recibe solo Mujer (antes volvían todas)', async () => {
    const res = await request(build({ category_product: { status: 1, title: 'Categorías', category_ids: [id(1)] } })).get('/home/fashion_one');
    expect(res.body.content.category_product).toEqual({ status: 1, title: 'Categorías', category_ids: [id(1)] });
  });

  test('el admin quitó todas: lista vacía; título y estado se conservan', async () => {
    const res = await request(build({ category_product: { status: 0, title: 'Categorías', category_ids: [] } })).get('/home/fashion_one');
    expect(res.body.content.category_product).toEqual({ status: 0, title: 'Categorías', category_ids: [] });
  });

  test('una categoría eliminada en el catálogo no se envía aunque siga guardada', async () => {
    const res = await request(build({ category_product: { category_ids: [id(2), id(77)] } })).get('/home/fashion_one');
    expect(res.body.content.category_product.category_ids).toEqual([id(2)]);
  });
});
