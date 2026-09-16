const mongoose = require('mongoose');

const shippingRuleSchema = new mongoose.Schema({
  name: String,
  type: String,
  amount: Number,
  min_weight: Number,
  max_weight: Number,
}, { _id: true });

const shippingZoneSchema = new mongoose.Schema({
  zone: Number,           // 1 = ciudades principales, 2 = resto del país
  name: String,
  amount: Number,         // COP
}, { _id: false });

const shippingSchema = new mongoose.Schema({
  status: { type: Number, default: 1 },
  country_id: Number,
  country: String,
  shipping_rules: [shippingRuleSchema],
  // Envío por zonas (ver src/utils/shippingQuote.js)
  zones: [shippingZoneSchema],
  free_shipping_threshold: { type: Number, default: 200000 },
  created_by_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { virtuals: true } });

module.exports = mongoose.model('Shipping', shippingSchema);
