const mongoose = require('mongoose');

const variationSchema = new mongoose.Schema({
  name: String,
  attribute_value_ids: [mongoose.Schema.Types.ObjectId],
  attribute_values: [{ name: String, value: String, id: String, attribute_id: String }],
  price: Number,
  sale_price: Number,
  discount: Number,
  quantity: Number,
  sku: String,
  stock_status: { type: String, enum: ['in_stock', 'out_of_stock'], default: 'in_stock' },
  status: { type: Number, default: 1 },
  variation_images: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Attachment' }],
}, { _id: true, toJSON: { virtuals: true } });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true },
  short_description: String,
  description: String,
  type: { type: String, default: 'simple' },
  product_type: { type: String, default: 'physical' },
  unit: String,
  weight: Number,
  quantity: { type: Number, default: 0 },
  // Variable ("classified") products price each variant individually, so the
  // parent price is derived (see deriveParentPricingFromVariations) rather
  // than entered — only simple products must carry their own price.
  price: {
    type: Number,
    required: [
      function () {
        // Only a product with no priced variants must carry its own price.
        const hasVariants = Array.isArray(this.variations) && this.variations.length > 0;
        return this.type !== 'classified' && !hasVariants;
      },
      'Price is required',
    ],
  },
  sale_price: Number,
  discount: Number,
  sku: String,
  stock_status: { type: String, enum: ['in_stock', 'out_of_stock'], default: 'in_stock' },
  is_featured: { type: Boolean, default: false },
  is_trending: { type: Boolean, default: false },
  safe_checkout: { type: Boolean, default: true },
  secure_checkout: { type: Boolean, default: true },
  social_share: { type: Boolean, default: true },
  encourage_order: { type: Boolean, default: true },
  encourage_view: { type: Boolean, default: true },
  is_cod: { type: Boolean, default: true },
  is_free_shipping: { type: Boolean, default: false },
  is_sale_enable: { type: Boolean, default: false },
  is_return: { type: Boolean, default: false },
  is_approved: { type: Boolean, default: true },
  sale_starts_at: Date,
  sale_expired_at: Date,
  status: { type: Number, default: 1 },
  meta_title: String,
  meta_description: String,
  meta_keywords: String,
  og_title: String,
  og_description: String,
  canonical_url: String,
  robots: { type: String, default: 'index, follow' },
  brand_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null },
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  tags: [String],
  tax_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tax', default: null },
  attributes_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Attribute' }],
  product_thumbnail_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
  size_chart_image_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
  product_images: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Attachment' }],
  variations: [variationSchema],
  estimated_delivery_text: String,
  return_policy_text: String,
  created_by_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { virtuals: true } });

module.exports = mongoose.model('Product', productSchema);
