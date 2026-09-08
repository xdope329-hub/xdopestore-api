const mongoose = require('mongoose');

const orderProductSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  variation_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Snapshot of the chosen variant's display name (e.g. "S / Negro") taken at
  // purchase time, so admin/order views can show size & color even if the
  // product's variations are later edited or removed.
  variation_name: { type: String, default: null },
  // Instantánea de la variante: cada atributo elegido (Color: Cafe, Talla: M)
  // y el SKU, para que el detalle del pedido muestre exactamente lo comprado
  // aunque el producto cambie después (utils/orderLineSnapshot.js).
  variation_attributes: { type: [{ name: String, value: String }], default: [] },
  sku: { type: String, default: null },
  name: String,
  quantity: Number,
  price: Number,
  sub_total: Number,
  // Estado de la solicitud de reembolso de esta línea (models/Refund.js):
  // null | pending | approved | rejected. Lo muestra el detalle del pedido.
  refund_status: { type: String, default: null },
  // Momento en que el cliente calificó esta compra (POST /review). Se conserva
  // aunque el administrador apruebe, rechace o ELIMINE la reseña: una compra
  // calificada no vuelve a aparecer en "Califica tu compra" ni admite otra
  // reseña (routes/review.routes.js, utils/reviewModeration.js).
  reviewed_at: { type: Date, default: null },
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
  // Pedidos de invitado (checkout sin cuenta)
  is_guest: { type: Boolean, default: false },
  guest_name: { type: String, default: null },
  guest_email: { type: String, default: null },
  products: [orderProductSchema],
  billing_address: addressSubSchema,
  shipping_address: addressSubSchema,
  payment_method: { type: String, default: 'cod' },
  // Estado del PAGO (solo la pasarela lo escribe): pending | completed |
  // rejected | cancelled | refunded. Independiente del estado logístico del
  // pedido (status_id). Ver utils/orderStatusFlow.js.
  payment_status: { type: String, default: 'pending' },
  // Estado crudo reportado por la pasarela (p. ej. Mercado Pago: approved,
  // in_process, rejected…), para diagnóstico en el admin.
  payment_gateway_status: { type: String, default: null },
  amount: Number,
  tax_total: { type: Number, default: 0 },
  shipping_total: { type: Number, default: 0 },
  coupon_total_discount: { type: Number, default: 0 },
  coupon_code: { type: String, default: null },
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
  // Entrega elegida en el checkout ("Envío estándar | 3–5 días hábiles" y,
  // para entrega el mismo día, la franja). El admin la muestra en el detalle;
  // antes no se guardaba y salía siempre en blanco.
  delivery_description: { type: String, default: null },
  delivery_interval: { type: String, default: null },
  // true cuando el stock de sus líneas ya se descontó (al confirmarse el
  // pago; contra entrega al crearse). Al cancelar se repone y vuelve a false
  // (utils/stock.js).
  stock_reserved: { type: Boolean, default: false },
}, { timestamps: true, toJSON: { virtuals: true } });

// Auto-increment order_number
// Número de pedido: contador atómico (models/Counter.js). "Leer el último y
// sumar 1" daba el mismo número a dos checkouts simultáneos y el índice
// único tumbaba el segundo con un 500.
orderSchema.pre('save', async function (next) {
  if (!this.order_number) {
    const Counter = require('./Counter');
    const last = await this.constructor.findOne({}, { order_number: 1 }, { sort: { order_number: -1 } }).lean();
    this.order_number = await Counter.next('order_number', { atLeast: last?.order_number || 999 });
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
