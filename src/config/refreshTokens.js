const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

// Refresh token lifetime. Override with REFRESH_TOKEN_TTL_DAYS if you want
// a different window (30 days is a sensible default for a beta storefront).
const TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

function hash(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function contextFromReq(req) {
  return {
    user_agent: req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 200) : undefined,
    ip: req?.ip,
  };
}

/**
 * Mint a brand-new refresh token for a user. Returns the RAW value - store
 * it client-side, never on the server.
 */
async function issueRefreshToken(userId, req) {
  const raw = crypto.randomBytes(64).toString('hex'); // 128-char opaque token
  await RefreshToken.create({
    user_id: userId,
    token_hash: hash(raw),
    expires_at: new Date(Date.now() + TTL_MS),
    ...contextFromReq(req),
  });
  return raw;
}

/**
 * Verify a presented refresh token and rotate it: revoke the old one,
 * issue a new one, and return { user_id, refresh_token } - never the old
 * hash.
 *
 * If the presented token is unknown / expired / already-revoked, throws.
 * A REVOKED-but-known token is a red flag (replay attack): we invalidate
 * every refresh token in that user's account defensively.
 */
async function rotateRefreshToken(rawToken, req) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Missing refresh token');
  }
  const record = await RefreshToken.findOne({ token_hash: hash(rawToken) });
  if (!record) throw new Error('Refresh token not recognised');
  if (record.expires_at < new Date()) throw new Error('Refresh token expired');

  if (record.revoked_at) {
    // Replay attempt. Something leaked. Nuke every session for this user.
    await RefreshToken.updateMany(
      { user_id: record.user_id, revoked_at: null },
      { revoked_at: new Date() }
    );
    throw new Error('Refresh token replay detected - all sessions revoked');
  }

  // Mint the replacement first, then revoke the old one pointing at it.
  const newRaw = crypto.randomBytes(64).toString('hex');
  await RefreshToken.create({
    user_id: record.user_id,
    token_hash: hash(newRaw),
    expires_at: new Date(Date.now() + TTL_MS),
    ...contextFromReq(req),
  });
  record.revoked_at = new Date();
  record.replaced_by_hash = hash(newRaw);
  await record.save();

  return { user_id: record.user_id, refresh_token: newRaw };
}

/**
 * Revoke a single refresh token (logout on one device). Silent no-op if
 * the token is unknown.
 */
async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  const record = await RefreshToken.findOne({ token_hash: hash(rawToken) });
  if (!record || record.revoked_at) return;
  record.revoked_at = new Date();
  await record.save();
}

/**
 * Revoke every active refresh token for a user (logout from all devices).
 */
async function revokeAllForUser(userId) {
  await RefreshToken.updateMany(
    { user_id: userId, revoked_at: null },
    { revoked_at: new Date() }
  );
}

module.exports = {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  TTL_DAYS,
};
