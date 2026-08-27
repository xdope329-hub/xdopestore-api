const mongoose = require('mongoose');

// Static CMS pages (Terms & Conditions, Privacy Policy, etc.) managed from
// the admin dashboard's "Pages" section and rendered by the storefront.
const pageSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true },
  content: String,
  meta_title: String,
  meta_description: String,
  page_meta_image_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
  status: { type: Number, default: 1 },
  created_by_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { virtuals: true } });

module.exports = mongoose.model('Page', pageSchema);
