const mongoose = require('mongoose');

// A named snapshot of Setting.values and/or ThemeOption.options that can be
// re-applied on demand. Used for seasonal storefront looks (Navidad,
// Halloween, etc.). Snapshots reference existing Attachment IDs — images are
// not duplicated, so deleting an attachment breaks any preset that used it.
const presetSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  type: {
    type: String,
    enum: ['settings', 'themeOption', 'both'],
    required: true,
  },
  settingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  themeSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  thumbnail_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
}, { timestamps: true });

module.exports = mongoose.model('Preset', presetSchema);
