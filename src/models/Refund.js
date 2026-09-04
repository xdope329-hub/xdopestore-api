const mongoose = require('mongoose');

// Solicitud de reembolso de UNA línea de un pedido entregado. La crea el
// cliente desde el detalle del pedido; el administrador la aprueba o rechaza
// (utils/refundRules.js). El estado también se copia a la línea del pedido
// (products[].refund_status) para que el detalle del pedido lo muestre.
const refundSchema = new mongoose.Schema({
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variation_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true, trim: true },
  payment_type: { type: String, default: 'original' },
  amount: { type: Number, default: 0 },
  quantity: { type: Number, default: 1 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  admin_note: { type: String, default: null },
  moderated_at: { type: Date, default: null },
}, { timestamps: true, toJSON: { virtuals: true } });

refundSchema.index({ consumer_id: 1, createdAt: -1 });
refundSchema.index({ status: 1 });

module.exports = mongoose.model('Refund', refundSchema);
