const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  title: String,
  description: String,
  code: { type: String, required: true, unique: true, uppercase: true },
  type: { type: String, enum: ['percentage', 'fixed', 'free_shipping'], default: 'percentage' },
  amount: { type: Number, default: 0 }, // no aplica para free_shipping
  min_spend: { type: Number, default: 0 },
  is_unlimited: { type: Boolean, default: true },
  usage_per_coupon: Number,
  usage_per_customer: Number,
  used: { type: Number, default: 0 },
  status: { type: Number, default: 1 },
  is_first_order: { type: Boolean, default: false },
  is_expired: { type: Boolean, default: false },
  is_apply_all: { type: Boolean, default: true },
  start_date: Date,
  end_date: Date,
  created_by_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { virtuals: true } });

module.exports = mongoose.model('Coupon', couponSchema);
