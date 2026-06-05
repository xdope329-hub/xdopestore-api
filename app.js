const express = require('express');
const cors = require('cors');
const path = require('path');
const methodOverride = require('method-override');

const app = express();

// Allowed CORS origins. In production set the CORS_ORIGINS env var to a
// comma-separated list of frontend URLs, e.g.
//   CORS_ORIGINS=https://your-store.vercel.app,https://your-admin.vercel.app
// When the env var is unset (local dev), fall back to the localhost ports.
const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_DEV_ORIGINS;

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser requests (curl, mobile apps, server-to-server) send no
    // Origin header — those are allowed through.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// Support _method override (Laravel-style) — admin frontend uses POST + _method:"put" for updates
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
app.use('/', require('./src/routes/cart.sync.routes'));
app.use('/', require('./src/routes/misc.routes'));

// 404
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

module.exports = app;
