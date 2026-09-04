const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const methodOverride = require('method-override');

const app = express();

// Security headers (HSTS, nosniff, frame/referrer policies…). CSP is off:
// this API only serves JSON and uploaded files, and the storefront/admin
// apps live on other origins that must be able to embed those files.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Trust one proxy hop. Render (and any similar PaaS) puts a reverse proxy
// in front of your service; without this, express-rate-limit sees every
// request as coming from the proxy IP and would rate-limit all users as
// one. `1` means we trust exactly one X-Forwarded-For hop, which is what
// Render adds.
app.set('trust proxy', 1);

// CORS allow-list.
//   - Localhost ports for local dev across the three apps.
//   - Anything passed via the FRONTEND_URL or CORS_ORIGINS env var (comma-
//     separated) on Render, so we can add custom domains without redeploying.
//   - Any *.vercel.app deploy from the xdope-s-projects team - this auto-
//     covers both production aliases (xdopestore-..., admin-dashboard-...)
//     AND every preview deploy hash. No editing on each new commit.
// Lista y patrón de Vercel en utils/corsOrigins.js (puro y testeado). Solo
// los proyectos conocidos del equipo (VERCEL_PROJECTS) son orígenes de
// confianza; antes lo era cualquier proyecto del equipo.
const { buildAllowedOrigins } = require('./src/utils/corsOrigins');
const corsOrigins = buildAllowedOrigins(process.env);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (corsOrigins.isAllowed(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
}));
// Body size: only the admin's big JSON documents (settings, theme options,
// presets, home page layout) need 10 MB; everything else, including the
// public login/register/webhook endpoints, gets the 1 MB default.
app.use(['/settings', '/themeOptions', '/presets', '/homepage', '/home'], express.json({ limit: '10mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// Support _method override (Laravel-style) — admin frontend uses POST + _method:"put" for updates
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));
// Uploaded files are downloads, not pages: force download for anything that
// is not an image so a crafted HTML/SVG/PDF cannot run in the API's origin.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!/\.(png|jpe?g|gif|webp|avif)$/i.test(filePath)) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  },
}));

// Routes
app.use('/', require('./src/routes/auth.routes'));
app.use('/settings', require('./src/routes/settings.routes'));
app.use('/product', require('./src/routes/product.routes'));
app.use('/category', require('./src/routes/category.routes'));
app.use('/brand', require('./src/routes/brand.routes'));
app.use('/attribute', require('./src/routes/attribute.routes'));
app.use('/cart', require('./src/routes/cart.routes'));
app.use('/checkout', require('./src/routes/checkout.routes'));
app.use('/order', require('./src/routes/order.routes'));
app.use('/payment', require('./src/routes/payment.routes'));
app.use('/', require('./src/routes/user.routes'));
app.use('/role', require('./src/routes/role.routes'));
app.use('/coupon', require('./src/routes/coupon.routes'));
app.use('/shipping', require('./src/routes/shipping.routes'));
app.use('/blog', require('./src/routes/blog.routes'));
app.use('/page', require('./src/routes/page.routes'));
app.use('/review', require('./src/routes/review.routes'));
app.use('/wishlist', require('./src/routes/wishlist.routes'));
app.use('/compare', require('./src/routes/compare.routes'));
app.use('/address', require('./src/routes/address.routes'));
app.use('/attachment', require('./src/routes/attachment.routes'));
app.use('/notifications', require('./src/routes/notification.routes'));
app.use('/homepage', require('./src/routes/homepage.routes'));
app.use('/home', require('./src/routes/home.routes'));
app.use('/orderStatus', require('./src/routes/orderStatus.routes'));
app.use('/statistics', require('./src/routes/statistics.routes'));
app.use('/dashboard', require('./src/routes/statistics.routes'));
app.use('/presets', require('./src/routes/preset.routes'));
app.use('/refund', require('./src/routes/refund.routes'));
app.use('/', require('./src/routes/cart.sync.routes'));
app.use('/', require('./src/routes/misc.routes'));

// 404
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  // Mongoose validation failures are the caller's fault, not a server crash —
  // surface them as a readable 422 the admin can show in a toast.
  if (err && err.name === 'ValidationError' && err.errors) {
    const fields = Object.keys(err.errors);
    const message = Object.values(err.errors).map((e) => e.message).join(' · ');
    return res.status(422).json({ message: message || 'Validation failed', fields });
  }
  if (err && err.name === 'CastError') {
    return res.status(422).json({ message: `Invalid value for ${err.path}`, fields: [err.path] });
  }
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

module.exports = app;