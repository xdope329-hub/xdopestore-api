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

// OTP verification / password update: 10 attempts / 15 min per IP. Un OTP de
// 6 dígitos sin límite se puede adivinar por fuerza bruta en minutos;
// además, cada usuario tiene un contador de intentos (auth.routes.js).
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message,
  standardHeaders: true,
  legacyHeaders: false,
});

const make = (windowMs, max) => rateLimit({ windowMs, max, message, standardHeaders: true, legacyHeaders: false });

// /refresh: a session renews at most a few times per window per IP; an
// attacker guessing refresh tokens gets cut off quickly.
const refreshLimiter = make(15 * 60 * 1000, 60);
// Checkout preview + order creation (public for guests): enough for real
// shoppers, too little for scripted order spam.
const checkoutLimiter = make(15 * 60 * 1000, 60);
// Media uploads (admin area): caps Cloudinary usage if a token leaks.
const uploadLimiter = make(15 * 60 * 1000, 120);
// Public forms (contact, newsletter): anti-spam.
const publicFormLimiter = make(60 * 60 * 1000, 20);

module.exports = { loginLimiter, registerLimiter, passwordResetLimiter, otpLimiter, refreshLimiter, checkoutLimiter, uploadLimiter, publicFormLimiter };
