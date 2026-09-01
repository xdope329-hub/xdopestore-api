/**
 * Pestaña "Mercado Pago — Pagados" del admin.
 *
 *  - GET /order acepta payment_method / payment_status y los aplica al filtro
 *    de Mongo (sin ellos, la pestaña traería TODAS las órdenes).
 *  - GET /statistics/count expone total_mercadopago_paid_orders y cuenta con
 *    payment_status='completed', que es lo que deja un pago aprobado
 *    (payment.routes.js) — 'paid' nunca existió y daba 0.
 *  - Los contadores por estado se resuelven vía status_id → slug (antes se
 *    agrupaba por un campo '$status' inexistente y todas las pestañas
 *    mostraban 0).
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48);

const request = require("supertest");

const STATUS_PENDING = "64b0000000000000000000f1";
const STATUS_DELIVERED = "64b0000000000000000000f2";

function buildOrderApp() {
  jest.resetModules();
  const captured = { filter: null };
  const query = {
    skip() { return this; },
    limit() { return this; },
    sort() { return this; },
    populate() { return this; },
    then(resolve) { return Promise.resolve([]).then(resolve); },
  };
  const Order = {
    countDocuments: jest.fn(async () => 0),
    find: jest.fn((filter) => { captured.filter = filter; return query; }),
  };
  jest.doMock("../src/models/Order", () => Order);
  jest.doMock("../src/models/OrderStatus", () => ({
    findOne: jest.fn(async (q) => (q?.slug === "pending" ? { _id: STATUS_PENDING } : null)),
  }));
  const { mockAuth, buildApp } = require("./_support/helpers");
  mockAuth("admin");
  const app = buildApp([{ prefix: "/order", modulePath: "../src/routes/order.routes" }]);
  return { app, captured, Order };
}

function buildStatsApp({ orders = [], statuses = [], mpPaidCount = 0 } = {}) {
  jest.resetModules();
  const calls = { countDocuments: [] };
  const Order = {
    countDocuments: jest.fn(async (f) => { calls.countDocuments.push(f); return f ? mpPaidCount : orders.length; }),
    aggregate: jest.fn(async (pipeline) => {
      const grouped = pipeline.find((p) => p.$group);
      // revenue pipeline (has a $match on payment_status)
      const match = pipeline.find((p) => p.$match);
      if (match) {
        const wanted = match.$match.payment_status;
        const total = orders.filter((o) => o.payment_status === wanted).reduce((s, o) => s + o.total, 0);
        return total ? [{ _id: null, total }] : [];
      }
      // status pipeline: group by status_id
      if (grouped && grouped.$group._id === "$status_id") {
        const map = {};
        orders.forEach((o) => { const k = String(o.status_id); map[k] = (map[k] || 0) + 1; });
        return Object.entries(map).map(([_id, count]) => ({ _id, count }));
      }
      return [];
    }),
  };
  const mk = (n) => ({ countDocuments: jest.fn(async () => n) });
  jest.doMock("../src/models/Order", () => Order);
  jest.doMock("../src/models/Product", () => mk(3));
  jest.doMock("../src/models/User", () => mk(4));
  jest.doMock("../src/models/Review", () => mk(5));
  jest.doMock("../src/models/OrderStatus", () => ({ find: () => ({ lean: async () => statuses }) }));
  const { mockAuth, buildApp } = require("./_support/helpers");
  mockAuth("admin");
  const app = buildApp([{ prefix: "/statistics", modulePath: "../src/routes/statistics.routes" }]);
  return { app, calls };
}

afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

describe("GET /order — payment filters", () => {
  test("payment_method + payment_status narrow the query (the MP paid tab)", async () => {
    const { app, captured } = buildOrderApp();
    const res = await request(app).get("/order?payment_method=mercadopago&payment_status=completed");
    expect(res.status).toBe(200);
    expect(captured.filter).toMatchObject({ payment_method: "mercadopago", payment_status: "completed" });
  });

  test("without them the admin still sees every order", async () => {
    const { app, captured } = buildOrderApp();
    await request(app).get("/order");
    expect(captured.filter).toEqual({});
  });

  test("the status tab filter keeps working alongside (ObjectId)", async () => {
    const { app, captured } = buildOrderApp();
    await request(app).get(`/order?status=${STATUS_PENDING}`);
    expect(captured.filter).toEqual({ status_id: STATUS_PENDING });
  });

  test("a status SLUG from the admin tabs resolves to its id (was a 500 CastError)", async () => {
    const { app, captured } = buildOrderApp();
    const res = await request(app).get("/order?status=pending");
    expect(res.status).toBe(200);
    expect(captured.filter).toEqual({ status_id: STATUS_PENDING });
  });

  test("an unknown status slug returns an empty list, not an error", async () => {
    const { app, captured } = buildOrderApp();
    const res = await request(app).get("/order?status=no_existe");
    expect(res.status).toBe(200);
    expect(captured.filter).toEqual({ status_id: null });
  });
});

describe("GET /statistics/count", () => {
  const statuses = [
    { _id: STATUS_PENDING, slug: "pending" },
    { _id: STATUS_DELIVERED, slug: "delivered" },
  ];
  const orders = [
    { status_id: STATUS_PENDING, payment_status: "pending", payment_method: "mercadopago", total: 50000 },
    { status_id: STATUS_DELIVERED, payment_status: "completed", payment_method: "mercadopago", total: 160000 },
    { status_id: STATUS_DELIVERED, payment_status: "completed", payment_method: "cod", total: 40000 },
  ];

  test("exposes the Mercado Pago paid count for the tab badge", async () => {
    const { app, calls } = buildStatsApp({ orders, statuses, mpPaidCount: 1 });
    const res = await request(app).get("/statistics/count");
    expect(res.status).toBe(200);
    expect(res.body.total_mercadopago_paid_orders).toBe(1);
    // counted with the status a gateway approval actually writes
    expect(calls.countDocuments).toContainEqual({ payment_method: "mercadopago", payment_status: "completed" });
  });

  test("revenue sums completed payments (was matching a status that never existed)", async () => {
    const { app } = buildStatsApp({ orders, statuses, mpPaidCount: 1 });
    const res = await request(app).get("/statistics/count");
    expect(res.body.total_revenue).toBe(200000);
  });

  test("status tab counts resolve through status_id → slug", async () => {
    const { app } = buildStatsApp({ orders, statuses, mpPaidCount: 1 });
    const res = await request(app).get("/statistics/count");
    expect(res.body.total_pending_orders).toBe(1);
    expect(res.body.total_delivered_orders).toBe(2);
    expect(res.body.total_cancelled_orders).toBe(0);
  });
});
