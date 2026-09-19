const { getConfig } = require('./config');

/**
 * POST a Meta Conversions API. Nunca lanza: un fallo de tracking no puede
 * romper el checkout ni el webhook. Devuelve { ok, status, body|error }.
 */
async function sendEvents(events) {
  const cfg = getConfig();
  if (!cfg.enabled) return { ok: false, skipped: 'meta_disabled' };
  if (!Array.isArray(events) || !events.length) return { ok: false, skipped: 'no_events' };

  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.accessToken)}`;
  const payload = { data: events };
  if (cfg.testEventCode) payload.test_event_code = cfg.testEventCode;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Meta responde 400 con { error: { message, code, ... } } — log sin token.
      console.error('[Meta CAPI] error', res.status, body?.error?.message || body);
      return { ok: false, status: res.status, body };
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Meta CAPI] sent', events.map((e) => `${e.event_name}#${e.event_id}`).join(','), '→', body?.events_received);
    }
    return { ok: true, status: res.status, body };
  } catch (err) {
    console.error('[Meta CAPI] request failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendEvents };
