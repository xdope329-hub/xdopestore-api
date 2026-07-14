/**
 * Centralized JWT signing and verification.
 *
 * Guarantees:
 *   - Fails FAST at boot if JWT_SECRET is missing or too weak.
 *   - Every token carries an issuer (iss) and audience (aud) claim,
 *     verified on read so a token minted for a different service can't be
 *     replayed here.
 *   - Callers never touch process.env.JWT_SECRET directly.
 */

const jwt = require('jsonwebtoken');

const MIN_SECRET_BYTES = 32; // 256 bits, the modern floor for HS256.
const ISSUER = process.env.JWT_ISSUER || 'xdope-api';
const AUDIENCE = process.env.JWT_AUDIENCE || 'xdope-clients';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < MIN_SECRET_BYTES) {
  throw new Error(
    '[jwt] JWT_SECRET must be set and be at least ' +
    MIN_SECRET_BYTES + ' characters long. ' +
    'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}
if (/^(secret|change|test|xdope|dev|localhost)/i.test(secret)) {
  throw new Error('[jwt] JWT_SECRET looks like a placeholder. Use a random 48-byte hex string.');
}

const DEFAULT_EXPIRY = process.env.JWT_EXPIRES_IN || '15m';

/**
 * Sign a token for a given user id. Adds iss/aud automatically.
 */
function signToken(userId, opts = {}) {
  const expiresIn = opts.expiresIn || DEFAULT_EXPIRY;
  return jwt.sign(
    { id: String(userId) },
    secret,
    {
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn,
      // HS256 explicitly - never allow "alg: none" bypasses.
      algorithm: 'HS256',
    }
  );
}

/**
 * Verify a bearer token. Returns the decoded payload or throws.
 * Rejects tokens with wrong iss/aud or a non-HS256 alg.
 */
function verifyToken(token) {
  return jwt.verify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
}

module.exports = { signToken, verifyToken, ISSUER, AUDIENCE };
