// Attachment usage scanner.
//
// Returns two sets — { usedIds, usedUrls } — that together describe every
// attachment referenced anywhere in the DB. The Media page badges an item
// as in-use when its _id is in usedIds OR its original_url is in usedUrls,
// and the delete endpoints refuse to remove such items unless ?force=true.
//
// Two collection strategies are needed because attachments are referenced
// two different ways:
//
//   1. As ObjectId — stored under keys ending in `_id` / `_ids` (e.g.
//      product_thumbnail_id, header_logo_id, category_ids).
//   2. As raw Cloudinary URL — many theme banners / service icons store
//      only `original_url` under keys like `image_url`, `bg_image`,
//      `banner_image_url`, `icon`, etc. There is no ID kept alongside.
//
// For Setting.values / ThemeOption.options / Homepage.config / Preset
// snapshots (all Mixed docs) we scan by key convention only — collecting
// IDs from `*_id` / `*_ids` keys, and URLs from any string that looks like
// a Cloudinary asset. Standalone object copies of attachments (e.g.
// `logo.header_logo = { id, original_url, ... }`) are ignored on purpose:
// when the admin replaces a logo, the copy under `header_logo` can still
// point at the old attachment while `header_logo_id` already holds the
// new one, and counting both would mark two files as used when only one
// is truly selected.

const mongoose = require('mongoose');

const OBJECTID_RE = /^[a-fA-F0-9]{24}$/;

const isObjectIdString = (v) => typeof v === 'string' && OBJECTID_RE.test(v);
const isObjectId = (v) => v instanceof mongoose.Types.ObjectId;
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
const looksLikeAttachmentUrl = (v) => isUrl(v) && /(cloudinary\.com|res\.cloudinary|\/uploads?\/)/i.test(v);

const ID_KEY_RE = /(^|_)ids?$/i; // matches "id", "ids", "_id", "_ids", "*_id", "*_ids"

// Deep collector for Mixed docs where we only trust `*_id`/`*_ids` keys and
// URL-shaped string values. Never pulls IDs out of full attachment objects.
function collectFromMixed(node, usedIds, usedUrls) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const v of node) collectFromMixed(v, usedIds, usedUrls);
    return;
  }
  if (typeof node === 'object' && !isObjectId(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (ID_KEY_RE.test(k)) {
        if (isObjectId(v) || isObjectIdString(v)) {
          usedIds.add(String(v));
        } else if (Array.isArray(v)) {
          for (const item of v) {
            if (isObjectId(item) || isObjectIdString(item)) usedIds.add(String(item));
          }
        }
        // don't recurse into id-keyed values further
        continue;
      }
      if (typeof v === 'string') {
        if (looksLikeAttachmentUrl(v)) usedUrls.add(v);
        continue;
      }
      collectFromMixed(v, usedIds, usedUrls);
    }
    return;
  }
  // primitives at the top level are ignored
}

// Simpler collector for STRUCTURED docs where we already projected only
// attachment fields — every ObjectId encountered is by definition an
// Attachment reference and is safe to pull.
function collectFromStructured(node, usedIds) {
  if (node === null || node === undefined) return;
  if (isObjectId(node) || isObjectIdString(node)) {
    usedIds.add(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectFromStructured(v, usedIds);
    return;
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node)) collectFromStructured(v, usedIds);
  }
}

async function getUsedAttachmentIds() {
  const usedIds = new Set();
  const usedUrls = new Set();

  const Product = require('../models/Product');
  const Category = require('../models/Category');
  const Brand = require('../models/Brand');
  const Blog = require('../models/Blog');
  const User = require('../models/User');
  const Preset = require('../models/Preset');
  const Setting = require('../models/Setting');
  const ThemeOption = require('../models/ThemeOption');
  const Homepage = require('../models/Homepage');

  const [products, categories, brands, blogs, users, presets, settings, themeOptions, homepages] = await Promise.all([
    Product.find({}, 'product_thumbnail_id size_chart_image_id product_images variations.variation_images').lean(),
    Category.find({}, 'category_image_id category_icon_id category_meta_image_id').lean(),
    Brand.find({}, 'brand_image_id').lean(),
    Blog.find({}, 'blog_thumbnail_id blog_meta_image_id').lean(),
    User.find({}, 'profile_image_id').lean(),
    Preset.find({}, 'thumbnail_id settingSnapshot themeSnapshot').lean(),
    Setting.find({}, 'values').lean(),
    ThemeOption.find({}, 'options').lean(),
    Homepage.find({}, 'config').lean(),
  ]);

  for (const list of [products, categories, brands, blogs, users]) {
    for (const doc of list) collectFromStructured(doc, usedIds);
  }
  for (const p of presets) {
    collectFromStructured(p.thumbnail_id, usedIds);
    collectFromMixed(p.settingSnapshot, usedIds, usedUrls);
    collectFromMixed(p.themeSnapshot, usedIds, usedUrls);
  }
  for (const s of settings) collectFromMixed(s.values, usedIds, usedUrls);
  for (const t of themeOptions) collectFromMixed(t.options, usedIds, usedUrls);
  for (const h of homepages) collectFromMixed(h.config, usedIds, usedUrls);

  return { usedIds, usedUrls };
}

// Backwards-compat helper: some callers only need the ID set.
async function getUsedAttachmentIdSet() {
  const { usedIds } = await getUsedAttachmentIds();
  return usedIds;
}

module.exports = { getUsedAttachmentIds, getUsedAttachmentIdSet };
