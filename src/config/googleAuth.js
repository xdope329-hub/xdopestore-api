/**
 * Google Sign-In ID-token verification.
 *
 * Uses Google's tokeninfo endpoint, which validates the token signature
 * server-side at Google. This keeps the API dependency-free; if login volume
 * grows, swap this for `google-auth-library`'s local JWKS verification.
 *
 * Requires GOOGLE_CLIENT_ID in the environment (the same OAuth Client ID the
 * frontend uses to render the button).
 */

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

class GoogleAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // NOT_CONFIGURED | INVALID | UNVERIFIED
  }
}

/**
 * Verifies a Google ID token (the `credential` from Google Identity Services).
 * Resolves with the token payload ({ sub, email, name, picture, ... }) or
 * throws a GoogleAuthError.
 */
async function verifyGoogleIdToken(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new GoogleAuthError('Google login is not configured', 'NOT_CONFIGURED');
  }
  if (!credential || typeof credential !== 'string') {
    throw new GoogleAuthError('Missing Google credential', 'INVALID');
  }

  let payload;
  try {
    const resp = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`);
    if (!resp.ok) throw new Error(`tokeninfo status ${resp.status}`);
    payload = await resp.json();
  } catch (err) {
    throw new GoogleAuthError('Invalid Google credential', 'INVALID');
  }

  // tokeninfo validates the signature; we still check the claims are for US.
  if (payload.aud !== clientId) {
    throw new GoogleAuthError('Google credential audience mismatch', 'INVALID');
  }
  if (!VALID_ISSUERS.includes(payload.iss)) {
    throw new GoogleAuthError('Google credential issuer mismatch', 'INVALID');
  }
  if (Number(payload.exp) * 1000 < Date.now()) {
    throw new GoogleAuthError('Google credential expired', 'INVALID');
  }
  if (String(payload.email_verified) !== 'true') {
    throw new GoogleAuthError('Google account email is not verified', 'UNVERIFIED');
  }

  return payload;
}

module.exports = { verifyGoogleIdToken, GoogleAuthError, TOKENINFO_URL };
