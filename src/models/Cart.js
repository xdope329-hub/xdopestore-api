const mongoose = require('mongoose');

// Bundle: variantes elegidas por el cliente para cada item del bundle
// (product_id del hijo + variation_id elegido, o null si el hijo no tiene
// variantes). Vacío para productos que no son bundle.
const bundleSelectionSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variation_id: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { _id: false });

const cartSchema = new mongoose.Schema({
  consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variation_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  bundle_selections: { type: [bundleSelectionSchema], default: [] },
  quantity: { type: Number, default: 1 },
  sub_total: Number,
}, { timestamps: true, toJSON: { virtuals: true } });

module.exports = mongoose.model('Cart', cartSchema);
