/**
 * Preguntas y respuestas (routes/misc.routes.js): una sola pregunta por
 * producto y cliente, y la respuesta viaja siempre en el listado con los ids
 * planos que la tienda compara. Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const request = require('supertest');

const id = (n) => n.toString(16).padStart(24, '0');
const ME = '64b0000000000000000000a1';
const chain = (doc) => ({ populate() { return this; }, skip() { return this; }, limit() { return this; }, sort() { return this; }, then: (r, j) => Promise.resolve(doc).then(r, j) });

function setup(models = {}) {
  jest.resetModules();
  const Question = {
    findOne: jest.fn(async () => null),
    find: jest.fn(() => chain([])),
    countDocuments: jest.fn(async () => 0),
    create: jest.fn(async (d) => ({ _id: id(5), ...d, populate: async function () { return { toJSON: () => ({ _id: id(5), ...d }) }; } })),
    ...models,
  };
  jest.doMock('../src/models/Question', () => Question);
  const { mockAuth, buildApp } = require('./_support/helpers');
  mockAuth('consumer');
  const app = buildApp([{ prefix: '/', modulePath: '../src/routes/misc.routes' }]);
  return { app, Question };
}

describe('POST /question-and-answer', () => {
  test('primera pregunta del cliente sobre el producto → 201', async () => {
    const { app, Question } = setup();
    const res = await request(app).post('/question-and-answer').send({ question: '  ¿Es ajustable?  ', product_id: id(1) });
    expect(res.status).toBe(201);
    expect(Question.findOne).toHaveBeenCalledWith({ product_id: id(1), consumer_id: ME });
    expect(Question.create).toHaveBeenCalledWith({ question: '¿Es ajustable?', product_id: id(1), consumer_id: ME, status: 0 });
  });

  test('segunda pregunta sobre el mismo producto → 409', async () => {
    const { app, Question } = setup({ findOne: jest.fn(async () => ({ _id: id(9) })) });
    const res = await request(app).post('/question-and-answer').send({ question: 'Otra', product_id: id(1) });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Ya publicaste/);
    expect(Question.create).not.toHaveBeenCalled();
  });

  test('pregunta vacía → 400', async () => {
    const { app } = setup();
    expect((await request(app).post('/question-and-answer').send({ question: '   ', product_id: id(1) })).status).toBe(400);
  });
});

describe('GET /question-and-answer', () => {
  test('la respuesta y los ids planos llegan a la tienda', async () => {
    const doc = { _id: id(5), question: '¿Es ajustable?', answer: 'Sí', status: 1, createdAt: new Date('2026-01-01'), product_id: { _id: id(1), name: 'Gorra', slug: 'gorra' }, consumer_id: { _id: ME, name: 'Ana', email: 'a@x.com' } };
    const { app } = setup({ find: jest.fn(() => chain([doc])), countDocuments: jest.fn(async () => 1) });
    const res = await request(app).get('/question-and-answer').query({ product_id: id(1) });
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ answer: 'Sí', is_answered: true, product_id: id(1), consumer_id: ME, product: { name: 'Gorra' }, consumer: { name: 'Ana' } });
  });
});
