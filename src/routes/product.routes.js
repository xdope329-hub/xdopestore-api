const router = require('express').Router();
const mongoose = require('mongoose');
const slugify = require('slugify');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Attribute = require('../models/Attribute');
const Review = require('../models/Review');
const Order = require('../models/Order');
const OrderStatus = require('../models/OrderStatus');
const auth = require('../middleware/auth');
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
  if (query.ids) filter._id = { $in: query.ids.split(',').map((id) => id.trim()).filter(Boolean) };
  return filter;
}

// Fetch review stats and inject into product object
async function attachReviews(product, userId) {
  const reviews = await Review.find({ product_id: product._id })
    .populate({ path: 'consumer_id', select: 'name profile_image_id', populate: { path: 'profile_image_id', select: 'original_url' } })
    .sort({ createdAt: -1 });

  const reviews_count = reviews.length;
  const rating_count = reviews_count
    ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews_count
    : 0;

  // Array of 5 slots (index 0 = 1-star count)
  const review_ratings = [0, 0, 0, 0, 0];
  reviews.forEach(r => { if (r.rating >= 1 && r.rating <= 5) review_ratings[r.rating - 1]++; });

  let hasPurchased = false;
  if (userId) {
    const delivered = await OrderStatus.findOne({ slug: 'delivered' });
    hasPurchased = !!(await Order.findOne({
      consumer_id: userId,
      'products.product_id': product._id,
      status_id: delivered?._id,
    }));
  }
  const can_review = hasPurchased && !reviews.some(r => r.consumer_id?._id?.toString() === userId?.toString());

  const user_review = userId
    ? reviews.find(r => r.consumer_id?._id?.toString() === userId.toString()) || null
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
router.get('/slug/:slug', async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug })
    .populate('brand_id')
    .populate('categories')
    .populate('product_thumbnail_id')
    .populate('size_chart_image_id')
    .populate('product_images')
    .populate('product_meta_image_id')
    .populate('tax_id')
    .populate('attributes_ids');
  if (!product) return res.status(404).json({ message: 'Product not found' });
  const userId = req.user?._id;
  const enriched = await attachReviews(product, userId);
  const resolved = await resolveAttributesFromVariations(enriched);
  const result = transformProduct(resolved);
  result.product_meta_image = result.product_meta_image_id || null;
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

  const [total, data] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .skip(skip).limit(limit)
      .sort({ createdAt: -1 })
      .populate('brand_id', 'name slug')
      .populate('categories', 'name slug')
      .populate('product_thumbnail_id', 'asset_url original_url')
      .populate('product_images', 'asset_url original_url')
      .populate('attributes_ids'),
  ]);

  // Lightweight review enrichment so list cards can show the real avg rating
  // and review count. One aggregation per page, keyed by product_id.
  const productIds = data.map((p) => p._id);
  const stats = productIds.length
    ? await Review.aggregate([
        { $match: { product_id: { $in: productIds } } },
        { $group: { _id: '$product_id', count: { $sum: 1 }, avg: { $avg: '$rating' } } },
      ])
    : [];
  const statsMap = new Map(stats.map((s) => [String(s._id), s]));

  const transformed = data.map((p) => {
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
router.get('/:id', async (req, res) => {
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
  res.json(transformProduct(resolved));
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

function normalizeProductBody(body) {
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
  return body;
}

router.normalizeProductBody = normalizeProductBody; // exposed for unit tests

// POST /product
router.post('/', auth, adminOnly, async (req, res) => {
  const body = normalizeProductBody(req.body);
  if (!body.slug && body.name) body.slug = slugify(body.name, { lower: true, strict: true });
  const product = await Product.create({ ...body, created_by_id: req.user._id });
  res.status(201).json(product);
});

// PUT /product/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  const body = normalizeProductBody(req.body);
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
