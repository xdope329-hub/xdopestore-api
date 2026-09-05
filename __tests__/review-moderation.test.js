/**
 * Moderación de reseñas (src/routes/review.routes.js):
 *  - el público solo ve reseñas aprobadas; el admin ve todas y filtra;
 *  - el cliente crea en pendiente, una por producto, con datos validados;
 *  - editar una reseña la devuelve a pendiente;
 *  - aprobar/rechazar es exclusivo de administración;
 *  - /review/pending lista lo entregado y aún sin reseñar;
 *  - crear o eliminar una reseña marca la compra como calificada
 *    (products[].reviewed_at) para que no se pueda reseñar dos veces.
 * Sin base de datos: modelos simulados.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const ME = '64b0000000000000000000a1';
const chain = (doc) => ({
  populate() { return this; },
  skip() { return this; },
  limit() { return this; },
  sort() { return this; },
  select() { return this; },
  then: (r, j) => Promise.resolve(doc).then(r, j),
});

function setup(role, models = {}) {
  jest.resetModules();
  const Review = {
    find: jest.fn(() => chain([])),
    findOne: jest.fn(async () => null),
    findById: jest.fn(async () => null),
    countDocuments: jest.fn(async () => 0),
    create: jest.fn(async (d) => ({ _id: id(5), ...d, toJSON() { return { _id: id(5), ...d }; } })),
    ...models.Review,
  };
  const Order = { findOne: jest.fn(async () => ({ _id: id(8) })), find: jest.fn(() => chain([])), updateMany: jest.fn(async () => ({ modifiedCount: 1 })), ...models.Order };
  const OrderStatus = { findOne: jest.fn(async () => ({ _id: id(9), slug: 'delivered' })), ...models.OrderStatus };
  jest.doMock('../src/models/Review', () => Review);
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/OrderStatus', () => OrderStatus);
  const { mockAuth, buildApp } = require('./_support/helpers');
  if (role) mockAuth(role);
  else jest.doMock('../src/middleware/optionalAuth', () => (req, _res, next) => { req.user = null; next(); });
  const app = buildApp([{ prefix: '/review', modulePath: '../src/routes/review.routes' }]);
  return { app, Review, Order, OrderStatus };
}

describe('listado', () => {
  test('anónimo: solo aprobadas', async () => {
    const { app, Review } = setup(null);
    const res = await request(app).get('/review').query({ product_id: id(1) });
    expect(res.status).toBe(200);
    expect(Review.find).toHaveBeenCalledWith({ product_id: id(1), status: 1 });
    expect(Review.countDocuments).toHaveBeenCalledWith({ product_id: id(1), status: 1 });
  });

  test('cliente autenticado: también solo aprobadas', async () => {
    const { app, Review } = setup('consumer');
    await request(app).get('/review').query({ status: 'pending' });
    expect(Review.find).toHaveBeenCalledWith({ status: 1 });
  });

  test('admin: todas, con filtro por estado y búsqueda', async () => {
    const { app, Review } = setup('admin');
    await request(app).get('/review');
    expect(Review.find).toHaveBeenCalledWith({});
    await request(app).get('/review').query({ status: 'pending', search: 'a+b' });
    expect(Review.find).toHaveBeenLastCalledWith({ status: 0, description: { $regex: 'a\\+b', $options: 'i' } });
  });

  test('cada reseña lleva su estado legible', async () => {
    const doc = { _id: id(5), rating: 4, description: 'ok', status: 0, createdAt: new Date('2026-01-01'), consumer_id: { _id: ME, name: 'Ana' }, product_id: { _id: id(1), name: 'Camisa' } };
    const { app } = setup('admin', { Review: { find: jest.fn(() => chain([doc])), countDocuments: jest.fn(async () => 1) } });
    const res = await request(app).get('/review');
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ id: id(5), status: 0, status_slug: 'pending', consumer: { name: 'Ana' }, product: { name: 'Camisa' } });
  });
});

describe('crear', () => {
  test('queda pendiente y solo con los campos permitidos', async () => {
    const { app, Review, Order } = setup('consumer');
    const res = await request(app).post('/review').send({ product_id: id(1), rating: '5', description: '  Genial  ', status: 1, consumer_id: id(7) });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/revisad/);
    expect(Review.create).toHaveBeenCalledWith({ product_id: id(1), rating: 5, description: 'Genial', review_image_id: undefined, consumer_id: ME, status: 0 });
    // La compra queda marcada como calificada (products[].reviewed_at) en
    // todas las líneas entregadas de ese producto que aún no lo estaban.
    expect(Order.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update, options] = Order.updateMany.mock.calls[0];
    expect(filter).toMatchObject({ consumer_id: ME, status_id: id(9) });
    expect(String(filter['products.product_id'])).toBe(id(1));
    expect(update).toEqual({ $set: { 'products.$[line].reviewed_at': expect.any(Date) } });
    expect(String(options.arrayFilters[0]['line.product_id'])).toBe(id(1));
    expect(options.arrayFilters[0]['line.reviewed_at']).toBeNull();
  });

  test('calificación inválida → 422', async () => {
    const { app, Review } = setup('consumer');
    expect((await request(app).post('/review').send({ product_id: id(1), rating: 8 })).status).toBe(422);
    expect((await request(app).post('/review').send({ product_id: id(1) })).status).toBe(422);
    expect((await request(app).post('/review').send({ product_id: 'nope', rating: 3 })).status).toBe(422);
    expect(Review.create).not.toHaveBeenCalled();
  });

  test('sin pedido entregado → 403', async () => {
    const { app } = setup('consumer', { Order: { findOne: jest.fn(async () => null) } });
    const res = await request(app).post('/review').send({ product_id: id(1), rating: 5 });
    expect(res.status).toBe(403);
  });

  test('una reseña por producto → 409', async () => {
    const { app, Review } = setup('consumer', { Review: { findOne: jest.fn(async () => ({ _id: id(5) })) } });
    const res = await request(app).post('/review').send({ product_id: id(1), rating: 5 });
    expect(res.status).toBe(409);
    expect(Review.create).not.toHaveBeenCalled();
  });

  test('compra ya calificada (la reseña la eliminó el admin) → 409 y no se crea otra', async () => {
    // Compró el producto, pero todas sus líneas entregadas ya tienen reviewed_at.
    const findOne = jest.fn(async (filter) => (filter.products ? null : { _id: id(8) }));
    const { app, Review, Order } = setup('consumer', { Order: { findOne } });
    const res = await request(app).post('/review').send({ product_id: id(1), rating: 5 });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/calificaste/);
    expect(findOne).toHaveBeenLastCalledWith({ consumer_id: ME, status_id: id(9), products: { $elemMatch: { product_id: id(1), reviewed_at: null } } });
    expect(Review.create).not.toHaveBeenCalled();
    expect(Order.updateMany).not.toHaveBeenCalled();
  });
});

describe('editar', () => {
  const owned = () => ({ _id: id(5), consumer_id: { toString: () => ME }, rating: 5, description: 'x', status: 1, moderated_at: new Date(), save: jest.fn(async function () { return this; }), toJSON() { return { _id: id(5), rating: this.rating, description: this.description, status: this.status }; } });

  test('el autor edita y la reseña vuelve a pendiente', async () => {
    const review = owned();
    const { app } = setup('consumer', { Review: { findById: jest.fn(async () => review) } });
    const res = await request(app).put(`/review/${id(5)}`).send({ description: 'mejor', status: 1 });
    expect(res.status).toBe(200);
    expect(review.description).toBe('mejor');
    expect(review.rating).toBe(5);
    expect(review.status).toBe(0);
    expect(review.moderated_at).toBeNull();
    expect(review.save).toHaveBeenCalled();
  });

  test('otro cliente no puede editarla', async () => {
    const review = { ...owned(), consumer_id: { toString: () => id(77) } };
    const { app } = setup('consumer', { Review: { findById: jest.fn(async () => review) } });
    expect((await request(app).put(`/review/${id(5)}`).send({ rating: 1 })).status).toBe(403);
    expect(review.save).not.toHaveBeenCalled();
  });
});

describe('moderar', () => {
  const pending = () => ({ _id: id(5), consumer_id: { toString: () => ME }, rating: 5, status: 0, moderated_at: null, save: jest.fn(async function () { return this; }), toJSON() { return { _id: id(5), rating: 5, status: this.status, moderated_at: this.moderated_at }; } });

  test('el cliente no puede aprobar (ni la suya)', async () => {
    const review = pending();
    const { app } = setup('consumer', { Review: { findById: jest.fn(async () => review) } });
    const res = await request(app).put(`/review/${id(5)}/status`).send({ status: 'approved' });
    expect(res.status).toBe(403);
    expect(review.status).toBe(0);
  });

  test('admin aprueba y rechaza', async () => {
    const review = pending();
    const { app } = setup('admin', { Review: { findById: jest.fn(async () => review) } });
    let res = await request(app).put(`/review/${id(5)}/status`).send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status_slug).toBe('approved');
    expect(review.status).toBe(1);
    expect(review.moderated_at).toBeInstanceOf(Date);

    res = await request(app).put(`/review/${id(5)}/status`).send({ status: 2 });
    expect(res.body.status_slug).toBe('rejected');
    expect(review.status).toBe(2);
  });

  test('estado desconocido → 422; reseña inexistente → 404', async () => {
    const { app } = setup('admin');
    expect((await request(app).put(`/review/${id(5)}/status`).send({ status: 'published' })).status).toBe(422);
    expect((await request(app).put(`/review/${id(5)}/status`).send({ status: 'approved' })).status).toBe(404);
  });
});

describe('eliminar', () => {
  const stored = (owner = ME) => ({ _id: id(5), consumer_id: { toString: () => owner }, product_id: id(1), createdAt: new Date('2026-02-01'), deleteOne: jest.fn(async () => ({})) });

  test('el admin la elimina, pero la compra sigue marcada como calificada', async () => {
    const review = stored();
    const { app, Order } = setup('admin', { Review: { findById: jest.fn(async () => review) } });
    const res = await request(app).delete(`/review/${id(5)}`);
    expect(res.status).toBe(200);
    expect(review.deleteOne).toHaveBeenCalled();
    expect(Order.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update, options] = Order.updateMany.mock.calls[0];
    expect(filter.consumer_id).toBe(review.consumer_id);
    expect(filter.status_id).toBe(id(9));
    expect(String(filter['products.product_id'])).toBe(id(1));
    expect(update).toEqual({ $set: { 'products.$[line].reviewed_at': review.createdAt } });
    expect(options.arrayFilters[0]['line.reviewed_at']).toBeNull();
  });

  test('el autor también puede eliminarla y tampoco reabre la compra', async () => {
    const review = stored();
    const { app, Order } = setup('consumer', { Review: { findById: jest.fn(async () => review) } });
    expect((await request(app).delete(`/review/${id(5)}`)).status).toBe(200);
    expect(Order.updateMany).toHaveBeenCalledTimes(1);
    expect(review.deleteOne).toHaveBeenCalled();
  });

  test('otro cliente no puede eliminarla', async () => {
    const review = stored(id(77));
    const { app, Order } = setup('consumer', { Review: { findById: jest.fn(async () => review) } });
    expect((await request(app).delete(`/review/${id(5)}`)).status).toBe(403);
    expect(review.deleteOne).not.toHaveBeenCalled();
    expect(Order.updateMany).not.toHaveBeenCalled();
  });
});

describe('pendientes de calificar', () => {
  test('lista lo entregado que aún no tiene reseña', async () => {
    const orders = [{ _id: id(100), order_number: 2001, products: [{ product_id: { _id: id(1), name: 'Camisa', slug: 'camisa', product_thumbnail_id: null } }, { product_id: { _id: id(2), name: 'Jean', slug: 'jean', product_thumbnail_id: null } }] }];
    const { app, Order } = setup('consumer', {
      Order: { find: jest.fn(() => chain(orders)) },
      Review: { find: jest.fn(() => chain([{ product_id: id(1), status: 0 }])) },
    });
    const res = await request(app).get('/review/pending');
    expect(res.status).toBe(200);
    expect(Order.find).toHaveBeenCalledWith({ consumer_id: ME, status_id: id(9) });
    expect(res.body.data).toEqual([{ order_id: id(100), order_number: 2001, product: { id: id(2), name: 'Jean', slug: 'jean', product_thumbnail: null } }]);
  });

  test('una compra ya calificada no vuelve a listarse aunque la reseña se haya eliminado', async () => {
    const orders = [{ _id: id(100), order_number: 2001, products: [{ product_id: { _id: id(1), name: 'Camisa', slug: 'camisa', product_thumbnail_id: null }, reviewed_at: new Date('2026-02-01') }, { product_id: { _id: id(2), name: 'Jean', slug: 'jean', product_thumbnail_id: null } }] }];
    const { app } = setup('consumer', { Order: { find: jest.fn(() => chain(orders)) } });
    const res = await request(app).get('/review/pending');
    expect(res.status).toBe(200);
    expect(res.body.data.map((i) => i.product.id)).toEqual([id(2)]);
  });

  test('sin estado "delivered" configurado responde vacío', async () => {
    const { app } = setup('consumer', { OrderStatus: { findOne: jest.fn(async () => null) } });
    const res = await request(app).get('/review/pending');
    expect(res.body).toEqual({ data: [] });
  });
});
