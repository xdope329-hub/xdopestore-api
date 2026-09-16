const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema({
  title: { type: String, required: true },
  path: { type: String, default: '/' },
  class: { type: String, default: '0' },
  // 'link' = navigates somewhere, 'sub' = grouping header inside a mega menu
  link_type: { type: String, default: 'link' },
  parent_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Menu', default: null },
  // Admin sends 0/1 numbers for these toggles
  mega_menu: { type: Number, default: 0 },
  mega_menu_type: { type: String, default: 'simple' },
  is_target_blank: { type: Number, default: 0 },
  badge_text: { type: String, default: '' },
  badge_color: { type: String, default: 'bg-danger' },
  set_page_link: { type: String, default: '' },
  product_ids: { type: Array, default: [] },
  blog_ids: { type: Array, default: [] },
  banner_image_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
  item_image_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
  banner_image: { type: Object, default: null },
  // Legacy support: seeded menus store their children inline here
  megamenu: { type: Boolean, default: false },
  status: { type: Number, default: 1 },
  sort_order: { type: Number, default: 0 },
  item: { type: Array, default: [] },
}, { timestamps: true, toJSON: { virtuals: true } });

module.exports = mongoose.model('Menu', menuSchema);
