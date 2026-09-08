/**
 * Capacidad diaria de la tienda (Ajustes → `capacity`).
 *
 * XDOPE produce bajo pedido: el admin define cuántas unidades (o pedidos)
 * puede atender por día. Cuando el cupo de HOY se llena, la tienda deja de
 * vender por el checkout (oculta carrito/checkout y solo ofrece WhatsApp
 * para coordinar) y este módulo rechaza cualquier pedido que llegue igual.
 *
 * Qué ocupa cupo hoy (día de la tienda, STORE_TIMEZONE, por defecto
 * America/Bogota): los pedidos creados hoy que no estén cancelados y cuyo
 * pago esté confirmado (contra entrega, o pasarela completada) o todavía
 * en curso (pasarela pendiente creada hace menos de PENDING_HOLD_MINUTES).
 * Así un checkout de Mercado Pago abandonado libera su cupo solo.
 */
const mongoose = require('mongoose');
const Setting = require('../models/Setting');
const Order = require('../models/Order');
const { isPaymentConfirmed, normalizePaymentStatus, PAYMENT_STATUS } = require('./orderStatusFlow');

const STORE_TIMEZONE = () => process.env.STORE_TIMEZONE || 'America/Bogota';
const PENDING_HOLD_MINUTES = 45;

const DEFAULT_CAPACITY = Object.freeze({
  status: 0,
  daily_limit: 4,
  mode: 'units',
  whatsapp_message: 'Hola XDOPE, quiero hacer un pedido pero hoy ya no tienen cupo. ¿Cuándo podrían atenderlo?',
});

const MESSAGES = {
  reached: 'Hoy ya alcanzamos nuestra capacidad de pedidos. Escríbenos por WhatsApp y coordinamos tu pedido.',
  exceeds: (remaining) =>
    `Hoy solo podemos tomar ${remaining} ${remaining === 1 ? 'unidad más' : 'unidades más'}. Reduce la cantidad o escríbenos por WhatsApp para coordinar el resto.`,
};

/** Ajustes saneados: siempre un objeto completo y válido. */
function normalizeCapacitySettings(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const limit = Number(c.daily_limit);
  const enabled = c.status === 1 || c.status === true || c.status === '1';
  const message = typeof c.whatsapp_message === 'string' ? c.whatsapp_message.trim() : '';
  return {
    status: enabled ? 1 : 0,
    daily_limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_CAPACITY.daily_limit,
    mode: c.mode === 'orders' ? 'orders' : 'units',
    whatsapp_message: message || DEFAULT_CAPACITY.whatsapp_message,
  };
}

// Inicio (en UTC) del día local de `date` en la zona horaria dada. Sin
// librerías: Intl da la fecha/hora local y de ahí sale el desfase.
function localDayStart(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const offsetMs = localAsUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offsetMs);
}

/** Rango [start, end) en UTC del día de la tienda que contiene `now`. */
function storeDayRange(now = new Date(), timeZone = STORE_TIMEZONE()) {
  const start = localDayStart(now, timeZone);
  const end = localDayStart(new Date(start.getTime() + 26 * 3600 * 1000), timeZone);
  return { start, end };
}

const orderUnits = (order) => (order?.products || []).reduce((sum, line) => sum + (Number(line?.quantity) || 0), 0);

/**
 * ¿El pedido ocupa cupo? Cancelado no. Pago confirmado sí. Pasarela
 * pendiente solo durante la ventana de pago (después se asume abandonado).
 */
function holdsCapacity(order, now = new Date()) {
  if (!order) return false;
  const slug = order.status_id && typeof order.status_id === 'object' ? order.status_id.slug : null;
  if (slug === 'cancelled') return false;
  if (isPaymentConfirmed(order)) return true;
  if (normalizePaymentStatus(order.payment_status) !== PAYMENT_STATUS.PENDING) return false;
  const age = now.getTime() - new Date(order.createdAt || 0).getTime();
  return age >= 0 && age < PENDING_HOLD_MINUTES * 60 * 1000;
}

async function usedToday({ now = new Date(), mode = 'units' } = {}) {
  const { start, end } = storeDayRange(now);
  const orders = await Order.find({ createdAt: { $gte: start, $lt: end } })
    .select('products.quantity status_id payment_method payment_status createdAt')
    .populate('status_id', 'slug')
    .lean();
  return (orders || [])
    .filter((order) => holdsCapacity(order, now))
    .reduce((sum, order) => sum + (mode === 'orders' ? 1 : orderUnits(order)), 0);
}

// Ajustes desde la base. Sin conexión (tests unitarios sin Mongo) la
// capacidad se considera desactivada en vez de quedarse esperando.
async function loadCapacitySettings() {
  if (mongoose.connection.readyState !== 1) return null;
  const doc = await Setting.findOne().select('values.capacity').lean();
  return doc?.values?.capacity || null;
}

/**
 * Estado público del cupo de hoy:
 * { enabled, mode, daily_limit, used, remaining, reached, whatsapp_message }.
 * `settings` permite pasar los ajustes ya cargados (o en tests).
 */
async function capacityStatus({ now = new Date(), settings } = {}) {
  const raw = settings !== undefined ? settings : await loadCapacitySettings();
  const cfg = normalizeCapacitySettings(raw);
  const base = { enabled: cfg.status === 1, mode: cfg.mode, daily_limit: cfg.daily_limit, whatsapp_message: cfg.whatsapp_message };
  if (!base.enabled) return { ...base, used: 0, remaining: null, reached: false };
  const used = await usedToday({ now, mode: cfg.mode });
  const remaining = Math.max(0, cfg.daily_limit - used);
  return { ...base, used, remaining, reached: remaining <= 0 };
}

/**
 * Comprobación al crear un pedido. null si cabe; si no,
 * { message, capacity } para responder 422.
 */
async function capacityProblem(cartItems, { now = new Date(), settings } = {}) {
  const status = await capacityStatus({ now, settings });
  if (!status.enabled) return null;
  if (status.reached) return { message: MESSAGES.reached, capacity: status };
  const units = status.mode === 'orders' ? 1 : (cartItems || []).reduce((sum, line) => sum + (Number(line?.quantity) || 0), 0);
  if (units > status.remaining) return { message: MESSAGES.exceeds(status.remaining), capacity: status };
  return null;
}

module.exports = {
  STORE_TIMEZONE,
  DEFAULT_CAPACITY,
  PENDING_HOLD_MINUTES,
  MESSAGES,
  normalizeCapacitySettings,
  storeDayRange,
  holdsCapacity,
  usedToday,
  capacityStatus,
  capacityProblem,
};
