const router = require('express').Router();
const mongoose = require('mongoose');
const slugify = require('slugify');
const Page = require('../models/Page');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

function transformPage(p) {
  if (!p) return p;
  const obj = p.toJSON ? p.toJSON() : p;
  obj.created_at = obj.created_at || obj.createdAt;
  obj.updated_at = obj.updated_at || obj.updatedAt;
  obj.page_meta_image = obj.page_meta_image_id || null;
  return obj;
}

// GET /page — paginated list (admin table + storefront)
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.search) filter.title = new RegExp(req.query.search, 'i');
  if (req.query.status !== undefined && req.query.status !== '') filter.status = Number(req.query.status);
  const total = await Page.countDocuments(filter);
  const data = await Page.find(filter)
    .skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 })
    .populate('page_meta_image_id', 'asset_url original_url');
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data: data.map(transformPage) });
});

// GET /page/:idOrSlug — by Mongo id (admin edit form) or by slug (storefront)
router.get('/:idOrSlug', async (req, res) => {
  const key = req.params.idOrSlug;
  const query = mongoose.isValidObjectId(key) ? { _id: key } : { slug: key, status: 1 };
  const found = await Page.findOne(query).populate('page_meta_image_id', 'asset_url original_url');
  if (!found) return res.status(404).json({ message: 'Page not found' });
  res.json(transformPage(found));
});

// POST /page — create (admin)
router.post('/', auth, adminOnly, async (req, res) => {
  const body = req.body;
  if (!body.slug && body.title) body.slug = slugify(body.title, { lower: true, strict: true });
  const created = await Page.create({ ...body, created_by_id: req.user._id });
  res.status(201).json(transformPage(created));
});

// PUT /page/:id — update (admin; also reached via POST + _method:"put")
router.put('/:id', auth, adminOnly, async (req, res) => {
  const body = { ...req.body };
  if (body.title && !body.slug) body.slug = slugify(body.title, { lower: true, strict: true });
  const updated = await Page.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!updated) return res.status(404).json({ message: 'Page not found' });
  res.json(transformPage(updated));
});

// DELETE /page/:id — delete (admin)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  await Page.findByIdAndDelete(req.params.id);
  res.json({ message: 'Page deleted' });
});

module.exports = router;
