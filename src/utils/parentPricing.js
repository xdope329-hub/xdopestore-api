/**
 * Precio, descuento, cantidad y estado de stock del producto PADRE a partir
 * de sus variantes. Lo usan el alta/edición de productos (product.routes.js)
 * y el stock (utils/stock.js) cada vez que una venta o cancelación cambia la
 * cantidad de una variante, para que el "desde" de la tarjeta y el badge de
 * descuento sigan a la variante más barata que de verdad se puede comprar.
 *
 * Solo rellena los campos que vengan vacíos (undefined / '' / null): para
 * recalcular todo, pásalos en null.
 */
function deriveParentPricingFromVariations(body) {
  // NOTE: deliberately not gated on body.type — any product that carries
  // priced variants can have its parent pricing derived. Gating on
  // type === 'classified' left a hole whenever the type field arrived
  // missing/misspelled, which resurfaced as a 500 "price is required".
  const variations = Array.isArray(body.variations) ? body.variations.filter(Boolean) : [];
  if (variations.length === 0) return body;

  const priced = variations
    .map((v) => ({
      price: Number(v.price),
      sale_price: v.sale_price === '' || v.sale_price == null ? null : Number(v.sale_price),
      discount: v.discount === '' || v.discount == null ? null : Number(v.discount),
      quantity: Number(v.quantity) || 0,
      stock_status: v.stock_status,
      status: v.status,
    }))
    .filter((v) => Number.isFinite(v.price));

  if (priced.length === 0) return body;

  // Cheapest by what the shopper actually pays, among the variants that can
  // actually be bought (active and not sold out): the same rule the product
  // page uses to pick its default variant, so the card's "from" price and
  // discount match what the shopper sees on entering. Disabled or sold-out
  // variants only count when nothing else is sellable.
  const effective = (v) => (Number.isFinite(v.sale_price) && v.sale_price > 0 ? v.sale_price : v.price);
  const sellable = priced.filter((v) => Number(v.status ?? 1) !== 0 && v.stock_status !== 'out_of_stock');
  const pool = sellable.length ? sellable : priced;
  const cheapest = pool.reduce((min, v) => (effective(v) < effective(min) ? v : min), pool[0]);

  if (body.price === undefined || body.price === '' || body.price === null) body.price = cheapest.price;
  if (body.sale_price === undefined || body.sale_price === '' || body.sale_price === null) {
    body.sale_price = Number.isFinite(cheapest.sale_price) ? cheapest.sale_price : cheapest.price;
  }
  if (body.discount === undefined || body.discount === '' || body.discount === null) {
    body.discount = Number.isFinite(cheapest.discount) ? cheapest.discount : null;
  }
  if (body.quantity === undefined || body.quantity === '' || body.quantity === null) {
    body.quantity = priced.reduce((sum, v) => sum + v.quantity, 0);
  }
  if (!body.stock_status) {
    const anyInStock = priced.some((v) => v.stock_status !== 'out_of_stock' && v.quantity > 0);
    body.stock_status = anyInStock ? 'in_stock' : 'out_of_stock';
  }
  return body;
}

module.exports = { deriveParentPricingFromVariations };
