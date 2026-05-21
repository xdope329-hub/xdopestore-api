const router = require('express').Router();
const Setting = require('../models/Setting');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// Default storefront settings, seeded on the very first GET /settings.
// COP is the default currency; USD is supported as a secondary picker option.
const DEFAULT_SETTING_VALUES = {
  general: {
    default_currency: {
      id: 1,
      code: 'COP',
      symbol: '$',
      name: 'Colombian Peso',
      no_of_decimal: 0,
      exchange_rate: 1,
      symbol_position: 'before_price',
      thousands_separator: 'dot',
      decimal_separator: 'comma',
      status: 1,
    },
  },
  // Feature flags consumed by the storefront. `earning_points` gates the
  // points sidebar entry, the dashboard tile, and the "pay with points"
  // line in checkout. Default off — admin opts in explicitly.
  activation: {
    earning_points: false,
    coupon_enable: true,
    guest_checkout: true,
    track_order: true,
    multivendor: true,
  },
};

// GET /settings  — public (UI middleware calls this unauthenticated)
router.get('/', async (req, res) => {
  let setting = await Setting.findOne();
  if (!setting) {
    setting = await Setting.create({ values: DEFAULT_SETTING_VALUES });
  } else if (!setting.values?.general?.default_currency?.code) {
    // Back-fill if the Setting doc existed but never had a currency set.
    const merged = setting.values || {};
    merged.general = { ...(merged.general || {}), default_currency: DEFAULT_SETTING_VALUES.general.default_currency };
    setting.values = merged;
    setting.markModified('values');
    await setting.save();
  }
  res.json(setting);
});

// PUT /settings  — admin only
router.put('/', auth, adminOnly, async (req, res) => {
  let setting = await Setting.findOne();
  if (!setting) {
    setting = await Setting.create({ values: req.body.values || req.body });
  } else {
    const incoming = req.body.values || req.body;
    const current = setting.values || {};
    for (const section of Object.keys(incoming)) {
      current[section] = { ...(current[section] || {}), ...incoming[section] };
    }
    setting.values = current;
    setting.markModified('values');
    await setting.save();
  }
  res.json(setting);
});

module.exports = router;
