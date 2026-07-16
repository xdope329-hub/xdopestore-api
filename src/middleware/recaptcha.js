/**
 * Google reCAPTCHA v2 verification middleware.
 *
 * Active only when RECAPTCHA_SECRET_KEY is set in the environment — when the
 * key is absent (local dev, tests) the middleware is a transparent no-op so
 * the auth flow keeps working without any Google account.
 *
 * The client sends the widget token as `recaptcha` in the JSON body
 * (`g-recaptcha-response` is accepted too for form-encoded fallbacks).
 */

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

async function verifyRecaptcha(req, res, next) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return next(); // not configured -> skip

  const token = req.body?.recaptcha || req.body?.['g-recaptcha-response'];
  if (!token) {
    return res.status(422).json({ message: 'Captcha verification required' });
  }

  try {
    const params = new URLSearchParams({ secret, response: String(token) });
    if (req.ip) params.append('remoteip', req.ip);

    const resp = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await resp.json();

    if (!data.success) {
      return res.status(422).json({ message: 'Captcha verification failed' });
    }
    return next();
  } catch (err) {
    // Google unreachable — fail closed but with a distinct status so the
    // client can tell "try again" from "you are a bot".
    return res.status(502).json({ message: 'Captcha verification unavailable. Please try again.' });
  }
}

module.exports = { verifyRecaptcha, SITEVERIFY_URL };
