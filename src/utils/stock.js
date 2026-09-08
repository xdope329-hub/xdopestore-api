/**
 * Stock de productos y variaciones.
 *
 * - `stockProblems` comprueba un carrito contra las cantidades reales antes
 *   de crear el pedido (la tienda limita el selector, pero el servidor es
 *   quien manda). Puro: trabaja con las líneas ya pobladas.
 * - `reserveStock` / `releaseStock` descuentan o reponen el stock de un
 *   pedido UNA sola vez: se descuenta al confirmarse el pago (contra entrega
 *   al crearse; pasarela al completarse el cobro) y se repone al cancelar.
 *
 * Todo es ATÓMICO en Mongo, sin leer-modificar-guardar:
 *  1. el pedido "reclama" el flag `stock_reserved` con un updateOne
 *     condicional, así dos confirmaciones simultáneas (webhook + verify)
 *     solo descuentan una vez;
 *  2. cada línea se descuenta con un $inc condicionado a que haya cantidad
 *     suficiente (dos checkouts por la última unidad no pueden pasar los
 *     dos); si aun así falta, la cantidad se deja en 0 y se avisa en el log;
 *  3. después se recalculan los campos derivados del producto (estado de
 *     stock de variante y padre, cantidad total y precio "desde" del padre)
 *     con un $set que no pisa cantidades.
 *
 * Cantidades sin control (null) nunca se tocan. Una variante marcada a mano
 * como agotada con cantidad > 0 solo vuelve a "in_stock" al reponerse
 * stock (cancelación), nunca al vender.
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { deriveParentPricingFromVariations } = require('./parentPricing');

const idOf = (value) => String(value?._id ?? value?.id ?? value ?? '');
const sameId = (a, b) => idOf(a) === idOf(b);
const tracked = (quantity) => quantity !== null && quantity !== undefined && quantity !== '' && Number.isFinite(Number(quantity));
const modified = (result) => Number(result?.modifiedCount ?? result?.nModified ?? 0) > 0;
const matched = (result) => Number(result?.matchedCount ?? result?.n ?? 0) > 0;
const asObjectId = (value) => (mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : value);

/** Disponibilidad de una línea: `available` null cuando no se controla cantidad. */
function availableFor(product, variation) {
  const source = variation || product;
  if (!source) return { available: 0, sellable: false };
  const active = Number(product?.status ?? 1) !== 0 && Number(source.status ?? 1) !== 0;
  const inStock = source.stock_status !== 'out_of_stock';
  return { available: tracked(source.quantity) ? Number(source.quantity) : null, sellable: active && inStock };
}

/**
 * Líneas que no se pueden servir: [{ name, requested, available, reason }].
 * `cartItems` traen `product_id` poblado (documento) y, si aplica,
 * `variation_id`. Líneas sin producto poblado se ignoran. Un producto con
 * variantes exige la variante; la cantidad debe ser un entero ≥ 1.
 */
function stockProblems(cartItems = []) {
  const problems = [];
  for (const line of cartItems || []) {
    const product = line?.product_id;
    if (!product || typeof product !== 'object') continue;
    const requested = Number(line.quantity);
    const variations = Array.isArray(product.variations) ? product.variations : [];
    const variation = line.variation_id ? variations.find((v) => sameId(v, line.variation_id)) || null : null;
    const name = variation?.name ? `${product.name} (${variation.name})` : product.name;
    if (!Number.isInteger(requested) || requested < 1) {
      problems.push({ name, requested: line.quantity, available: null, reason: 'invalid_quantity' });
      continue;
    }
    if (variations.length && !variation) {
      problems.push({ name, requested, available: 0, reason: 'variation_required' });
      continue;
    }
    const { available, sellable } = availableFor(product, variation);
    if (!sellable) problems.push({ name, requested, available: 0, reason: 'sold_out' });
    else if (available !== null && requested > available) problems.push({ name, requested, available, reason: 'insufficient' });
  }
  return problems;
}

/** Mensaje legible para el cliente. */
function stockMessage(problems = []) {
  const parts = problems.map((p) => {
    if (p.reason === 'invalid_quantity') return `${p.name}: cantidad inválida`;
    if (p.reason === 'variation_required') return `${p.name}: elige talla y color`;
    return p.available > 0 ? `${p.name}: quedan ${p.available} (pediste ${p.requested})` : `${p.name}: agotado`;
  });
  return `Sin stock suficiente. ${parts.join('; ')}`;
}

/**
 * Cambia la cantidad de una línea de forma atómica (delta < 0 descuenta).
 * Devuelve { changed, shortfall, missing }: `shortfall` > 0 cuando no había
 * cantidad suficiente (se dejó en 0), `missing` cuando la variante ya no
 * existe. Cantidades sin control no se tocan.
 */
async function changeLineQuantity({ productId, variationId, delta }) {
  const qty = Math.abs(Number(delta) || 0);
  if (!qty) return { changed: false, shortfall: 0, missing: false };
  const filter = { _id: productId };
  if (variationId) {
    const vid = asObjectId(variationId);
    const path = 'variations.$[v].quantity';
    if (delta < 0) {
      const dec = await Product.updateOne(filter, { $inc: { [path]: delta } }, { arrayFilters: [{ 'v._id': vid, 'v.quantity': { $gte: qty } }] });
      if (modified(dec)) return { changed: true, shortfall: 0, missing: false };
      const clamp = await Product.updateOne(filter, { $set: { [path]: 0 } }, { arrayFilters: [{ 'v._id': vid, 'v.quantity': { $type: 'number', $lt: qty } }] });
      if (matched(clamp)) return { changed: modified(clamp), shortfall: qty, missing: false };
      const exists = await Product.countDocuments({ _id: productId, 'variations._id': vid });
      return { changed: false, shortfall: 0, missing: !exists };
    }
    const inc = await Product.updateOne(filter, { $inc: { [path]: delta } }, { arrayFilters: [{ 'v._id': vid, 'v.quantity': { $type: 'number' } }] });
    return { changed: modified(inc), shortfall: 0, missing: false };
  }
  if (delta < 0) {
    const dec = await Product.updateOne({ ...filter, quantity: { $gte: qty } }, { $inc: { quantity: delta } });
    if (modified(dec)) return { changed: true, shortfall: 0, missing: false };
    const clamp = await Product.updateOne({ ...filter, quantity: { $type: 'number', $lt: qty } }, { $set: { quantity: 0 } });
    return { changed: modified(clamp), shortfall: matched(clamp) ? qty : 0, missing: false };
  }
  const inc = await Product.updateOne({ ...filter, quantity: { $type: 'number' } }, { $inc: { quantity: delta } });
  return { changed: modified(inc), shortfall: 0, missing: false };
}

/**
 * Recalcula los campos derivados de un producto tras cambiar cantidades:
 * estado de stock de cada variante y del padre, cantidad total del padre y
 * su precio/descuento "desde" (variante más barata que se puede comprar).
 * Solo escribe esos campos ($set), nunca cantidades.
 * `direction` +1 = se repuso stock (puede volver a in_stock), -1 = se vendió.
 */
async function refreshDerived(productId, direction) {
  const product = await Product.findById(productId);
  if (!product) return;
  const set = {};
  const arrayFilters = [];
  const nextStatus = (target) => {
    if (!tracked(target.quantity)) return null;
    const qty = Number(target.quantity);
    if (qty <= 0 && target.stock_status !== 'out_of_stock') return 'out_of_stock';
    if (qty > 0 && direction > 0 && target.stock_status === 'out_of_stock') return 'in_stock';
    return null;
  };
  const variations = (Array.isArray(product.variations) ? product.variations : []).map((v) => (typeof v.toObject === 'function' ? v.toObject() : { ...v }));
  if (variations.length) {
    variations.forEach((variation, i) => {
      const status = nextStatus(variation);
      if (!status) return;
      variation.stock_status = status;
      set[`variations.$[v${i}].stock_status`] = status;
      arrayFilters.push({ [`v${i}._id`]: asObjectId(variation._id) });
    });
    const derived = deriveParentPricingFromVariations({ variations, price: null, sale_price: null, discount: null, quantity: null, stock_status: null });
    if (Number.isFinite(Number(derived.quantity))) set.quantity = Number(derived.quantity);
    if (derived.stock_status === 'out_of_stock' && product.stock_status !== 'out_of_stock') set.stock_status = 'out_of_stock';
    if (derived.stock_status === 'in_stock' && direction > 0 && product.stock_status === 'out_of_stock') set.stock_status = 'in_stock';
    if (Number.isFinite(Number(derived.price))) set.price = Number(derived.price);
    if (Number.isFinite(Number(derived.sale_price))) set.sale_price = Number(derived.sale_price);
    set.discount = Number.isFinite(Number(derived.discount)) && derived.discount !== null ? Number(derived.discount) : null;
  } else {
    const status = nextStatus(product);
    if (status) set.stock_status = status;
  }
  // Solo lo que cambia.
  for (const key of Object.keys(set)) {
    if (!key.startsWith('variations.') && product[key] === set[key]) delete set[key];
  }
  if (!Object.keys(set).length) return;
  await Product.updateOne({ _id: productId }, { $set: set }, arrayFilters.length ? { arrayFilters } : {});
}

/** Aplica el pedido al inventario (direction -1 descuenta, +1 repone). */
async function applyOrderToStock(order, direction) {
  const touched = new Set();
  const label = `pedido ${order.order_number || order._id}`;
  for (const line of order.products || []) {
    const productId = idOf(line.product_id);
    const qty = Number(line.quantity);
    if (!productId || !Number.isInteger(qty) || qty < 1) continue;
    const variationId = line.variation_id ? idOf(line.variation_id) : null;
    const result = await changeLineQuantity({ productId, variationId, delta: direction * qty });
    if (result.shortfall) console.warn(`[stock] ${label}: "${line.name || productId}" se vendió sin stock suficiente (faltaban ${result.shortfall}); revisar inventario`);
    if (result.missing) console.warn(`[stock] ${label}: la variante ${variationId} de "${line.name || productId}" ya no existe; revisar inventario a mano`);
    touched.add(productId);
  }
  for (const productId of touched) await refreshDerived(productId, direction);
}

// Reclama el flag del pedido de forma atómica: solo un llamador "gana".
async function claimReservation(orderId, reserve) {
  const Order = require('../models/Order');
  // Pedidos anteriores al flag (sin campo) nunca descontaron stock: se pueden
  // reservar ({ $ne: true }) pero no reponer (exige true).
  const filter = reserve ? { _id: orderId, stock_reserved: { $ne: true } } : { _id: orderId, stock_reserved: true };
  const result = await Order.updateOne(filter, { $set: { stock_reserved: reserve } });
  return modified(result);
}

/** Descuenta el stock del pedido si aún no se había descontado. */
async function reserveStock(orderId) {
  if (!(await claimReservation(orderId, true))) return false;
  const Order = require('../models/Order');
  const order = await Order.findById(orderId);
  if (!order) return false;
  try {
    await applyOrderToStock(order, -1);
  } catch (err) {
    console.error(`[stock] pedido ${order.order_number || orderId}: descuento incompleto, revisar inventario a mano —`, err?.message || err);
    throw err;
  }
  return true;
}

/** Repone el stock del pedido si estaba descontado (cancelación). */
async function releaseStock(orderId) {
  if (!(await claimReservation(orderId, false))) return false;
  const Order = require('../models/Order');
  const order = await Order.findById(orderId);
  if (!order) return false;
  try {
    await applyOrderToStock(order, +1);
  } catch (err) {
    console.error(`[stock] pedido ${order.order_number || orderId}: reposición incompleta, revisar inventario a mano —`, err?.message || err);
    throw err;
  }
  return true;
}

module.exports = { stockProblems, stockMessage, changeLineQuantity, refreshDerived, applyOrderToStock, reserveStock, releaseStock };
