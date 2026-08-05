/**
 * Adds alias fields to match admin-dashboard frontend expectations.
 * The frontend uses short names (product_thumbnail, profile_image, etc.)
 * while our models store *_id references.
 */

function addTimestampAliases(obj) {
  if (obj.createdAt !== undefined) obj.created_at = obj.createdAt;
  if (obj.updatedAt !== undefined) obj.updated_at = obj.updatedAt;
  return obj;
}

function transformProduct(p) {
  if (!p) return p;
  const obj = p.toJSON ? p.toJSON() : p;
  addTimestampAliases(obj);
  // Defensive cleanup: older API versions could persist null entries in these
  // arrays (e.g. tags saved as [null] by a buggy admin build). A null here
  // white-screens the admin edit form, so never let one out of the API.
  if (Array.isArray(obj.tags)) {
    obj.tags = obj.tags.filter((t) => t != null && t !== '');
  }
  if (Array.isArray(obj.categories)) obj.categories = obj.categories.filter(Boolean);
  if (Array.isArray(obj.product_images)) obj.product_images = obj.product_images.filter(Boolean);
  obj.product_thumbnail = obj.product_thumbnail_id || null;
  obj.size_chart_image = obj.size_chart_image_id || null;
  const galleries = Array.isArray(obj.product_images) ? obj.product_images : [];
  const thumbnail = obj.product_thumbnail_id || null;
  const thumbnailId = thumbnail ? String(thumbnail._id || thumbnail.id || thumbnail) : null;
  const alreadyIncluded = thumbnailId && galleries.some((g) => String(g._id || g.id || g) === thumbnailId);
  obj.product_galleries = thumbnail && !alreadyIncluded ? [thumbnail, ...galleries] : galleries;
  // Build attributes array for storefront variation selectors
  const hasPopulatedAttributes = Array.isArray(obj.attributes_ids) && obj.attributes_ids.length > 0 && obj.attributes_ids[0]?.name;
  if (hasPopulatedAttributes) {
    obj.attributes = obj.attributes_ids.map((attr) => ({
      id: attr.id || attr._id,
      name: attr.name,
      style: attr.style || 'rectangle',
      attribute_values: (attr.attribute_values || []).map((av) => ({
        id: av.id || av._id,
        value: av.value,
        hex_color: av.hex_color || null,
        attribute_id: attr.id || attr._id,
      })),
    }));
  } else if (Array.isArray(obj.variations) && obj.variations.length > 0) {
    // Fallback: derive attributes from variation attribute_values
    const attrMap = new Map();
    obj.variations.forEach((variation) => {
      (variation.attribute_values || []).forEach((av) => {
        const key = av.name;
        if (!attrMap.has(key)) attrMap.set(key, { name: key, style: 'rectangle', valueMap: new Map() });
        const attr = attrMap.get(key);
        const avId = String(av.id || av._id || '');
        if (avId && !attr.valueMap.has(avId)) {
          attr.valueMap.set(avId, { id: avId, value: av.value, hex_color: av.hex_color || null, attribute_id: key });
        }
      });
    });
    obj.attributes = Array.from(attrMap.values()).map((attr) => ({
      id: attr.name,
      name: attr.name,
      style: attr.style,
      attribute_values: Array.from(attr.valueMap.values()),
    }));
  }
  // Add variation_galleries and variation_image aliases expected by the storefront
  if (Array.isArray(obj.variations)) {
    obj.variations = obj.variations.map((v) => ({
      ...v,
      variation_galleries: Array.isArray(v.variation_images) ? v.variation_images : [],
      variation_image: Array.isArray(v.variation_images) && v.variation_images.length > 0 ? v.variation_images[0] : null,
    }));
  }
  if (obj.brand_id) obj.brand = obj.brand_id;
  // Defaults for fields the UI expects
  if (obj.related_products === undefined) obj.related_products = [];
  if (obj.cross_sell_products === undefined) obj.cross_sell_products = [];
  if (obj.reviews_count === undefined) obj.reviews_count = 0;
  if (obj.rating_count === undefined) obj.rating_count = 0;
  if (obj.review_ratings === undefined) obj.review_ratings = [0, 0, 0, 0, 0];
  if (obj.can_review === undefined) obj.can_review = false;
  return obj;
}

function transformCategory(c) {
  if (!c) return c;
  const obj = c.toJSON ? c.toJSON() : c;
  addTimestampAliases(obj);
  // Build Laravel-style media array expected by CategoriesTable.js
  const media = [];
  if (obj.category_image_id?.original_url) {
    media.push({ ...obj.category_image_id, collection_name: 'image' });
  }
  if (obj.category_icon_id?.original_url) {
    media.push({ ...obj.category_icon_id, collection_name: 'icon' });
  }
  obj.media = media;
  obj.category_image = obj.category_image_id || null;
  obj.category_icon = obj.category_icon_id || null;
  obj.category_meta_image = obj.category_meta_image_id || null;
  return obj;
}

function transformBrand(b) {
  if (!b) return b;
  const obj = b.toJSON ? b.toJSON() : b;
  addTimestampAliases(obj);
  obj.brand_image = obj.brand_image_id || null;
  return obj;
}

function transformBlog(b) {
  if (!b) return b;
  const obj = b.toJSON ? b.toJSON() : b;
  addTimestampAliases(obj);
  obj.blog_thumbnail = obj.blog_thumbnail_id || null;
  return obj;
}

function transformUser(u) {
  if (!u) return u;
  const obj = u.toJSON ? u.toJSON() : u;
  addTimestampAliases(obj);
  obj.profile_image = obj.profile_image_id || null;
  return obj;
}

function transformReview(r) {
  if (!r) return r;
  const obj = r.toJSON ? r.toJSON() : r;
  addTimestampAliases(obj);
  // review may have product info
  if (obj.product_id) {
    obj.product_thumbnail = obj.product_id?.product_thumbnail_id || null;
  }
  return obj;
}

function transformAttribute(a) {
  if (!a) return a;
  const obj = a.toJSON ? a.toJSON() : a;
  addTimestampAliases(obj);
  return obj;
}

function transformTag(t) {
  if (!t) return t;
  const obj = t.toJSON ? t.toJSON() : t;
  addTimestampAliases(obj);
  return obj;
}

module.exports = { transformProduct, transformCategory, transformBrand, transformBlog, transformUser, transformReview, transformAttribute, transformTag };
