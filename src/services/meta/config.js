/**
 * Meta CAPI configuration. Leído en cada envío para permitir setear/quitar el
 * pixel sin reiniciar el servidor (útil en pruebas).
 *
 * Requiere:
 *   META_PIXEL_ID           id del pixel (no secreto; el frontend también lo usa)
 *   META_CAPI_ACCESS_TOKEN  token secreto — SOLO backend
 * Opcional:
 *   META_TEST_EVENT_CODE    activa el modo Test Events en Events Manager
 *   META_GRAPH_VERSION      por defecto v20.0
 */
const CURRENCY = 'COP';

function getConfig() {
  const pixelId = String(process.env.META_PIXEL_ID || '').trim();
  const accessToken = String(process.env.META_CAPI_ACCESS_TOKEN || '').trim();
  const testEventCode = String(process.env.META_TEST_EVENT_CODE || '').trim();
  const graphVersion = String(process.env.META_GRAPH_VERSION || 'v20.0').trim();
  return {
    pixelId,
    accessToken,
    testEventCode: testEventCode || null,
    graphVersion,
    enabled: Boolean(pixelId && accessToken),
    currency: CURRENCY,
  };
}

module.exports = { getConfig, CURRENCY };
