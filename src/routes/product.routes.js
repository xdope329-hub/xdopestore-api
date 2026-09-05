const router = require('express').Router();
const mongoose = require('mongoose');
const slugify = require('slugify');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Attribute = require('../models/Attribute');
const Review = require('../models/Review');
const { REVIEW_STATUS, statusSlug } = require('../utils/reviewModeration');
const Order = require('../models/Order');
const OrderStatus = require('../models/OrderStatus');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const adminOnly = require('../middleware/adminOnly');
const { transformProduct } = require('../utils/transform');

// Split a token list into ObjectIds and slugs.
function splitIdsAndSlugs(tokens) {
  const ids = [];
  const slugs = [];
  tokens.forEach((t) => {
    if (mongoose.Types.ObjectId.isValid(t) && t.length === 24) ids.push(t);
    else slugs.push(t);
  });
  return { ids, slugs };
}

// Given category slugs/ids, return a flat list of category ObjectIds that
// includes the matched categories AND every descendant in the category tree.
async function expandCategoryIds(tokens) {
  const { ids: idTokens, slugs } = splitIdsAndSlugs(tokens);
  const matched = await Category.find({
    $or: [
      { _id: { $in: idTokens.length ? idTokens : [] } },
      { slug: { $in: slugs.length ? slugs : [] } },
    ],
  }).select('_id');
  const seedIds = matched.map((c) => c._id.toString());
  if (!seedIds.length) return [];

  // Walk the parent->children graph once.
  const allCats = await Category.find({}).select('_id parent_id');
  const childrenMap = new Map();
  allCats.forEach((c) => {
    const parent = c.parent_id ? c.parent_id.toString() : null;
    if (!parent) return;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent).push(c._id.toString());
  });

  const out = new Set(seedIds);
  const stack = [...seedIds];
  while (stack.length) {
    const current = stack.pop();
    const kids = childrenMap.get(current) || [];
    for (const k of kids) {
      if (!out.has(k)) {
        out.add(k);
        stack.push(k);
      }
    }
  }
  return Array.from(out);
}

// When attributes_ids is empty, look up Attribute docs by the variation attribute_value IDs
async function resolveAttributesFromVariations(product) {
  const obj = product.toJSON ? product.toJSON() : product;
  const hasAttributes = Array.isArray(obj.attributes_ids) && obj.attributes_ids.length > 0 && obj.attributes_ids[0]?.name;
  if (hasAttributes) return product;

  const avIds = new Set();
  (obj.variations || []).forEach(v => (v.attribute_values || []).forEach(av => {
    const id = av.id || av._id;
    if (id) avIds.add(String(id));
  }));
  if (!avIds.size) return product;

  const objectIds = Array.from(avIds).map(id => new mongoose.Types.ObjectId(id));
  const attrs = await Attribute.find({ 'attribute_values._id': { $in: objectIds } });
  if (attrs.length) {
    // Inject populated attributes into the product object so transformProduct can use them
    const raw = product.toJSON ? product.toJSON() : { ...product };
    raw.attributes_ids = attrs;
    return raw;
  }
  return product;
}

/**
 * Batch version for listings (home, collections, wishlist): ONE Attribute
 * query for the whole page. Products without linked `attributes_ids` used
 * to fall back to attributes derived from their variations with a hard-coded
 * "rectangle" style, so the same "Color" attribute showed as text buttons on
 * some cards and as color circles on others (and on the product page, which
 * already resolved the catalog). Now every product uses the catalog's style
 * and hex colors.
 */
async function resolveAttributesForProducts(products) {
  const hasAttributes = (obj) => Array.isArray(obj.attributes_ids) && obj.attributes_ids.length > 0 && obj.attributes_ids[0]?.name;
  const valueIdsOf = (obj) => {
    const ids = new Set();
    (obj.variations || []).forEach((v) => (v.attribute_values || []).forEach((av) => {
      const id = av.id || av._id;
      if (id && mongoose.Types.ObjectId.isValid(String(id))) ids.add(String(id));
    }));
    return ids;
  };

  // Never mutate the caller's objects (plain inputs are copied; documents
  // are serialized fresh by toJSON).
  const plain = products.map((p) => (p && p.toJSON ? p.toJSON() : p ? { ...p } : p));
  const pending = plain.filter((obj) => obj && !hasAttributes(obj));
  const allIds = new Set();
  pending.forEach((obj) => valueIdsOf(obj).forEach((id) => allIds.add(id)));
  if (!allIds.size) return plain;

  const attrs = await Attribute.find({ 'attribute_values._id': { $in: Array.from(allIds).map((id) => new mongoose.Types.ObjectId(id)) } });
  const attrByValueId = new Map();
  attrs.forEach((attr) => {
    const doc = attr.toJSON ? attr.toJSON() : attr;
    (doc.attribute_values || []).forEach((av) => attrByValueId.set(String(av._id || av.id), doc));
  });

  pending.forEach((obj) => {
    const seen = new Set();
    const resolved = [];
    valueIdsOf(obj).forEach((id) => {
      const attr = attrByValueId.get(id);
      const key = attr ? String(attr._id || attr.id) : null;
      if (attr && !seen.has(key)) { seen.add(key); resolved.push(attr); }
    });
    if (resolved.length) obj.attributes_ids = resolved;
  });
  return plain;
}

function paginate(query, req) {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  return { page, limit, skip: (page - 1) * limit };
}

async function buildFilter(query) {
  const filter = {};
  if (query.search) filter.name = new RegExp(query.search, 'i');
  if (query.status !== undefined) filter.status = Number(query.status);

  // Storefront sends `category=slug1,slug2` — resolve slugs to ObjectIds and
  // expand each match to include its descendant categories.
  if (query.category) {
    const tokens = String(query.category).split(',').map((s) => s.trim()).filter(Boolean);
    const ids = await expandCategoryIds(tokens);
    filter.categories = { $in: ids };
  }

  // Homepage / direct id usage: `category_ids=id1,id2` — already real ObjectIds.
  // Expand to descendant categories too (same behaviour as the slug-based
  // `category` filter above): a product assigned only to a subcategory must
  // still show up when its parent category is requested.
  if (query.category_ids) {
    const ids = String(query.category_ids).split(',').map((id) => id.trim()).filter(Boolean);
    const expanded = await expandCategoryIds(ids);
    filter.categories = { $in: expanded.length ? expanded : ids };
  }

  // Brand filter accepts slugs or ids, comma-separated.
  if (query.brand) {
    const tokens = String(query.brand).split(',').map((s) => s.trim()).filter(Boolean);
    const { ids: idTokens, slugs } = splitIdsAndSlugs(tokens);
    const matched = slugs.length
      ? await Brand.find({ slug: { $in: slugs } }).select('_id')
      : [];
    const allIds = [...idTokens, ...matched.map((b) => b._id.toString())];
    filter.brand_id = { $in: allIds };
  }

  // Price filter — tokens look like "min-max" with optional empty bound
  // (e.g. "0-100000", "100000-200000", "1000000-" for "and up"). We compare
  // against the *effective* (sale) price the customer actually sees on the
  // card: sale_price when it's set and > 0, otherwise price.
  if (query.price) {
    const tokens = String(query.price).split(',').map((s) => s.trim()).filter(Boolean);
    const ranges = tokens
      .map((tok) => {
        const [lo, hi] = tok.split('-');
        const min = lo === '' || lo === undefined ? null : Number(lo);
        const max = hi === '' || hi === undefined ? null : Number(hi);
        if (min !== null && Number.isNaN(min)) return null;
        if (max !== null && Number.isNaN(max)) return null;
        return { min, max };
      })
      .filter(Boolean);
    if (ranges.length) {
      const effectivePrice = {
        $cond: [{ $gt: [{ $ifNull: ['$sale_price', 0] }, 0] }, '$sale_price', '$price'],
      };
      filter.$or = ranges.map(({ min, max }) => {
        const conds = [];
        if (min !== null) conds.push({ $gte: [effectivePrice, min] });
        if (max !== null) conds.push({ $lte: [effectivePrice, max] });
        return { $expr: { $and: conds } };
      });
    }
  }

  if (query.is_featured) filter.is_featured = query.is_featured === 'true';
  if (query.is_trending) filter.is_trending = query.is_trending === 'true';
  // Admin product pickers send with_union_products=1 when `ids` contains the
  // products already saved in a form. In that mode the endpoint must still
  // return the other active products as selectable options. Treating `ids` as
  // a hard filter here leaves the picker empty when a saved product was
  // deleted, which prevents the administrator from replacing the stale ID.
  // Storefront requests do not send this flag, so their explicit ID filtering
  // remains unchanged.
  const includeOtherProducts = String(query.with_union_products) === '1';
  if (query.ids && !includeOtherProducts) {
    filter._id = { $in: query.ids.split(',').map((id) => id.trim()).filter(Boolean) };
  }
  return filter;
}

// Orden del listado. La tienda manda `sortBy` (asc | desc | low-high |
// high-low | a-z | z-a | discount-high-low) junto con `field=created_at`; el
// admin manda `sort` + `field` (la columna). Sin parámetros válidos: más
// recientes primero. `created_at` ascendente = el orden en que se agregaron
// los productos en el admin (portada → "Compra por Categoría").
const SORT_FIELDS = {
  created_at: 'createdAt', updated_at: 'updatedAt', name: 'name', sku: 'sku',
  price: 'price', sale_price: 'sale_price', discount: 'discount', quantity: 'quantity', status: 'status',
};
const SORT_PRESETS = {
  'low-high': { price: 1 }, 'high-low': { price: -1 },
  'a-z': { name: 1 }, 'z-a': { name: -1 },
  'discount-high-low': { discount: -1 },
};
const DEFAULT_SORT = { createdAt: -1 };
function resolveProductSort(query = {}) {
  const token = String(query.sort || query.sortBy || '').trim().toLowerCase();
  if (SORT_PRESETS[token]) return { ...SORT_PRESETS[token] };
  const field = SORT_FIELDS[String(query.field || '').trim().toLowerCase()];
  const direction = token === 'asc' ? 1 : token === 'desc' ? -1 : 0;
  if (!field || !direction) return { ...DEFAULT_SORT };
  return { [field]: direction };
}

/**
 * Productos relacionados / venta cruzada (pestaña Setup del admin): solo ids
 * válidos, sin repetidos y sin el propio producto. Hasta ahora el esquema no
 * tenía estos campos y Mongoose descartaba la selección al guardar.
 */
const RELATED_PRODUCT_KEYS = ['related_products', 'cross_sell_products'];
const refId = (v) => (v && typeof v === 'object' ? v._id || v.id : v);
const isObjectIdString = (v) => typeof v === 'string' && v.length === 24 && mongoose.Types.ObjectId.isValid(v);
function sanitizeRelatedProducts(body, selfId) {
  for (const key of RELATED_PRODUCT_KEYS) {
    if (body[key] === undefined) continue;
    const raw = Array.isArray(body[key]) ? body[key] : body[key] ? [body[key]] : [];
    const ids = [];
    for (const value of raw) {
      const id = String(refId(value) ?? '');
      if (!isObjectIdString(id) || id === String(selfId || '') || ids.includes(id)) continue;
      ids.push(id);
    }
    body[key] = ids;
  }
  return body;
}

/**
 * "Productos relacionados" al azar: hasta 6 productos activos, primero de las
 * mismas categorías y, si no alcanzan, de cualquier otra. Excluye el propio
 * producto y no repite.
 */
const RELATED_PRODUCTS_LIMIT = 6;
async function randomRelatedProductIds(product, limit = RELATED_PRODUCTS_LIMIT) {
  const picked = [];
  const excluded = () => [product._id, ...picked].map((id) => new mongoose.Types.ObjectId(String(id)));
  const sample = async (match, size) => {
    if (size <= 0) return;
    const rows = await Product.aggregate([{ $match: match }, { $sample: { size } }, { $project: { _id: 1 } }]);
    rows.forEach((row) => picked.push(String(row._id)));
  };
  const categoryIds = (product.categories || []).map(refId).filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));
  if (categoryIds.length) await sample({ status: 1, _id: { $nin: excluded() }, categories: { $in: categoryIds } }, limit);
  await sample({ status: 1, _id: { $nin: excluded() } }, limit - picked.length);
  return picked;
}

// Con "productos relacionados aleatorios" (valor por defecto) la tienda recibe
// una muestra distinta en cada visita; si el admin eligió la lista, se
// devuelve tal cual. `cross_sell_products` siempre es la lista guardada.
async function attachRelatedProducts(product, obj) {
  const random = product.is_random_related_products !== false;
  obj.is_random_related_products = random;
  obj.related_products = random
    ? await randomRelatedProductIds(product)
    : (obj.related_products || []).map((v) => String(refId(v)));
  obj.cross_sell_products = (obj.cross_sell_products || []).map((v) => String(refId(v)));
  return obj;
}

router.buildFilter = buildFilter; // exposed for focused unit tests
router.resolveProductSort = resolveProductSort;
router.sanitizeRelatedProducts = sanitizeRelatedProducts;
router.resolveAttributesForProducts = resolveAttributesForProducts; // shared with wishlist listing

// Fetch review stats and inject into product object. Solo las reseñas
// APROBADAS cuentan para el promedio y se listan; la del propio usuario se
// devuelve aparte (en cualquier estado) para que pueda editarla.
async function attachReviews(product, userId) {
  const reviews = await Review.find({ product_id: product._id, status: REVIEW_STATUS.APPROVED })
    .populate({ path: 'consumer_id', select: 'name profile_image_id', populate: { path: 'profile_image_id', select: 'original_url' } })
    .sort({ createdAt: -1 });

  const reviews_count = reviews.length;
  const rating_count = reviews_count
    ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews_count
    : 0;

  // Array of 5 slots (index 0 = 1-star count)
  const review_ratings = [0, 0, 0, 0, 0];
  reviews.forEach(r => { if (r.rating >= 1 && r.rating <= 5) review_ratings[r.rating - 1]++; });

  let unreviewedPurchase = false;
  let ownReview = null;
  if (userId) {
    const delivered = await OrderStatus.findOne({ slug: 'delivered' });
    [unreviewedPurchase, ownReview] = await Promise.all([
      // Compra entregada que aún no se calificó. `products[].reviewed_at` se
      // conserva aunque el administrador elimine la reseña (models/Order.js).
      Order.findOne({
        consumer_id: userId,
        status_id: delivered?._id,
        products: { $elemMatch: { product_id: product._id, reviewed_at: null } },
      }).then(Boolean),
      Review.findOne({ product_id: product._id, consumer_id: userId }),
    ]);
  }
  // Puede reseñar si tiene una compra sin calificar; si ya reseñó, puede
  // editar esa reseña. Una compra calificada cuya reseña fue eliminada no
  // vuelve a habilitar el formulario.
  const can_review = Boolean(ownReview) || unreviewedPurchase;

  const user_review = ownReview
    ? {
        id: ownReview._id,
        rating: ownReview.rating,
        description: ownReview.description,
        status: ownReview.status,
        status_slug: statusSlug(ownReview.status),
        created_at: ownReview.createdAt,
      }
    : null;

  const obj = product.toJSON ? product.toJSON() : product;
  return {
    ...obj,
    reviews_count,
    rating_count,
    review_ratings,
    can_review,
    user_review,
    reviews: reviews.map(r => ({
      id: r._id,
      rating: r.rating,
      description: r.description,
      consumer: r.consumer_id
        ? { name: r.consumer_id.name, profile_image: r.consumer_id.profile_image_id || null }
        : { name: 'Anonymous', profile_image: null },
      created_at: r.createdAt,
    })),
  };
}

// GET /product/price-range  — min/max price across active products. Used by
// the storefront to build dynamic Price filter buckets. Must come before /:id.
router.get('/price-range', async (req, res) => {
  const result = await Product.aggregate([
    { $match: { status: 1, price: { $gt: 0 } } },
    { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } },
  ]);
  if (!result.length) return res.json({ min: 0, max: 0 });
  res.json({ min: result[0].min, max: result[0].max });
});

// GET /product/minify/list  — must be before /:id
router.get('/minify/list', async (req, res) => {
  const products = await Product.find({ status: 1 })
    .select('name slug price sale_price product_thumbnail_id')
    .populate('product_thumbnail_id', 'asset_url original_url')
    .limit(100);
  res.json({ data: products });
});

// GET /product/slug/:slug  — for metadata (called by page.js)
router.get('/slug/:slug', optionalAuth, async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug })
    .populate('brand_id')
    .populate('categories')
    .populate('product_thumbnail_id')
    .populate('size_chart_image_id')
    .populate('product_images')
    .populate('product_meta_image_id')
    .populate('tax_id')
    .populate('attributes_ids')
    .populate('variations.variation_images', 'asset_url original_url');
  if (!product) return res.status(404).json({ message: 'Product not found' });
  const userId = req.user?._id;
  const enriched = await attachReviews(product, userId);
  const resolved = await resolveAttributesFromVariations(enriched);
  const result = transformProduct(resolved);
  result.product_meta_image = result.product_meta_image_id || null;
  await attachRelatedProducts(product, result);
  res.json(result);
});

// GET /product
router.get('/', async (req, res) => {
  const { page, limit, skip } = paginate(req.query, req);
  const filter = await buildFilter(req.query);

  // Rating filter — sidebar sends a comma-list of star values like "5,4".
  // Treat the smallest selected star as the threshold ("4 stars and up"),
  // then narrow the product set to those with avg review rating >= threshold.
  if (req.query.rating) {
    const stars = String(req.query.rating)
      .split(',')
      .map((n) => Number(n))
      .filter((n) => n >= 1 && n <= 5);
    if (stars.length) {
      const threshold = Math.min(...stars);
      const eligible = await Review.aggregate([
        { $match: { status: REVIEW_STATUS.APPROVED } },
        { $group: { _id: '$product_id', avg: { $avg: '$rating' } } },
        { $match: { avg: { $gte: threshold } } },
      ]);
      const allowedIds = eligible.map((r) => r._id);
      if (filter._id?.$in) {
        const allowedSet = new Set(allowedIds.map((id) => String(id)));
        filter._id.$in = filter._id.$in.filter((id) => allowedSet.has(String(id)));
      } else {
        filter._id = { $in: allowedIds };
      }
    }
  }

  const sort = resolveProductSort(req.query);
  let listQuery = Product.find(filter).skip(skip).limit(limit).sort(sort);
  // Orden alfabético (a-z / z-a) sin distinguir mayúsculas.
  if (sort.name) listQuery = listQuery.collation({ locale: 'es', strength: 2 });
  const [total, data] = await Promise.all([
    Product.countDocuments(filter),
    listQuery
      .populate('brand_id', 'name slug')
      .populate('categories', 'name slug')
      .populate('product_thumbnail_id', 'asset_url original_url')
      .populate('product_images', 'asset_url original_url')
      .populate('attributes_ids')
      // Imágenes de variación: las tarjetas del listado cambian la foto al
      // elegir color/talla. Sin poblar, `variation_image` llegaba como un id
      // suelto y la miniatura nunca cambiaba.
      .populate('variations.variation_images', 'asset_url original_url'),
  ]);

  // Lightweight review enrichment so list cards can show the real avg rating
  // and review count. One aggregation per page, keyed by product_id.
  const productIds = data.map((p) => p._id);
  const stats = productIds.length
    ? await Review.aggregate([
        { $match: { product_id: { $in: productIds }, status: REVIEW_STATUS.APPROVED } },
        { $group: { _id: '$product_id', count: { $sum: 1 }, avg: { $avg: '$rating' } } },
      ])
    : [];
  const statsMap = new Map(stats.map((s) => [String(s._id), s]));

  // Same attribute catalog resolution as the product page, so every card
  // renders the same selector style for the same attribute.
  const withAttributes = await resolveAttributesForProducts(data);
  const transformed = withAttributes.map((p) => {
    const obj = transformProduct(p);
    const s = statsMap.get(String(p._id));
    if (s) {
      obj.reviews_count = s.count;
      obj.rating_count = Math.round((s.avg || 0) * 10) / 10;
    }
    return obj;
  });

  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data: transformed });
});

// GET /product/:idOrSlug
router.get('/:id', optionalAuth, async (req, res) => {
  const param = req.params.id;
  const isObjectId = mongoose.Types.ObjectId.isValid(param) && param.length === 24;
  const query = isObjectId ? { _id: param } : { slug: param };

  const product = await Product.findOne(query)
    .populate('brand_id')
    .populate('categories')
    .populate('product_thumbnail_id')
    .populate('size_chart_image_id')
    .populate('product_images')
    .populate('tax_id')
    .populate('attributes_ids')
    .populate('variations.variation_images');
  if (!product) return res.status(404).json({ message: 'Product not found' });

  const userId = req.user?._id;
  const enriched = await attachReviews(product, userId);
  const resolved = await resolveAttributesFromVariations(enriched);
  res.json(await attachRelatedProducts(product, transformProduct(resolved)));
});

/**
 * The admin UI submits "" for every optional field the user left empty
 * (brand_id, product_thumbnail_id, discount, ...). Mongoose cannot cast ""
 * to ObjectId/Number/Date and throws — which used to 500 every UI product
 * create. Drop empty-string values for all non-String schema paths and
 * scrub empty entries out of arrays, recursively for variations too.
 */
function scrubEmptyNonStrings(obj, schema) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = schema && typeof schema.path === 'function' ? schema.path(key) : null;
    const isStringPath = path && path.instance === 'String';
    if (value === '' && !isStringPath) {
      delete obj[key]; // let the schema default (usually null) apply
      continue;
    }
    if (Array.isArray(value)) {
      obj[key] = value.filter((item) => item !== '' && item != null);
    }
  }
  return obj;
}

function normalizeProductBody(body, { selfId } = {}) {
  if (body.product_galleries_id !== undefined) {
    const ids = Array.isArray(body.product_galleries_id)
      ? body.product_galleries_id
      : Object.values(body.product_galleries_id || {});
    body.product_images = ids.filter(Boolean);
    delete body.product_galleries_id;
  }
  if (body.product_thumbnail_id === undefined && body.product_thumbnail?.id) {
    body.product_thumbnail_id = body.product_thumbnail.id;
  }
  // Normalize variation images
  if (Array.isArray(body.variations)) {
    body.variations = body.variations.map((v) => {
      if (v.variation_images_id !== undefined) {
        const ids = Array.isArray(v.variation_images_id)
          ? v.variation_images_id
          : Object.values(v.variation_images_id || {});
        v.variation_images = ids.filter(Boolean);
        delete v.variation_images_id;
      }
      return v;
    });
  }

  // Drop ""-valued non-string fields (top level and inside each variation)
  // so Mongoose casting never sees them.
  scrubEmptyNonStrings(body, Product.schema);
  const variationSchema = Product.schema.path('variations')?.schema;
  if (Array.isArray(body.variations)) {
    body.variations = body.variations.map((v) => scrubEmptyNonStrings(v, variationSchema));
  }

  deriveParentPricingFromVariations(body);
  sanitizeRelatedProducts(body, selfId);
  return body;
}

/**
 * Variable ("classified") products keep price / quantity / stock on each
 * variant, so the admin deliberately omits the top-level fields. The schema
 * still needs them (price is required, and the storefront shows a "from"
 * price and total stock), so derive them from the variants:
 *   price / sale_price -> cheapest sellable variant
 *   quantity           -> sum of variant stock
 *   stock_status       -> in_stock when any variant has stock
 * Simple products are left untouched.
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
    }))
    .filter((v) => Number.isFinite(v.price));

  if (priced.length === 0) return body;

  // Cheapest by what the shopper actually pays.
  const effective = (v) => (Number.isFinite(v.sale_price) && v.sale_price > 0 ? v.sale_price : v.price);
  const cheapest = priced.reduce((min, v) => (effective(v) < effective(min) ? v : min), priced[0]);

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

router.normalizeProductBody = normalizeProductBody; // exposed for unit tests
router.deriveParentPricingFromVariations = deriveParentPricingFromVariations;

// POST /product
router.post('/', auth, adminOnly, async (req, res) => {
  const body = normalizeProductBody(req.body);
  if (!body.slug && body.name) body.slug = slugify(body.name, { lower: true, strict: true });
  if (body.price === undefined || body.price === null) {
    // Should be unreachable once variants are priced — log the shape so a
    // genuine case is diagnosable instead of surfacing as a bare 500.
    console.warn('[product:create] no price after normalize', {
      name: body.name, type: body.type, product_type: body.product_type,
      variations: Array.isArray(body.variations) ? body.variations.length : 0,
    });
  }
  const product = await Product.create({ ...body, created_by_id: req.user._id });
  res.status(201).json(product);
});

// PUT /product/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  const body = normalizeProductBody(req.body, { selfId: req.params.id });
  const product = await Product.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

// DELETE /product/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json({ message: 'Product deleted' });
});

module.exports = router;
