/**
 * Precio efectivo de venta (utils/transform.js → normalizePricing).
 * Sin descuento el admin guarda sale_price = price, pero los productos
 * importados o sembrados traen sale_price null (o 0): la tienda pintaba
 * "$0,00" en tarjetas, ficha, carrito y resumen del checkout mientras el
 * pedido cobraba el precio real. Sin base de datos.
 */

const { transformProduct, normalizePricing } = require("../src/utils/transform");

const product = (overrides = {}) => ({
  _id: "000000000000000000000700",
  id: "000000000000000000000700",
  name: "Vestido Slip de Satén",
  product_images: [],
  variations: [],
  ...overrides,
});

describe("normalizePricing", () => {
  test("sin precio de venta (null, 0, '') se usa el precio base", () => {
    expect(normalizePricing({ price: 249900, sale_price: null })).toMatchObject({ sale_price: 249900 });
    expect(normalizePricing({ price: 249900, sale_price: 0 })).toMatchObject({ sale_price: 249900 });
    expect(normalizePricing({ price: 249900, sale_price: "" })).toMatchObject({ sale_price: 249900 });
    expect(normalizePricing({ price: 249900 })).toMatchObject({ sale_price: 249900 });
  });

  test("un precio de venta válido se respeta", () => {
    expect(normalizePricing({ price: 189900, sale_price: 149900, discount: 21 })).toMatchObject({ sale_price: 149900, discount: 21 });
  });

  test("el descuento vacío queda en 0 y uno válido se conserva", () => {
    expect(normalizePricing({ price: 100, sale_price: null, discount: null }).discount).toBe(0);
    expect(normalizePricing({ price: 100, sale_price: 100 }).discount).toBe(0);
    expect(normalizePricing({ price: 100, sale_price: 80, discount: "20" }).discount).toBe("20");
    expect(normalizePricing({ price: 100, sale_price: 80, discount: -5 }).discount).toBe(0);
  });

  test("sin precio base no inventa nada", () => {
    expect(normalizePricing({ sale_price: null })).toMatchObject({ sale_price: null });
    expect(normalizePricing(null)).toBeNull();
  });
});

describe("transformProduct", () => {
  test("producto y variantes salen con precio de venta real", () => {
    const out = transformProduct(
      product({
        price: 249900,
        sale_price: null,
        discount: null,
        variations: [
          { name: "XS / Negro", price: 249900, sale_price: null, discount: null, variation_images: [] },
          { name: "S / Negro", price: 259900, sale_price: 219900, discount: 15, variation_images: [] },
        ],
      })
    );
    expect(out.sale_price).toBe(249900);
    expect(out.discount).toBe(0);
    expect(out.variations[0]).toMatchObject({ sale_price: 249900, discount: 0 });
    expect(out.variations[1]).toMatchObject({ sale_price: 219900, discount: 15 });
  });

  test("un producto con oferta no cambia", () => {
    const out = transformProduct(product({ price: 189900, sale_price: 149900, discount: 21 }));
    expect(out).toMatchObject({ price: 189900, sale_price: 149900, discount: 21 });
  });
});
