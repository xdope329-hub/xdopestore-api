const mongoose = require('mongoose');

/**
 * Refresh tokens are stored HASHED (SHA-256). We never persist the raw token
 * value - only the client ever sees it. This means a DB leak doesn't hand
 * out valid sessions.
 *
 * Rotation model: every time a refresh is used to mint a new access token,
 * the old refresh is marked revoked (with replaced_by_hash pointing at the
 * new one). If a revoked token is ever presented again it's proof the token
 * chain leaked; the entire chain is invalidated at that point.
 */
const refreshTokenSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token_hash: { type: String, required: true, unique: true, index: true },
  expires_at: { type: Date, required: true },
  revoked_at: { type: Date, default: null },
  // If this token was rotated (used successfully), track the hash of the
  // token that replaced it so we can detect replay attacks.
  replaced_by_hash: { type: String, default: null },
  user_agent: String,
  ip: String,
}, { timestamps: true });

// MongoDB TTL index - documents auto-delete when expires_at is in the past.
// One less thing to maintain.
refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
