/**
 * Rate limiters for auth endpoints. Uses in-memory store which is fine for a
 * single Render dyno; if you scale horizontally later swap the store for
 * Redis (rate-limit-redis package).
 */

const rateLimit = require('express-rate-limit');

// Standard reply body for exceeded requests.
const message = { message: 'Too many attempts. Please try again in a few minutes.' };

// Login: 10 attempts / 15 min per IP. Enough for typos, blocks credential stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message,
  standardHeaders: true,
  legacyHeaders: false,
});

// Register: 5 accounts / hour per IP. Blocks scripted account creation.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message,
  standardHeaders: true,
  legacyHeaders: false,
});

// Password reset: 3 requests / hour per IP. Cheap to trigger, expensive to
// abuse (sends emails, invalidates existing OTPs).
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, registerLimiter, passwordResetLimiter };
