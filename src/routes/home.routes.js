// /home routes — alias for homepage management used by both frontends
const router = require('express').Router();
const Homepage = require('../models/Homepage');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// Live top-level (parent-less) product category ids that have at least one
// active product — directly or via any descendant — so empty categories are hidden.
async function getLiveCategoryIds() {
  // 1. All active top-level product categories (candidates for tabs)
  const topLevel = await Category.find({
    status: 1,
    $or: [{ parent_id: null }, { parent_id: { $exists: false } }],
    $and: [{ $or: [{ type: 'product' }, { type: { $exists: false } }] }],
  })
    .sort({ createdAt: 1 })
    .select('_id');

  if (topLevel.length === 0) return [];

  // 2. All category ids that have at least one active product attached
  const usedCategoryIds = await Product.distinct('categories', { status: 1 });
  if (usedCategoryIds.length === 0) return [];

  // 3. Walk each used category up its parent chain so we mark its top-level ancestor
  const allCats = await Category.find({}).select('_id parent_id');
  const parentMap = new Map(allCats.map((c) => [c._id.toString(), c.parent_id ? c.parent_id.toString() : null]));

  const liveTopLevel = new Set();
  for (const id of usedCategoryIds) {
    let current = id ? id.toString() : null;
    const seen = new Set(); // guard against accidental cycles
    while (current && !seen.has(current)) {
      seen.add(current);
      const parent = parentMap.get(current);
      if (!parent) {
        liveTopLevel.add(current);
        break;
      }
      current = parent;
    }
  }

  // 4. Preserve original sort order from step 1, intersected with categories that have products
  return topLevel
    .map((c) => c._id.toString())
    .filter((id) => liveTopLevel.has(id));
}

// Build a dynamic homepage content from DB data
async function buildContent() {
  const products = await Product.find({ status: 1 }).limit(20).select('_id');
  const brands = await Brand.find({ status: 1 }).limit(6).select('_id');

  const productIds = products.map(p => p._id.toString());
  const categoryIds = await getLiveCategoryIds();
  const brandIds = brands.map(b => b._id.toString());

  return {
    products_ids: productIds,
    home_banner: { status: 0, banners: [] },
    offer_banner: { banner_1: { status: 0 }, banner_2: { status: 0 } },
    products_list: { status: 1, title: 'Productos Destacados', product_ids: productIds },
    category_product: { status: 1, title: 'Compra por Categoría', category_ids: categoryIds },
    brands: { status: 1, title: 'Nuestras Marcas', brand_ids: brandIds },
    services: { status: 0, banners: [] },
    social_media: { status: 0, banners: [] },
    parallax_banner: { status: 0 },
  };
}

// GET /home  or  GET /home/:slug
router.get('/:slug?', async (req, res) => {
  const slug = req.params.slug || 'default';
  const defaults = await buildContent();
  const page = await Homepage.findOne({ slug });
  const saved = (page && page.config && Object.keys(page.config).length > 0) ? page.config : {};
  // Merge: saved values take priority, but fill in any missing top-level keys from defaults
  const content = { ...defaults, ...saved };
  // Filter empty strings from products_ids
  if (Array.isArray(content.products_ids)) {
    content.products_ids = content.products_ids.filter(Boolean);
  }
  if (content.products_list && Array.isArray(content.products_list.product_ids)) {
    content.products_list.product_ids = content.products_list.product_ids.filter(Boolean);
  }
  // Always reflect the live category set from the DB so the storefront tabs match
  // whatever the admin currently has in Categories. Saved config keeps its title/status.
  const liveCategoryIds = defaults.category_product.category_ids;
  content.category_product = {
    ...(content.category_product || {}),
    status: content.category_product?.status ?? 1,
    title: content.category_product?.title || 'Compra por Categoría',
    category_ids: liveCategoryIds, // Overrides any statically saved category IDs with the fresh `liveCategoryIds`
  };

  // Brands section — preserve admin-controlled visibility (status) and chosen
  // brand_ids. We accept `brand` (singular) as a legacy alias for `brands`.
  const savedBrands = saved.brands ?? saved.brand ?? {};
  const adminBrandIds = Array.isArray(savedBrands.brand_ids) ? savedBrands.brand_ids.filter(Boolean) : null;
  content.brands = {
    status: savedBrands.status !== undefined ? Number(!!savedBrands.status) : (defaults.brands.status ?? 1),
    title: savedBrands.title || defaults.brands.title || 'Nuestras Marcas',
    brand_ids: adminBrandIds && adminBrandIds.length ? adminBrandIds : defaults.brands.brand_ids,
  };
  // Drop the legacy alias so the response stays canonical
  delete content.brand;

  res.json({ id: slug, slug, content, config: content });
});

// PUT /home/:slug  or  PUT /home
router.put('/:slug?', auth, adminOnly, async (req, res) => {
  const slug = req.params.slug || req.body.slug || 'default';
  const config = req.body.config || req.body.content;
  const page = await Homepage.findOneAndUpdate({ slug }, { config }, { new: true, upsert: true });
  res.json({ id: slug, slug, content: page.config, config: page.config });
});

module.exports = router;
