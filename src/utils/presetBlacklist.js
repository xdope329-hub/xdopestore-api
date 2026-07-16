// Sections of Setting.values that MUST NOT be captured or overwritten by a
// preset. These hold credentials, tracking keys, or operational flags that a
// seasonal preset (Navidad, Halloween, ...) has no business touching.
//
// If you add a new settings section that stores secrets, add its top-level
// key here or the preset will leak/overwrite it.
const SETTING_BLACKLIST_SECTIONS = [
  'email',
  'payment_method',
  'sms_configuration',
  'maintenance',
  'google_analytics',
  'google_recaptcha',
];

const SETTING_BLACKLIST_KEYS = [
  // Top-level string keys occasionally stored on values.general etc.
  'google_map_key',
];

const stripBlacklist = (values) => {
  if (!values || typeof values !== 'object') return values;
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (SETTING_BLACKLIST_SECTIONS.includes(k)) continue;
    if (SETTING_BLACKLIST_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
};

module.exports = {
  SETTING_BLACKLIST_SECTIONS,
  SETTING_BLACKLIST_KEYS,
  stripBlacklist,
};
