const router = require('express').Router();
const Setting = require('../models/Setting');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const optionalAuth = require('../middleware/optionalAuth');
const { redactSettingsFor } = require('../utils/settingsRedaction');

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
  // Payment methods shown at checkout. The API's payment layer supports
  // 'cod' (contra entrega) and 'mercadopago' (Checkout Pro redirect).
  // COD ships disabled — the store only offers Mercado Pago. Re-enable by
  // flipping status to 1 (or via PUT /settings).
  payment_methods: [
    { name: 'cod', status: 0 },
    { name: 'mercadopago', status: 1 },
  ],
  payment_methods_migrated_v2: true,
  // Floating WhatsApp button on every storefront page (plus the footer's
  // social links). Edited from the admin under Settings -> WhatsApp; off
  // until a number is saved.
  whatsapp: {
    status: 0,
    number: '',
    message: '',
  },
  // Cinta de anuncios (announcement bar): la tira que se desplaza en la
  // parte superior de la tienda (estilo koaj.co). Se administra desde el
  // admin en Configuración -> Cinta de anuncios. `bg_color` vacío = usa el
  // color primario del tema. `speed` = segundos que tarda un ciclo completo.
  announcement_bar: {
    status: 0,
    bg_color: '',
    text_color: '#ffffff',
    speed: 30,
    messages: [
      { text: 'Envío gratis después de $200.000 en compras', status: 1 },
    ],
  },
  // Site-wide social profiles (contact page, footer, etc.). Lives in
  // Settings — NOT in theme options — so switching themes or footer styles
  // never affects these links. Edited under admin Settings -> Social Networks.
  social: {
    facebook: '',
    instagram: '',
    twitter: '',
    pinterest: '',
  },
  // Capacidad diaria de producción (utils/capacity.js). Con status 1, al
  // llenarse el cupo de hoy (`daily_limit` unidades o pedidos según `mode`,
  // en el día de la tienda) el checkout se cierra y la tienda solo ofrece
  // WhatsApp con `whatsapp_message` para coordinar el pedido.
  capacity: {
    status: 0,
    daily_limit: 4,
    mode: 'units',
    whatsapp_message: 'Hola XDOPE, quiero hacer un pedido pero hoy ya no tienen cupo. ¿Cuándo podrían atenderlo?',
  },
};

// GET /settings  — public (UI middleware calls this unauthenticated)
router.get('/', optionalAuth, async (req, res) => {
  let setting = await Setting.findOne();
  if (!setting) {
    setting = await Setting.create({ values: DEFAULT_SETTING_VALUES });
  } else {
    let dirty = false;
    const merged = setting.values || {};
    if (!merged.general?.default_currency?.code) {
      // Back-fill if the Setting doc existed but never had a currency set.
      merged.general = { ...(merged.general || {}), default_currency: DEFAULT_SETTING_VALUES.general.default_currency };
      dirty = true;
    }
    if (!merged.whatsapp) {
      // Back-fill for databases created before the WhatsApp button existed.
      merged.whatsapp = { ...DEFAULT_SETTING_VALUES.whatsapp };
      dirty = true;
    }
    if (!merged.social) {
      // Back-fill for databases created before social settings existed.
      // Seed from any URLs already saved in theme options' footer so an
      // existing store keeps its links without retyping them.
      merged.social = { ...DEFAULT_SETTING_VALUES.social };
      try {
        const ThemeOption = require('../models/ThemeOption');
        const to = await ThemeOption.findOne();
        const f = to?.options?.footer || {};
        ['facebook', 'instagram', 'twitter', 'pinterest'].forEach((k) => {
          if (f[k]) merged.social[k] = f[k];
        });
      } catch (_) { /* theme options unavailable — keep empty defaults */ }
      dirty = true;
    }
    if (!merged.announcement_bar) {
      // Back-fill for databases created before the announcement bar existed.
      merged.announcement_bar = JSON.parse(JSON.stringify(DEFAULT_SETTING_VALUES.announcement_bar));
      dirty = true;
    }
    if (!merged.capacity) {
      // Back-fill para bases anteriores a la capacidad diaria.
      merged.capacity = { ...DEFAULT_SETTING_VALUES.capacity };
      dirty = true;
    }
    if (!Array.isArray(merged.payment_methods) || merged.payment_methods.length === 0) {
      // Back-fill payment methods for databases created before they were
      // part of the defaults — otherwise checkout shows no payment options.
      merged.payment_methods = DEFAULT_SETTING_VALUES.payment_methods;
      merged.payment_methods_migrated_v2 = true;
      dirty = true;
    } else if (!merged.payment_methods_migrated_v2) {
      // One-time migration: hide COD on databases that got the earlier
      // backfill (cod enabled). Runs once; later admin edits are respected.
      merged.payment_methods = merged.payment_methods.map((m) =>
        m?.name === 'cod' ? { ...m, status: 0 } : m
      );
      merged.payment_methods_migrated_v2 = true;
      dirty = true;
    }
    if (dirty) {
      setting.values = merged;
      setting.markModified('values');
      await setting.save();
    }
  }
  // Anónimos y consumidores no reciben credenciales (utils/settingsRedaction.js).
  res.json(redactSettingsFor(req.user, setting));
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
      const value = incoming[section];
      // Secciones que son listas (payment_methods) se reemplazan completas:
      // fusionarlas como objeto las convertía en { 0: …, 1: … }, el GET ya no
      // las reconocía como lista y las devolvía a los valores por defecto, así
      // que desde el admin nunca se podía activar contra entrega.
      if (Array.isArray(value) || Array.isArray(current[section]) || value === null || typeof value !== 'object') {
        current[section] = value;
      } else {
        current[section] = { ...(current[section] || {}), ...value };
      }
    }
    setting.values = current;
    setting.markModified('values');
    await setting.save();
  }
  // Anónimos y consumidores no reciben credenciales (utils/settingsRedaction.js).
  res.json(redactSettingsFor(req.user, setting));
});

// POST /settings/test-email — admin-only, fires a Brevo test email
router.post('/test-email', auth, adminOnly, async (req, res) => {
  const to = req.body?.email || req.body?.to;
  if (!to) return res.status(422).json({ message: 'email required' });
  const mail = require('../services/mail');
  if (!mail.isConfigured()) {
    return res.status(400).json({ message: 'BREVO_API_KEY is not set on the server' });
  }
  try {
    await mail.sendTestEmail({ to });
    res.json({ message: `Test email sent to ${to}` });
  } catch (err) {
    res.status(502).json({ message: err.message || 'Failed to send test email', details: err.details });
  }
});

module.exports = router;
