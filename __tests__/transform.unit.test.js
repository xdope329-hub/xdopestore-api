/**
 * Unit tests for transformProduct's defensive array cleanup.
 *
 * Older API versions could persist null entries inside product.tags (the
 * admin edit page used to submit tags.map(t => t.id) over name strings,
 * yielding [null, ...]). A null in tags/categories/product_images crashes
 * the admin edit form (TypeError: Cannot read properties of null,
 * reading 'id'), so transformProduct must never emit one.
 * No database needed.
 */

const { transformProduct } = require("../src/utils/transform");

const baseProduct = (overrides = {}) => ({
  _id: "000000000000000000000700",
  id: "000000000000000000000700",
  name: "Vestido Midi",
  product_images: [],
  variations: [],
  ...overrides,
});

describe("transformProduct null scrubbing", () => {
  test("drops null and empty-string entries from tags", () => {
    const out = transformProduct(baseProduct({ tags: [null, "Verano", null, "", "Más Vendido"] }));
    expect(out.tags).toEqual(["Verano", "Más Vendido"]);
  });

  test("drops null entries from categories", () => {
    const cat = { _id: "000000000000000000000200", id: "000000000000000000000200", name: "Mujer" };
    const out = transformProduct(baseProduct({ categories: [null, cat] }));
    expect(out.categories).toEqual([cat]);
  });

  test("drops null entries from product_images and product_galleries", () => {
    const img = { _id: "000000000000000000000101", id: "000000000000000000000101", original_url: "x" };
    const out = transformProduct(baseProduct({ product_images: [null, img], product_thumbnail_id: null }));
    expect(out.product_images).toEqual([img]);
    expect(out.product_galleries).toEqual([img]);
  });

  test("leaves valid tags untouched and preserves thumbnail-first galleries", () => {
    const thumb = { _id: "000000000000000000000100", id: "000000000000000000000100" };
    const img = { _id: "000000000000000000000101", id: "000000000000000000000101" };
    const out = transformProduct(baseProduct({ tags: ["Verano"], product_thumbnail_id: thumb, product_images: [img] }));
    expect(out.tags).toEqual(["Verano"]);
    expect(out.product_galleries).toEqual([thumb, img]);
  });

  test("handles products without tags/categories arrays", () => {
    const out = transformProduct(baseProduct());
    expect(out.tags).toBeUndefined();
    expect(out.related_products).toEqual([]);
  });
});
