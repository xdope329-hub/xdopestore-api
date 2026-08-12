const mongoose = require('mongoose');

const orderProductSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  variation_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Snapshot of the chosen variant's display name (e.g. "S / Negro") taken at
  // purchase time, so admin/order views can show size & color even if the
  // product's variations are later edited or removed.
  variation_name: { type: String, default: null },
  name: String,
  quantity: Number,
  price: Number,
  sub_total: Number,
}, { _id: false });

// Stores a snapshot of the address at the time the order was placed.
// `state` / `country` are `{ id, name }` objects so storefront views can show
// names even after the country catalog changes. They remain `Mixed` so the
// schema also accepts legacy plain-string values from earlier orders.
const addressSubSchema = new mongoose.Schema({
  title: String,
  street: String,
  city: String,
  state: mongoose.Schema.Types.Mixed,
  pincode: String,
  country: mongoose.Schema.Types.Mixed,
  phone: String,
  country_code: String,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  order_number: { type: Number, unique: true },
  consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  products: [orderProductSchema],
  billing_address: addressSubSchema,
  shipping_address: addressSubSchema,
  payment_method: { type: String, default: 'cod' },
  payment_status: { type: String, default: 'pending' },
  amount: Number,
  tax_total: { type: Number, default: 0 },
  shipping_total: { type: Number, default: 0 },
  coupon_total_discount: { type: Number, default: 0 },
  wallet_balance: { type: Number, default: 0 },
  points_amount: { type: Number, default: 0 },
  total: Number,
  status_id: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderStatus' },
  notes: String,
  is_digital_only: { type: Boolean, default: false },
  // Payment tracking
  payment_transaction_id: { type: String, default: null },
  payment_gateway_response: { type: mongoose.Schema.Types.Mixed, default: null },
  payment_error: { type: String, default: null },
  payment_initiated_at: { type: Date, default: null },
  payment_completed_at: { type: Date, default: null },
}, { timestamps: true, toJSON: { virtuals: true } });

// Auto-increment order_number
orderSchema.pre('save', async function (next) {
  if (!this.order_number) {
    const last = await this.constructor.findOne({}, {}, { sort: { order_number: -1 } });
    this.order_number = last ? last.order_number + 1 : 1000;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
