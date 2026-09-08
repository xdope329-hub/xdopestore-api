/**
 * Simulación mínima del modelo Product para las pruebas de stock: soporta
 * `findById`, `countDocuments` y `updateOne` con $inc/$set sobre `quantity`
 * (producto simple) o `variations.$[tag].campo` con arrayFilters, con los
 * filtros numéricos que usa utils/stock.js ($gte, $lt, $type: 'number').
 * Devuelve { matchedCount, modifiedCount } como Mongoose.
 */
function matchNumber(value, cond) {
  if (cond === undefined) return true;
  if (cond === null || typeof cond !== 'object') return value === cond;
  if (cond.$type === 'number' && typeof value !== 'number') return false;
  if (cond.$gte !== undefined && !(typeof value === 'number' && value >= cond.$gte)) return false;
  if (cond.$lt !== undefined && !(typeof value === 'number' && value < cond.$lt)) return false;
  return true;
}

function fakeProductModel(store) {
  const clone = () => ({ ...store, variations: (store.variations || []).map((v) => ({ ...v })) });
  const resolveTargets = (path, options) => {
    const m = path.match(/^variations\.\$\[(\w+)\]\.(\w+)$/);
    if (!m) return [{ target: store, key: path }];
    const [, tag, key] = m;
    const cond = (options.arrayFilters || []).find((f) => Object.keys(f).some((k) => k.startsWith(`${tag}.`))) || {};
    const matches = (store.variations || []).filter((v) =>
      Object.entries(cond).every(([k, c]) => {
        const field = k.slice(tag.length + 1);
        return field === '_id' ? String(v._id) === String(c) : matchNumber(v[field], c);
      })
    );
    return matches.map((v) => ({ target: v, key }));
  };
  return {
    findById: jest.fn(async (id) => (String(id) === String(store._id) ? clone() : null)),
    countDocuments: jest.fn(async (filter) => {
      if (String(filter._id) !== String(store._id)) return 0;
      if (filter['variations._id']) return (store.variations || []).some((v) => String(v._id) === String(filter['variations._id'])) ? 1 : 0;
      return 1;
    }),
    updateOne: jest.fn(async (filter, update, options = {}) => {
      if (String(filter._id) !== String(store._id)) return { matchedCount: 0, modifiedCount: 0 };
      if (!matchNumber(store.quantity, filter.quantity)) return { matchedCount: 0, modifiedCount: 0 };
      let modifiedCount = 0;
      let matchedAny = true;
      for (const [path, delta] of Object.entries(update.$inc || {})) {
        const targets = resolveTargets(path, options);
        if (!targets.length) matchedAny = false;
        for (const { target, key } of targets) { target[key] = Number(target[key]) + delta; modifiedCount++; }
      }
      for (const [path, value] of Object.entries(update.$set || {})) {
        const targets = resolveTargets(path, options);
        if (!targets.length && path.startsWith('variations.')) matchedAny = false;
        for (const { target, key } of targets) { if (target[key] !== value) { target[key] = value; modifiedCount++; } }
      }
      return { matchedCount: matchedAny ? 1 : 0, modifiedCount };
    }),
    store,
  };
}

/** Pedido simulado con el flag `stock_reserved` reclamado de forma condicional. */
function fakeOrderModel(orderDoc) {
  return {
    findById: jest.fn(async (id) => (String(id) === String(orderDoc._id) ? orderDoc : null)),
    updateOne: jest.fn(async (filter, update) => {
      const value = update?.$set?.stock_reserved;
      if (value === undefined) return { matchedCount: 1, modifiedCount: 1 };
      const current = orderDoc.stock_reserved;
      const ok = filter.stock_reserved === true ? current === true : filter.stock_reserved?.$ne === true ? current !== true : true;
      if (!ok || String(filter._id) !== String(orderDoc._id)) return { matchedCount: 0, modifiedCount: 0 };
      orderDoc.stock_reserved = value;
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    doc: orderDoc,
  };
}

module.exports = { fakeProductModel, fakeOrderModel, matchNumber };
