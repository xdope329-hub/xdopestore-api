/**
 * Cinta de anuncios (announcement bar) — settings plumbing.
 *
 * La tienda muestra una tira superior con mensajes configurados por el
 * admin bajo settings.values.announcement_bar. Estas pruebas cubren:
 *  - GET /settings siembra los defaults (apagada, 1 mensaje de envío gratis)
 *  - GET /settings hace back-fill en bases creadas antes de la cinta
 *  - GET /settings NO pisa una configuración existente del admin
 *  - PUT /settings guarda mensajes/colores nuevos (solo admin)
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48);

const request = require("supertest");

// Doc de settings "completo" (todas las secciones que el GET back-fillea),
// para poder aislar la rama de announcement_bar en cada prueba.
const fullValues = () => ({
  general: { default_currency: { code: "COP" } },
  activation: { guest_checkout: true },
  payment_methods: [{ name: "mercadopago", status: 1 }],
  payment_methods_migrated_v2: true,
  whatsapp: { status: 0, number: "", message: "" },
  social: { facebook: "", instagram: "", twitter: "", pinterest: "" },
  capacity: { status: 0, daily_limit: 4, mode: "units", whatsapp_message: "" },
});

function makeSettingDoc(values) {
  return {
    values,
    saved: 0,
    markModified() {},
    async save() { this.saved += 1; },
  };
}

function build({ role = "admin", doc = null } = {}) {
  jest.resetModules();
  const state = { doc, created: null };
  const SettingMock = {
    async findOne() { return state.doc; },
    async create(payload) {
      state.created = payload;
      state.doc = makeSettingDoc(payload.values);
      return state.doc;
    },
  };
  jest.doMock("../src/models/Setting", () => SettingMock);
  const { mockAuth, buildApp } = require("./_support/helpers");
  mockAuth(role);
  const app = buildApp([{ prefix: "/settings", modulePath: "../src/routes/settings.routes" }]);
  return { app, state };
}

afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

describe("GET /settings — announcement bar", () => {
  test("fresh database seeds the announcement bar defaults (off, one free-shipping message)", async () => {
    const { app } = build({ doc: null });
    const res = await request(app).get("/settings");
    expect(res.status).toBe(200);
    const bar = res.body.values.announcement_bar;
    expect(bar).toBeDefined();
    expect(bar.status).toBe(0);
    expect(bar.text_color).toBe("#ffffff");
    expect(Number(bar.speed)).toBeGreaterThan(0);
    expect(Array.isArray(bar.messages)).toBe(true);
    expect(bar.messages).toHaveLength(1);
    expect(bar.messages[0].text).toMatch(/Envío gratis/);
    expect(bar.messages[0].status).toBe(1);
  });

  test("existing database without the section gets it back-filled and saved", async () => {
    const doc = makeSettingDoc(fullValues());
    const { app } = build({ doc });
    const res = await request(app).get("/settings");
    expect(res.status).toBe(200);
    expect(res.body.values.announcement_bar).toBeDefined();
    expect(res.body.values.announcement_bar.messages).toHaveLength(1);
    expect(doc.saved).toBeGreaterThan(0); // persisted, not just echoed
  });

  test("an admin-configured bar is left untouched by the back-fill", async () => {
    const values = fullValues();
    values.announcement_bar = {
      status: 1,
      bg_color: "#111111",
      text_color: "#eeeeee",
      speed: 12,
      messages: [
        { text: "Solo hoy: 2x1 en camisetas", status: 1 },
        { text: "Envíos a toda Colombia", status: 0 },
      ],
    };
    const doc = makeSettingDoc(values);
    const { app } = build({ doc });
    const res = await request(app).get("/settings");
    expect(res.status).toBe(200);
    const bar = res.body.values.announcement_bar;
    expect(bar.speed).toBe(12);
    expect(bar.messages).toHaveLength(2);
    expect(bar.messages[0].text).toBe("Solo hoy: 2x1 en camisetas");
    expect(doc.saved).toBe(0); // nothing was dirty
  });
});

describe("PUT /settings — announcement bar", () => {
  test("admin can turn the bar on and replace the message list", async () => {
    const values = fullValues();
    values.announcement_bar = { status: 0, bg_color: "", text_color: "#ffffff", speed: 30, messages: [{ text: "Vieja", status: 1 }] };
    const doc = makeSettingDoc(values);
    const { app } = build({ doc });
    const res = await request(app)
      .put("/settings")
      .send({ values: { announcement_bar: { status: 1, bg_color: "#8f2d56", text_color: "#ffffff", speed: 20, messages: [
        { text: "Envío gratis después de $200.000 en compras", status: 1 },
        { text: "Cambios y devoluciones fáciles", status: 1 },
      ] } } });
    expect(res.status).toBe(200);
    const bar = res.body.values.announcement_bar;
    expect(bar.status).toBe(1);
    expect(bar.bg_color).toBe("#8f2d56");
    expect(bar.speed).toBe(20);
    expect(bar.messages).toHaveLength(2);
    expect(doc.saved).toBeGreaterThan(0);
    // Other sections survive the section-level merge
    expect(res.body.values.whatsapp).toBeDefined();
  });

  test("a consumer cannot save settings", async () => {
    const doc = makeSettingDoc(fullValues());
    const { app } = build({ role: "consumer", doc });
    const res = await request(app)
      .put("/settings")
      .send({ values: { announcement_bar: { status: 1 } } });
    expect(res.status).toBe(403);
    expect(doc.saved).toBe(0);
  });
});
