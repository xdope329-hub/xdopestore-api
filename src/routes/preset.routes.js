const router = require('express').Router();
const Preset = require('../models/Preset');
const Setting = require('../models/Setting');
const ThemeOption = require('../models/ThemeOption');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { stripBlacklist } = require('../utils/presetBlacklist');

const populateThumb = (q) => q.populate('thumbnail_id');

const serialize = (p) => {
  if (!p) return p;
  const obj = p.toJSON ? p.toJSON() : p;
  // Mongoose's `id` virtual isn't emitted by toJSON unless virtuals are
  // enabled on the schema, so surface it explicitly — the admin table keys
  // every row action off `preset.id`.
  if (obj._id && obj.id === undefined) obj.id = String(obj._id);
  if (obj.createdAt !== undefined) obj.created_at = obj.createdAt;
  if (obj.updatedAt !== undefined) obj.updated_at = obj.updatedAt;
  obj.thumbnail = obj.thumbnail_id || null;
  return obj;
};

// GET /presets — list all
router.get('/', auth, adminOnly, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 15;
  const filter = {};
  if (req.query.search) filter.name = new RegExp(req.query.search, 'i');
  if (req.query.type) filter.type = req.query.type;
  const total = await Preset.countDocuments(filter);
  const data = await populateThumb(
    Preset.find(filter).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 })
  );
  res.json({
    current_page: page,
    last_page: Math.ceil(total / limit) || 1,
    total,
    per_page: limit,
    data: data.map(serialize),
  });
});

// GET /presets/:id
router.get('/:id', auth, adminOnly, async (req, res) => {
  const p = await populateThumb(Preset.findById(req.params.id));
  if (!p) return res.status(404).json({ message: 'Preset not found' });
  res.json(serialize(p));
});

// POST /presets — capture the current Setting.values and/or ThemeOption.options.
// Body: { name, description?, type, thumbnail_id? }
router.post('/', auth, adminOnly, async (req, res) => {
  const { name, description = '', type, thumbnail_id = null } = req.body;
  if (!name || !type) {
    return res.status(400).json({ message: 'name and type are required' });
  }
  if (!['settings', 'themeOption', 'both'].includes(type)) {
    return res.status(400).json({ message: 'type must be settings, themeOption or both' });
  }

  let settingSnapshot = null;
  let themeSnapshot = null;

  if (type === 'settings' || type === 'both') {
    const setting = await Setting.findOne();
    settingSnapshot = stripBlacklist(setting?.values || {});
  }
  if (type === 'themeOption' || type === 'both') {
    const theme = await ThemeOption.findOne();
    themeSnapshot = theme?.options || {};
  }

  try {
    const created = await Preset.create({
      name: name.trim(),
      description,
      type,
      settingSnapshot,
      themeSnapshot,
      thumbnail_id: thumbnail_id || null,
    });
    const populated = await populateThumb(Preset.findById(created._id));
    res.status(201).json(serialize(populated));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A preset with that name already exists' });
    }
    throw err;
  }
});

// PUT /presets/:id — rename / edit description / swap thumbnail.
// Snapshots are NOT re-captured here; use POST for a fresh snapshot.
router.put('/:id', auth, adminOnly, async (req, res) => {
  const update = {};
  if (typeof req.body.name === 'string') update.name = req.body.name.trim();
  if (typeof req.body.description === 'string') update.description = req.body.description;
  if ('thumbnail_id' in req.body) update.thumbnail_id = req.body.thumbnail_id || null;

  try {
    const p = await Preset.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!p) return res.status(404).json({ message: 'Preset not found' });
    const populated = await populateThumb(Preset.findById(p._id));
    res.json(serialize(populated));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A preset with that name already exists' });
    }
    throw err;
  }
});

// DELETE /presets/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const p = await Preset.findByIdAndDelete(req.params.id);
  if (!p) return res.status(404).json({ message: 'Preset not found' });
  res.json({ message: 'Preset deleted' });
});

// POST /presets/:id/apply — overwrite live Setting/ThemeOption with the snapshot.
// Blacklisted sections on Setting are preserved from the current live doc so
// credentials stored today are never wiped by an old preset.
router.post('/:id/apply', auth, adminOnly, async (req, res) => {
  const preset = await Preset.findById(req.params.id);
  if (!preset) return res.status(404).json({ message: 'Preset not found' });

  const result = {};

  if (preset.settingSnapshot && (preset.type === 'settings' || preset.type === 'both')) {
    let setting = await Setting.findOne();
    if (!setting) setting = await Setting.create({ values: {} });
    const current = setting.values || {};
    // Preserve blacklisted (credential) sections from live values.
    const nextValues = { ...stripBlacklist(preset.settingSnapshot) };
    const { SETTING_BLACKLIST_SECTIONS, SETTING_BLACKLIST_KEYS } = require('../utils/presetBlacklist');
    for (const k of SETTING_BLACKLIST_SECTIONS) {
      if (current[k] !== undefined) nextValues[k] = current[k];
    }
    for (const k of SETTING_BLACKLIST_KEYS) {
      if (current[k] !== undefined) nextValues[k] = current[k];
    }
    setting.values = nextValues;
    setting.markModified('values');
    await setting.save();
    result.setting = setting;
  }

  if (preset.themeSnapshot && (preset.type === 'themeOption' || preset.type === 'both')) {
    let theme = await ThemeOption.findOne();
    if (!theme) theme = await ThemeOption.create({ options: {} });
    theme.options = preset.themeSnapshot;
    theme.markModified('options');
    await theme.save();
    result.themeOption = { id: theme._id, options: theme.options };
  }

  res.json({ message: 'Preset applied', ...result });
});

module.exports = router;
