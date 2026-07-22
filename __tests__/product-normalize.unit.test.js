/**
 * Unit tests for normalizeProductBody — specifically the empty-string
 * scrubbing that prevents Mongoose CastErrors (500s) when the admin UI
 * submits "" for optional ObjectId/Number fields.
 * No database needed; models are loaded but never connected.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(48);

const { normalizeProductBody } = require("../src/routes/product.routes");

describe("normalizeProductBody", () => {
  test("drops empty-string ObjectId and Number fields", () => {
    const body = normalizeProductBody({
      name: "Producto",
      brand_id: "",
      product_thumbnail_id: "",
      size_chart_image_id: "",
      discount: "",
      sale_starts_at: "",
      price: 100,
    });
    expect(body).not.toHaveProperty("brand_id");
    expect(body).not.toHaveProperty("product_thumbnail_id");
    expect(body).not.toHaveProperty("size_chart_image_id");
    expect(body).not.toHaveProperty("discount");
    expect(body.price).toBe(100);
  });

  test("keeps empty strings for String fields", () => {
    const body = normalizeProductBody({ name: "P", meta_description: "" });
    expect(body).toHaveProperty("meta_description", "");
  });

  test("filters empty entries out of arrays", () => {
    const body = normalizeProductBody({
      name: "P",
      categories: ["abc123", "", null],
      product_galleries_id: ["img1", ""],
    });
    expect(body.categories).toEqual(["abc123"]);
    expect(body.product_images).toEqual(["img1"]);
  });

  test("scrubs empty-string fields inside variations", () => {
    const body = normalizeProductBody({
      name: "P",
      variations: [{ name: "Var", price: 10, digital_file_ids: ["", "f1"], variation_image_id: "" }],
    });
    expect(body.variations[0]).not.toHaveProperty("variation_image_id");
    expect(body.variations[0].digital_file_ids).toEqual(["f1"]);
    expect(body.variations[0].price).toBe(10);
  });

  test("still maps product_galleries_id and thumbnail object as before", () => {
    const body = normalizeProductBody({
      name: "P",
      product_thumbnail: { id: "th1" },
      product_galleries_id: { 0: "a", 1: "b" },
    });
    expect(body.product_thumbnail_id).toBe("th1");
    expect(body.product_images).toEqual(["a", "b"]);
  });
});
