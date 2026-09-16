/**
 * Unit tests for cart variant resolution and pricing.
 *
 * A cart line for a variable product stores only variation_id. The cart API
 * used to (a) never return the variant — so the checkout couldn't show the
 * talla — and (b) price every line at the parent product's price, ignoring
 * the variant's own price. No database needed.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48);

const { findVariation, unitPrice } = require("../src/routes/cart.routes");

const id = (n) => n.toString(16).padStart(24, "0");

const product = {
  _id: id(1),
  price: 200000,
  sale_price: 160000,
  variations: [
    { _id: id(10), name: "S", price: 100000, sale_price: 80000 },
    { _id: id(11), name: "M", price: 120000, sale_price: null },
  ],
};

describe("findVariation", () => {
  test("resolves the variant by id (string or ObjectId-ish)", () => {
    expect(findVariation(product, id(10))?.name).toBe("S");
    expect(findVariation(product, id(11))?.name).toBe("M");
  });

  test("returns null for missing/unknown ids or products without variants", () => {
    expect(findVariation(product, null)).toBeNull();
    expect(findVariation(product, id(99))).toBeNull();
    expect(findVariation({ variations: undefined }, id(10))).toBeNull();
    expect(findVariation(null, id(10))).toBeNull();
  });
});

describe("unitPrice", () => {
  test("uses the variant's sale price when one is chosen", () => {
    expect(unitPrice(product, product.variations[0])).toBe(80000);
  });

  test("falls back to the variant's base price when it has no sale price", () => {
    expect(unitPrice(product, product.variations[1])).toBe(120000);
  });

  test("uses the product price when no variant is chosen", () => {
    expect(unitPrice(product, null)).toBe(160000);
    expect(unitPrice({ price: 5000 }, null)).toBe(5000);
  });

  test("never returns NaN", () => {
    expect(unitPrice({}, null)).toBe(0);
    expect(unitPrice(null, null)).toBe(0);
  });
});
