/**
 * Sección "Compra por Categoría" de la portada. Módulo PURO (sin modelos)
 * para testearlo en aislamiento (home-category-product.unit.test.js).
 *
 * Regla: manda lo que el administrador guardó en Front → Category Products.
 * El servidor solo quita de esa lista las categorías que ya no existen,
 * están inactivas o no tienen productos activos. Si el admin nunca guardó
 * una lista (o todo lo guardado quedó obsoleto), se usa la lista "viva":
 * categorías raíz activas con productos, en orden de creación.
 */

const str = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : String(v));

/**
 * Índice de categorías con productos.
 * - `categories`: [{ _id, parent_id, status, type, createdAt }] (todas).
 * - `usedCategoryIds`: ids de categoría con al menos un producto activo.
 * Devuelve:
 * - `withProducts`: Set de ids (cualquier nivel) con productos propios o de
 *   descendientes.
 * - `liveTopLevelIds`: raíces activas de tipo producto con productos, en
 *   orden de creación.
 * - `selectableIds`: Set de ids activos de tipo producto con productos.
 */
function buildCategoryIndex({ categories = [], usedCategoryIds = [] } = {}) {
  const byId = new Map(categories.map((c) => [str(c._id), c]));
  const withProducts = new Set();
  for (const raw of usedCategoryIds) {
    let current = raw ? str(raw) : null;
    const seen = new Set();
    while (current && byId.has(current) && !seen.has(current)) {
      seen.add(current);
      withProducts.add(current);
      const parent = byId.get(current).parent_id;
      current = parent ? str(parent) : null;
    }
  }

  const isProductType = (c) => !c.type || c.type === 'product';
  const isActive = (c) => Number(c.status ?? 1) === 1;

  const selectableIds = new Set(
    categories.filter((c) => isActive(c) && isProductType(c) && withProducts.has(str(c._id))).map((c) => str(c._id))
  );

  const liveTopLevelIds = categories
    .filter((c) => !c.parent_id && isActive(c) && isProductType(c) && withProducts.has(str(c._id)))
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    .map((c) => str(c._id));

  return { withProducts, liveTopLevelIds, selectableIds };
}

/**
 * Lista final de categorías de la sección.
 * - `savedIds` no es un array → nunca se guardó: lista viva.
 * - `savedIds` es [] → el admin quitó todas: [] (la tienda oculta la sección).
 * - `savedIds` con ids → los guardados que sigan siendo válidos, en el orden
 *   del admin; si ninguno es válido (datos obsoletos) → lista viva.
 */
function resolveCategoryIds({ savedIds, liveIds = [], selectableIds = new Set() } = {}) {
  if (!Array.isArray(savedIds)) return { category_ids: [...liveIds], source: 'live' };
  if (savedIds.length === 0) return { category_ids: [], source: 'admin' };
  const selectable = selectableIds instanceof Set ? selectableIds : new Set([...selectableIds].map(str));
  const seen = new Set();
  const kept = [];
  for (const raw of savedIds) {
    if (raw === null || raw === undefined || raw === '') continue;
    const id = str(raw);
    if (seen.has(id) || !selectable.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  if (!kept.length) return { category_ids: [...liveIds], source: 'live' };
  return { category_ids: kept, source: 'admin' };
}

module.exports = { buildCategoryIndex, resolveCategoryIds };
