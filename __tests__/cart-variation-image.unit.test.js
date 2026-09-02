/**
 * Cart lines must carry the chosen variation's photo. The header cart drawer
 * showed the product thumbnail for every color because the cart serializers
 * resolved the variant from a product whose variation_images were never
 * populated. No database needed.
 */

const { shapeCartVariation, CART_PRODUCT_POPULATE } = require("../src/utils/cartPricing");

const id = (n) => n.toString(16).padStart(24, "0");
const IMG = { _id: id(900), original_url: "https://cdn.example/cafe-m.jpg" };

const product = {
  _id: id(1),
  variations: [
    { _id: id(10), name: "Cafe/M", price: 100000, variation_images: [IMG, { _id: id(901), original_url: "https://cdn.example/cafe-m-2.jpg" }] },
    { _id: id(11), name: "Beige/M", price: 100000, variation_images: [] },
    { _id: id(12), name: "Gris/M", price: 100000, variation_images: [id(902)] }, // unpopulated id
  ],
};

describe("shapeCartVariation", () => {
  test("exposes the first populated image as variation_image and all of them as galleries", () => {
    const v = shapeCartVariation(product, id(10));
    expect(v.name).toBe("Cafe/M");
    expect(v.variation_image).toEqual(expect.objectContaining({ original_url: "https://cdn.example/cafe-m.jpg" }));
    expect(v.variation_galleries).toHaveLength(2);
  });

  test("returns null image when the variation has no photos or only unpopulated ids", () => {
    expect(shapeCartVariation(product, id(11)).variation_image).toBeNull();
    expect(shapeCartVariation(product, id(12)).variation_image).toBeNull();
    expect(shapeCartVariation(product, id(12)).variation_galleries).toEqual([]);
  });

  test("returns null for lines without a variation", () => {
    expect(shapeCartVariation(product, null)).toBeNull();
    expect(shapeCartVariation(product, id(99))).toBeNull();
    expect(shapeCartVariation(null, id(10))).toBeNull();
  });
});

describe("CART_PRODUCT_POPULATE", () => {
  test("populates the thumbnail and the variation images", () => {
    expect(CART_PRODUCT_POPULATE.path).toBe("product_id");
    const paths = CART_PRODUCT_POPULATE.populate.map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(["product_thumbnail_id", "variations.variation_images"]));
  });
});
