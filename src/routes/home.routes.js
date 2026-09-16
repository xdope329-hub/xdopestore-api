// /home routes — alias for homepage management used by both frontends
const router = require('express').Router();
const Homepage = require('../models/Homepage');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { buildCategoryIndex, resolveCategoryIds } = require('../utils/homeCategoryProduct');

// Índice de categorías con productos activos (propios o de descendientes):
// raíces "vivas" para la lista por defecto y el conjunto de ids que el
// administrador puede tener seleccionados sin que la pestaña quede vacía.
async function getCategoryIndex() {
  const categories = await Category.find({}).select('_id parent_id status type createdAt');
  const usedCategoryIds = await Product.distinct('categories', { status: 1 });
  return buildCategoryIndex({ categories, usedCategoryIds });
}

// Build a dynamic homepage content from DB data
async function buildContent(categoryIndex) {
  const products = await Product.find({ status: 1 }).limit(20).select('_id');
  const brands = await Brand.find({ status: 1 }).limit(6).select('_id');

  const productIds = products.map(p => p._id.toString());
  const categoryIds = categoryIndex.liveTopLevelIds;
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
  const categoryIndex = await getCategoryIndex();
  const defaults = await buildContent(categoryIndex);
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
  // Categorías de la sección: las que eligió el administrador (Front →
  // Category Products), quitando solo las eliminadas, inactivas o sin
  // productos. Antes se sustituían SIEMPRE por todas las categorías vivas,
  // así que quitar una en el admin no cambiaba nada en la tienda. Sin lista
  // guardada se usa la lista viva (utils/homeCategoryProduct.js).
  const savedCategoryProduct = saved.category_product || {};
  const resolved = resolveCategoryIds({
    savedIds: savedCategoryProduct.category_ids,
    liveIds: defaults.category_product.category_ids,
    selectableIds: categoryIndex.selectableIds,
  });
  content.category_product = {
    ...(content.category_product || {}),
    status: content.category_product?.status ?? 1,
    title: content.category_product?.title || 'Compra por Categoría',
    category_ids: resolved.category_ids,
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
