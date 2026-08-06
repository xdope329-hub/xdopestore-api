/**
 * Unit tests for variable ("classified") product pricing.
 *
 * The admin form deliberately strips top-level price / quantity / sale_price /
 * discount for variable products because those live on each variant. The
 * Product schema still needs a price, which used to make every variable
 * product save fail with:
 *   "Product validation failed: price: Path `price` is required. (500)"
 *
 * Fix: derive the parent's pricing from its variants, and only require an
 * explicit price on simple products. No database needed.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48);

const { deriveParentPricingFromVariations, normalizeProductBody } = require("../src/routes/product.routes");
const Product = require("../src/models/Product");

const variant = (over = {}) => ({
  name: "S",
  price: 100000,
  sale_price: null,
  discount: null,
  quantity: 5,
  stock_status: "in_stock",
  ...over,
});

describe("deriveParentPricingFromVariations", () => {
  test("fills price/sale_price/discount from the cheapest variant", () => {
    const body = deriveParentPricingFromVariations({
      type: "classified",
      variations: [
        variant({ name: "M", price: 120000 }),
        variant({ name: "S", price: 100000, sale_price: 80000, discount: 20 }),
      ],
    });
    expect(body.price).toBe(100000);
    expect(body.sale_price).toBe(80000);
    expect(body.discount).toBe(20);
  });

  test("cheapest is decided by what the shopper actually pays", () => {
    const body = deriveParentPricingFromVariations({
      type: "classified",
      variations: [
        variant({ name: "A", price: 90000 }),                          // pays 90.000
        variant({ name: "B", price: 120000, sale_price: 50000 }),      // pays 50.000
      ],
    });
    expect(body.price).toBe(120000);
    expect(body.sale_price).toBe(50000);
  });

  test("quantity is the sum of variant stock and stock_status reflects it", () => {
    const body = deriveParentPricingFromVariations({
      type: "classified",
      variations: [variant({ quantity: 5 }), variant({ quantity: 3 })],
    });
    expect(body.quantity).toBe(8);
    expect(body.stock_status).toBe("in_stock");
  });

  test("all variants sold out marks the parent out_of_stock", () => {
    const body = deriveParentPricingFromVariations({
      type: "classified",
      variations: [variant({ quantity: 0, stock_status: "out_of_stock" })],
    });
    expect(body.stock_status).toBe("out_of_stock");
  });

  test("explicit parent values are never overwritten", () => {
    const body = deriveParentPricingFromVariations({
      type: "classified",
      price: 999,
      quantity: 42,
      variations: [variant({ price: 100000, quantity: 5 })],
    });
    expect(body.price).toBe(999);
    expect(body.quantity).toBe(42);
  });

  test("products without variants are left untouched", () => {
    const body = deriveParentPricingFromVariations({ type: "simple", price: 5000, variations: [] });
    expect(body).toEqual({ type: "simple", price: 5000, variations: [] });
  });

  test("derives even when the type field is missing or wrong", () => {
    // Regression: gating on type === 'classified' left a hole that resurfaced
    // as "Product validation failed: price: Path `price` is required".
    const noType = deriveParentPricingFromVariations({ variations: [variant({ price: 60000 })] });
    expect(noType.price).toBe(60000);
    const wrongType = deriveParentPricingFromVariations({ type: "simple", variations: [variant({ price: 60000 })] });
    expect(wrongType.price).toBe(60000);
  });

  test("classified with no usable variants does not invent a price", () => {
    const body = deriveParentPricingFromVariations({ type: "classified", variations: [] });
    expect(body.price).toBeUndefined();
  });

  test("runs as part of normalizeProductBody (the real request path)", () => {
    const body = normalizeProductBody({
      name: "Hoodie",
      type: "classified",
      brand_id: "",
      variations: [variant({ price: 70000, quantity: 2 })],
    });
    expect(body.price).toBe(70000);
    expect(body.quantity).toBe(2);
  });
});

describe("Product price requirement", () => {
  test("classified product validates without a top-level price", async () => {
    await expect(new Product({ name: "Hoodie", slug: "hoodie", type: "classified" }).validate()).resolves.toBeUndefined();
  });

  test("simple product still requires a price", async () => {
    await expect(new Product({ name: "Basic", slug: "basic", type: "simple" }).validate()).rejects.toThrow(/price/i);
  });

  test("any product carrying variants validates without a parent price", async () => {
    const doc = new Product({
      name: "Hoodie", slug: "hoodie-2", type: "simple",
      variations: [{ name: "S", price: 1000, quantity: 1, sku: "H-S" }],
    });
    await expect(doc.validate()).resolves.toBeUndefined();
  });
});
