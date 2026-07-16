// Attachment usage scanner.
//
// Given the whole DB, returns a Set<string> of Attachment IDs that are
// referenced somewhere. Used by the Media page to badge in-use items and by
// the DELETE handlers to refuse (409) deleting an image that is still wired
// up. Setting.values / ThemeOption.options / Preset snapshots are Mixed
// documents, so we walk them recursively and collect anything that looks
// like an ObjectId string (24 hex chars). All non-attachment ObjectIds in
// scanned models are excluded via field projection.

const mongoose = require('mongoose');

const OBJECTID_RE = /^[a-fA-F0-9]{24}$/;

function collectIds(value, out) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (OBJECTID_RE.test(value)) out.add(value);
    return;
  }
  if (value instanceof mongoose.Types.ObjectId) {
    out.add(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectIds(v, out);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectIds(v, out);
  }
}

async function getUsedAttachmentIds() {
  const used = new Set();

  const Product = require('../models/Product');
  const Category = require('../models/Category');
  const Brand = require('../models/Brand');
  const Blog = require('../models/Blog');
  const User = require('../models/User');
  const Preset = require('../models/Preset');
  const Setting = require('../models/Setting');
  const ThemeOption = require('../models/ThemeOption');

  const [products, categories, brands, blogs, users, presets, settings, themeOptions] = await Promise.all([
    Product.find({}, 'product_thumbnail_id size_chart_image_id product_images variations.variation_images').lean(),
    Category.find({}, 'category_image_id category_icon_id category_meta_image_id').lean(),
    Brand.find({}, 'brand_image_id').lean(),
    Blog.find({}, 'blog_thumbnail_id blog_meta_image_id').lean(),
    User.find({}, 'profile_image_id').lean(),
    Preset.find({}, 'thumbnail_id settingSnapshot themeSnapshot').lean(),
    Setting.find({}, 'values').lean(),
    ThemeOption.find({}, 'options').lean(),
  ]);

  for (const list of [products, categories, brands, blogs, users, presets]) {
    for (const doc of list) collectIds(doc, used);
  }
  for (const s of settings) collectIds(s.values, used);
  for (const t of themeOptions) collectIds(t.options, used);

  return used;
}

module.exports = { getUsedAttachmentIds, collectIds };
