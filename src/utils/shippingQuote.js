const Shipping = require('../models/Shipping');
const { isZone1City } = require('../data/colombiaCities');

/**
 * Cálculo de envío por zonas para Colombia.
 *
 * Zona 1: ciudades principales y áreas metropolitanas.
 * Zona 2: resto del país (incluye ciudades no listadas / "Otra ciudad").
 * Envío gratis cuando el subtotal alcanza free_shipping_threshold (en todas
 * las zonas). Las tarifas y el umbral viven en el documento Shipping de
 * Colombia (editable vía PUT /shipping/:id); estos son los valores por
 * defecto si aún no se han configurado zonas.
 */
const DEFAULT_ZONES = [
  { zone: 1, name: 'Zona 1 — Ciudades principales', amount: 9900 },
  { zone: 2, name: 'Zona 2 — Resto del país', amount: 14900 },
];
const DEFAULT_FREE_THRESHOLD = 200000;

async function getShippingConfig() {
  const doc = await Shipping.findOne({ status: 1 });
  const zones = doc?.zones?.length ? doc.zones : DEFAULT_ZONES;
  const threshold = doc?.free_shipping_threshold ?? DEFAULT_FREE_THRESHOLD;
  return { zones, free_shipping_threshold: threshold };
}

/**
 * @param {string} city    Ciudad de la dirección de envío (texto o del dropdown).
 * @param {number} subtotal Subtotal del carrito (después de descuentos de producto).
 * @returns {{ amount:number, zone:number, zone_name:string, free_shipping:boolean, free_shipping_threshold:number }}
 */
async function quoteShipping(city, subtotal = 0) {
  const { zones, free_shipping_threshold } = await getShippingConfig();
  const zoneNumber = isZone1City(city) ? 1 : 2;
  const zoneCfg = zones.find((z) => Number(z.zone) === zoneNumber) || zones[zones.length - 1];
  const free = free_shipping_threshold > 0 && Number(subtotal) >= free_shipping_threshold;
  return {
    amount: free ? 0 : Number(zoneCfg?.amount ?? 0),
    zone: zoneNumber,
    zone_name: zoneCfg?.name || `Zona ${zoneNumber}`,
    free_shipping: free,
    free_shipping_threshold,
  };
}

module.exports = { quoteShipping, getShippingConfig, DEFAULT_ZONES, DEFAULT_FREE_THRESHOLD };
