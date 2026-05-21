// Misc routes — stubs + real implementations for Tax, ThemeOptions and Tag
const router = require('express').Router();
const slugify = require('slugify');
const Order = require('../models/Order');
const Tax = require('../models/Tax');
const Tag = require('../models/Tag');
const ThemeOption = require('../models/ThemeOption');
const Question = require('../models/Question');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { transformTag } = require('../utils/transform');

const transformQuestion = (q) => {
  if (!q) return q;
  const obj = q.toJSON ? q.toJSON() : q;
  if (obj.createdAt !== undefined) obj.created_at = obj.createdAt;
  if (obj.updatedAt !== undefined) obj.updated_at = obj.updatedAt;
  // expose product summary under the `product` alias the dashboard table expects
  if (obj.product_id && typeof obj.product_id === 'object') obj.product = obj.product_id;
  return obj;
};

const emptyList = (req, res) => res.json({ current_page: 1, last_page: 1, total: 0, per_page: 15, data: [] });
const emptyData = (req, res) => res.json({ data: [] });
const ok = (req, res) => res.json({ message: 'ok' });

// GET /country — full country + nested state catalog used by address/checkout forms.
// The storefront expects `country.state` to already be present so the state
// dropdown can be derived without a second request.
const { COUNTRIES, findCountry } = require('../data/countries');
router.get('/country', async (req, res) => {
  res.json({ data: COUNTRIES });
});

// GET /state — optionally filter by country_id
router.get('/state', async (req, res) => {
  const { country_id } = req.query;
  if (country_id) {
    const c = findCountry(country_id);
    return res.json({ data: c?.state || [] });
  }
  res.json({ data: COUNTRIES.flatMap((c) => c.state || []) });
});

// GET /themeOptions
router.get('/themeOptions', async (req, res) => {
  let doc = await ThemeOption.findOne();
  if (!doc) doc = await ThemeOption.create({ options: {} });
  res.json({ id: doc._id, options: doc.options });
});
// PUT /themeOptions
router.put('/themeOptions', auth, adminOnly, async (req, res) => {
  const incoming = req.body.options || {};
  let doc = await ThemeOption.findOne();
  if (!doc) {
    doc = await ThemeOption.create({ options: incoming });
  } else {
    doc.options = incoming;
    doc.markModified('options');
    await doc.save();
  }
  res.json({ id: doc._id, options: doc.options });
});
// POST /themeOptions — admin sends POST with _method:put in body
router.post('/themeOptions', auth, adminOnly, async (req, res) => {
  const incoming = req.body.options || {};
  let doc = await ThemeOption.findOne();
  if (!doc) {
    doc = await ThemeOption.create({ options: incoming });
  } else {
    doc.options = incoming;
    doc.markModified('options');
    await doc.save();
  }
  res.json({ id: doc._id, options: doc.options });
});

// GET /theme
router.get('/theme', (req, res) => res.json({ current_page: 1, last_page: 1, total: 1, per_page: 15, data: [{ id: '1', _id: '1', name: 'Fashion One', slug: 'fashion_one', status: 1 }] }));
router.put('/theme/:id?', ok);

// Tag CRUD
router.get('/tag', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.status !== undefined && req.query.status !== '') filter.status = Number(req.query.status);
  if (req.query.search) filter.name = new RegExp(req.query.search, 'i');
  if (req.query.type) filter.type = req.query.type;
  const total = await Tag.countDocuments(filter);
  const data = await Tag.find(filter).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 });
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data: data.map(transformTag) });
});
router.get('/tag/:id', async (req, res) => {
  const tag = await Tag.findById(req.params.id);
  if (!tag) return res.status(404).json({ message: 'Tag not found' });
  res.json(transformTag(tag));
});
router.post('/tag', auth, adminOnly, async (req, res) => {
  const body = req.body;
  if (!body.slug && body.name) body.slug = slugify(body.name, { lower: true, strict: true });
  const tag = await Tag.create(body);
  res.status(201).json(transformTag(tag));
});
router.put('/tag/:id', auth, adminOnly, async (req, res) => {
  const tag = await Tag.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!tag) return res.status(404).json({ message: 'Tag not found' });
  res.json(transformTag(tag));
});
router.delete('/tag/:id', auth, adminOnly, async (req, res) => {
  await Tag.findByIdAndDelete(req.params.id);
  res.json({ message: 'Tag deleted' });
});

// GET /currency — the storefront is restricted to COP (default) and USD only.
// COP is the base currency: product prices in the DB are stored in COP, so its
// exchange_rate is 1. USD's rate converts a COP value into USD.
const SUPPORTED_CURRENCIES = [
  {
    id: 1,
    name: 'Colombian Peso',
    code: 'COP',
    symbol: '$',
    no_of_decimal: 0,
    exchange_rate: 1,
    symbol_position: 'before_price',
    thousands_separator: 'dot',
    decimal_separator: 'comma',
    status: 1,
    is_default: true,
  },
  {
    id: 2,
    name: 'US Dollar',
    code: 'USD',
    symbol: 'US$',
    no_of_decimal: 2,
    exchange_rate: 0.00024,
    symbol_position: 'before_price',
    thousands_separator: 'comma',
    decimal_separator: 'dot',
    status: 1,
    is_default: false,
  },
];

router.get('/currency', async (req, res) => {
  res.json({
    current_page: 1,
    last_page: 1,
    total: SUPPORTED_CURRENCIES.length,
    per_page: SUPPORTED_CURRENCIES.length,
    data: SUPPORTED_CURRENCIES,
  });
});

// GET /currency/:id — single lookup (admin edit page hits this).
router.get('/currency/:id', async (req, res) => {
  const id = Number(req.params.id);
  const found = SUPPORTED_CURRENCIES.find((c) => c.id === id) ||
                SUPPORTED_CURRENCIES.find((c) => c.code === req.params.id);
  if (!found) return res.status(404).json({ message: 'Currency not found' });
  res.json(found);
});

// POST /currency, PUT /currency/:id — explicitly locked. The storefront is
// fixed to COP + USD by design.
const lockedCurrencyHandler = (_req, res) =>
  res.status(403).json({ message: 'Currency set is locked to COP and USD.' });
router.post('/currency', lockedCurrencyHandler);
router.put('/currency/:id', lockedCurrencyHandler);
router.delete('/currency/:id', lockedCurrencyHandler);

// Tax CRUD
router.get('/tax', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.status !== undefined) filter.status = Number(req.query.status);
  if (req.query.search) filter.name = new RegExp(req.query.search, 'i');
  const total = await Tax.countDocuments(filter);
  const data = await Tax.find(filter).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 });
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data });
});
router.get('/tax/:id', async (req, res) => {
  const t = await Tax.findById(req.params.id);
  if (!t) return res.status(404).json({ message: 'Tax not found' });
  res.json(t);
});
router.post('/tax', auth, adminOnly, async (req, res) => {
  const t = await Tax.create(req.body);
  res.status(201).json(t);
});
router.put('/tax/:id', auth, adminOnly, async (req, res) => {
  const t = await Tax.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!t) return res.status(404).json({ message: 'Tax not found' });
  res.json(t);
});
router.delete('/tax/:id', auth, adminOnly, async (req, res) => {
  await Tax.findByIdAndDelete(req.params.id);
  res.json({ message: 'Tax deleted' });
});

// GET /store
router.get('/store', emptyList);
router.get('/store/:id', async (req, res) => res.json({}));
router.post('/store', ok);
router.put('/store/:id', ok);

// GET /page
router.get('/page', emptyList);
router.get('/page/:id', async (req, res) => res.json({}));
router.post('/page', ok);
router.put('/page/:id', ok);
router.delete('/page/:id', ok);

// GET /faq
router.get('/faq', emptyList);
router.post('/faq', ok);
router.put('/faq/:id', ok);
router.delete('/faq/:id', ok);

// ───────────────────────── Question & Answer ─────────────────────────
// GET /question-and-answer — list (filter by product_id, status=pending|answered, search)
router.get('/question-and-answer', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.product_id) filter.product_id = req.query.product_id;
  if (req.query.search) filter.question = new RegExp(req.query.search, 'i');
  if (req.query.status === 'pending') filter.status = 0;
  else if (req.query.status === 'answered') filter.status = 1;
  const total = await Question.countDocuments(filter);
  const data = await Question.find(filter)
    .skip((page - 1) * limit)
    .limit(limit)
    .sort({ createdAt: -1 })
    .populate('product_id', 'name slug')
    .populate('consumer_id', 'name email');
  res.json({
    current_page: page,
    last_page: Math.ceil(total / limit),
    total,
    per_page: limit,
    data: data.map(transformQuestion),
  });
});

// GET /question-and-answer/:id
router.get('/question-and-answer/:id', async (req, res) => {
  const q = await Question.findById(req.params.id)
    .populate('product_id', 'name slug')
    .populate('consumer_id', 'name email');
  if (!q) return res.status(404).json({ message: 'Question not found' });
  res.json(transformQuestion(q));
});

// POST /question-and-answer — customer posts a question (must be logged in)
router.post('/question-and-answer', auth, async (req, res) => {
  const { question, product_id } = req.body;
  if (!question || !product_id) {
    return res.status(400).json({ message: 'question and product_id are required' });
  }
  const created = await Question.create({
    question,
    product_id,
    consumer_id: req.user._id,
    status: 0,
  });
  const populated = await created.populate([
    { path: 'product_id', select: 'name slug' },
    { path: 'consumer_id', select: 'name email' },
  ]);
  res.status(201).json(transformQuestion(populated));
});

// PUT /question-and-answer/:id — admin answers, or customer edits own (unanswered) question
router.put('/question-and-answer/:id', auth, async (req, res) => {
  const existing = await Question.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Question not found' });

  const isAdmin = req.user?.role?.name === 'admin' || req.user?.role?.slug === 'admin';
  const isOwner = existing.consumer_id && existing.consumer_id.toString() === req.user._id.toString();

  const update = {};
  // Admin can set/edit the answer.
  if (typeof req.body.answer === 'string') {
    if (!isAdmin) return res.status(403).json({ message: 'Only admins can answer questions' });
    update.answer = req.body.answer;
    update.status = req.body.answer.trim().length > 0 ? 1 : 0;
  }
  // Owner (or admin) can edit the question text while it's still unanswered.
  if (typeof req.body.question === 'string') {
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Forbidden' });
    if (existing.answer && !isAdmin) {
      return res.status(400).json({ message: 'Cannot edit an answered question' });
    }
    update.question = req.body.question;
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ message: 'Nothing to update' });
  }
  const q = await Question.findByIdAndUpdate(req.params.id, update, { new: true })
    .populate('product_id', 'name slug')
    .populate('consumer_id', 'name email');
  res.json(transformQuestion(q));
});

// DELETE /question-and-answer/:id — admin only
router.delete('/question-and-answer/:id', auth, adminOnly, async (req, res) => {
  await Question.findByIdAndDelete(req.params.id);
  res.json({ message: 'Question deleted' });
});

// POST /question-and-answer/feedback — like / dislike a question (auth required)
router.post('/question-and-answer/feedback', auth, async (req, res) => {
  const { question_id, reaction } = req.body;
  if (!question_id || !['liked', 'disliked'].includes(reaction)) {
    return res.status(400).json({ message: 'question_id and reaction (liked|disliked) required' });
  }
  const q = await Question.findById(question_id);
  if (!q) return res.status(404).json({ message: 'Question not found' });
  const userKey = req.user._id.toString();
  const prev = q.reactions.get(userKey);
  if (prev === reaction) {
    // Toggle off
    q.reactions.delete(userKey);
    if (reaction === 'liked') q.total_likes = Math.max(0, q.total_likes - 1);
    else q.total_dislikes = Math.max(0, q.total_dislikes - 1);
  } else {
    if (prev === 'liked') q.total_likes = Math.max(0, q.total_likes - 1);
    if (prev === 'disliked') q.total_dislikes = Math.max(0, q.total_dislikes - 1);
    q.reactions.set(userKey, reaction);
    if (reaction === 'liked') q.total_likes += 1;
    else q.total_dislikes += 1;
  }
  await q.save();
  res.json(transformQuestion(q));
});

// Menu CRUD
const Menu = require('../models/Menu');

router.get('/menu', async (req, res) => {
  let items = await Menu.find({ status: 1 }).sort({ sort_order: 1, createdAt: 1 });
  if (items.length === 0) {
    const defaults = [
      { title: 'Home', path: '/', class: '0', sort_order: 0 },
      { title: 'Shop', path: '/collections', class: '0', sort_order: 1 },
      { title: 'About Us', path: '/about-us', class: '0', sort_order: 2 },
      { title: 'Contact', path: '/contact-us', class: '0', sort_order: 3 },
    ];
    items = await Menu.insertMany(defaults);
  }
  res.json({ data: items });
});
router.post('/menu', auth, adminOnly, async (req, res) => {
  const count = await Menu.countDocuments();
  const item = await Menu.create({ ...req.body, sort_order: count });
  res.status(201).json(item);
});
router.put('/menu/sort', auth, adminOnly, async (req, res) => {
  const items = req.body?.data || req.body || [];
  await Promise.all(items.map((item, i) => Menu.findByIdAndUpdate(item.id || item._id, { sort_order: i })));
  res.json({ message: 'ok' });
});
router.put('/menu/:id', auth, adminOnly, async (req, res) => {
  const item = await Menu.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!item) return res.status(404).json({ message: 'Menu item not found' });
  res.json(item);
});
router.delete('/menu/:id', auth, adminOnly, async (req, res) => {
  await Menu.findByIdAndDelete(req.params.id);
  res.json({ message: 'ok' });
});

// GET /subscribe
router.post('/subscribe', ok);

// GET /notice
router.get('/notice', emptyList);
router.get('/notice/recent', emptyData);
router.put('/notice/markAsRead', ok);

// GET /contact-us
router.post('/contact-us', ok);

// GET /commissionHistory
router.get('/commissionHistory', emptyList);

// /paymentAccount, /wallet/* and /download endpoints were removed when the
// Bank Details, My Wallet, and Downloads features were retired from the
// storefront. /points/consumer below is kept so the Earning Points feature
// can be toggled back on via settings.activation.earning_points.

// GET /withdrawRequest
router.get('/withdrawRequest', emptyList);
router.post('/withdrawRequest', ok);

// GET /refund
router.get('/refund', emptyList);
router.post('/refund', ok);
router.put('/refund/:id', ok);

// GET /badge — counts for admin dashboard notification badges
router.get('/badge', auth, async (req, res) => {
  const Product = require('../models/Product');
  const Order = require('../models/Order');
  const [unapprovedProducts, pendingOrders] = await Promise.all([
    Product.countDocuments({ is_approved: false }),
    Order.countDocuments({ payment_status: 'pending' }),
  ]);
  res.json({
    data: {
      product: { total_in_approved_products: unapprovedProducts },
      store: { total_in_approved_stores: 0 },
      refund: { total_pending_refunds: 0 },
      withdraw_request: { total_pending_withdraw_requests: 0 },
    },
  });
});

// GET /points/consumer
router.get('/points/consumer', auth, async (req, res) => res.json({ data: { balance: 0, transactions: [] } }));
router.post('/credit/points', ok);
router.post('/debit/points', ok);

// Vendor wallet stubs
router.get('/wallet/vendor', ok);
router.post('/credit/vendorWallet', ok);
router.post('/debit/vendorWallet', ok);

// Payment stubs
router.post('/verifyPayment', ok);
router.post('/rePayment', ok);

// GET /module — permission modules list for role creation form
router.get('/module', auth, async (req, res) => {
  const { getModuleList } = require('../data/permissions');
  res.json({ data: getModuleList() });
});

// GET /license-key
router.get('/license-key', async (req, res) => res.json({ data: { status: 'active' } }));

// GET /app/settings
router.get('/app/settings', async (req, res) => res.json({ data: {} }));

// GET /trackOrder
router.get('/trackOrder', auth, async (req, res) => {
  const { order_number } = req.query;
  const order = await Order.findOne({ order_number }).populate('status_id');
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

// GET /order/invoice/:id
router.get('/order/invoice/:id', auth, async (req, res) => {
  const order = await Order.findById(req.params.id).populate('consumer_id').populate('status_id');
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

// POST /login/number
router.post('/login/number', async (req, res) => res.status(501).json({ message: 'Phone login not implemented' }));

// GET /updateStoreProfile
router.put('/updateStoreProfile', ok);

// product approve
router.put('/approve/:id', ok);

module.exports = router;
