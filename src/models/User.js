const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Bcrypt cost factor. 10 was safe in 2020, 12 is the 2026 floor. Every +1
// doubles the hash time; 12 hashes in ~150ms on modern CPUs.
const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: String,
  country_code: String,
  status: { type: Number, default: 1 }, // 1 = active, 0 = disabled
  system_reserve: { type: String, default: '0' },
  role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
  profile_image_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', default: null },
  email_verified_at: Date,
  // Password reset flow
  otp: String,                          // 6-digit code, cleared after use
  otp_expires_at: Date,                 // OTP lifetime (15 min)
  otp_verified_at: Date,                // when the OTP was successfully verified
  otp_verified_expires_at: Date,        // deadline to call /update-password (10 min)
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    // Never leak password or OTP fields in a JSON response.
    transform: (_doc, ret) => {
      delete ret.password;
      delete ret.otp;
      delete ret.otp_expires_at;
      delete ret.otp_verified_at;
      delete ret.otp_verified_expires_at;
      return ret;
    },
  },
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', userSchema);
