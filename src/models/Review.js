const mongoose = require('mongoose');
const { REVIEW_STATUS } = require('../utils/reviewModeration');

// `status`: 0 pendiente de revisión, 1 aprobada (visible en la tienda),
// 2 rechazada. Ver utils/reviewModeration.js.
const reviewSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5 },
  description: String,
  review_image_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
  status: { type: Number, default: REVIEW_STATUS.PENDING },
  moderated_at: { type: Date, default: null },
}, { timestamps: true, toJSON: { virtuals: true } });

reviewSchema.index({ product_id: 1, status: 1 });
reviewSchema.index({ consumer_id: 1, product_id: 1 });

module.exports = mongoose.model('Review', reviewSchema);
