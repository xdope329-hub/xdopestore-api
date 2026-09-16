/**
 * Capacidad diaria (utils/capacity.js): día de la tienda en America/Bogota,
 * qué pedidos ocupan cupo, estado público y rechazo al crear pedidos.
 * Sin base de datos: los modelos se simulan.
 */

process.env.STORE_TIMEZONE = 'America/Bogota';

const id = (n) => n.toString(16).padStart(24, '0');

function load({ orders = [], settingDoc } = {}) {
  jest.resetModules();
  const Order = {
    find: jest.fn(() => ({ select() { return this; }, populate() { return this; }, lean: async () => orders })),
  };
  const Setting = {
    findOne: jest.fn(() => ({ select() { return this; }, lean: async () => settingDoc })),
  };
  jest.doMock('../src/models/Order', () => Order);
  jest.doMock('../src/models/Setting', () => Setting);
  const capacity = require('../src/utils/capacity');
  return { capacity, Order, Setting };
}

const NOW = new Date('2026-09-07T20:00:00Z'); // 15:00 en Bogotá
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);
const order = (over = {}) => ({ _id: id(1), status_id: { slug: 'processing' }, payment_method: 'cod', payment_status: 'pending', createdAt: minutesAgo(60), products: [{ quantity: 2 }, { quantity: 1 }], ...over });

describe('normalizeCapacitySettings', () => {
  test('valores por defecto y saneado', () => {
    const { capacity } = load();
    expect(capacity.normalizeCapacitySettings(undefined)).toEqual({ status: 0, daily_limit: 4, mode: 'units', whatsapp_message: capacity.DEFAULT_CAPACITY.whatsapp_message });
    expect(capacity.normalizeCapacitySettings({ status: '1', daily_limit: '6.7', mode: 'orders', whatsapp_message: '  Hola  ' })).toEqual({ status: 1, daily_limit: 6, mode: 'orders', whatsapp_message: 'Hola' });
    expect(capacity.normalizeCapacitySettings({ status: true, daily_limit: 0, mode: 'x' })).toMatchObject({ status: 1, daily_limit: 4, mode: 'units' });
  });
});

describe('storeDayRange', () => {
  test('el día de la tienda va de medianoche a medianoche en Bogotá (UTC-5)', () => {
    const { capacity } = load();
    // 22:30 del 6 de septiembre en Bogotá = 03:30Z del 7
    const late = capacity.storeDayRange(new Date('2026-09-07T03:30:00Z'));
    expect(late.start.toISOString()).toBe('2026-09-06T05:00:00.000Z');
    expect(late.end.toISOString()).toBe('2026-09-07T05:00:00.000Z');
    // justo a medianoche local
    const midnight = capacity.storeDayRange(new Date('2026-09-07T05:00:00Z'));
    expect(midnight.start.toISOString()).toBe('2026-09-07T05:00:00.000Z');
    expect(midnight.end.toISOString()).toBe('2026-09-08T05:00:00.000Z');
    // otra zona horaria
    const madrid = capacity.storeDayRange(new Date('2026-09-07T23:30:00Z'), 'Europe/Madrid');
    expect(madrid.start.toISOString()).toBe('2026-09-07T22:00:00.000Z');
    expect(madrid.end.toISOString()).toBe('2026-09-08T22:00:00.000Z');
  });
});

describe('holdsCapacity', () => {
  test('cancelado no cuenta; contra entrega y pasarela pagada sí', () => {
    const { capacity } = load();
    expect(capacity.holdsCapacity(order({ status_id: { slug: 'cancelled' } }), NOW)).toBe(false);
    expect(capacity.holdsCapacity(order(), NOW)).toBe(true);
    expect(capacity.holdsCapacity(order({ payment_method: 'mercadopago', payment_status: 'completed' }), NOW)).toBe(true);
    expect(capacity.holdsCapacity(order({ payment_method: 'card', payment_status: 'paid' }), NOW)).toBe(true);
  });

  test('pasarela pendiente ocupa cupo solo durante la ventana de pago', () => {
    const { capacity } = load();
    expect(capacity.holdsCapacity(order({ payment_method: 'mercadopago', payment_status: 'pending', createdAt: minutesAgo(10) }), NOW)).toBe(true);
    expect(capacity.holdsCapacity(order({ payment_method: 'mercadopago', payment_status: 'pending', createdAt: minutesAgo(120) }), NOW)).toBe(false);
    expect(capacity.holdsCapacity(order({ payment_method: 'mercadopago', payment_status: 'rejected', createdAt: minutesAgo(1) }), NOW)).toBe(false);
  });
});

describe('capacityStatus / capacityProblem', () => {
  const settings = { status: 1, daily_limit: 4, mode: 'units' };

  test('desactivada: nunca bloquea', async () => {
    const { capacity, Order } = load({ orders: [order()] });
    const status = await capacity.capacityStatus({ now: NOW, settings: { status: 0 } });
    expect(status).toMatchObject({ enabled: false, reached: false, remaining: null, used: 0 });
    expect(await capacity.capacityProblem([{ quantity: 99 }], { now: NOW, settings: { status: 0 } })).toBeNull();
    expect(Order.find).not.toHaveBeenCalled();
  });

  test('cuenta las unidades de hoy que ocupan cupo y consulta solo el día de la tienda', async () => {
    const abandoned = order({ payment_method: 'mercadopago', payment_status: 'pending', createdAt: minutesAgo(120), products: [{ quantity: 2 }] });
    const cancelled = order({ status_id: { slug: 'cancelled' }, products: [{ quantity: 5 }] });
    const { capacity, Order } = load({ orders: [order(), abandoned, cancelled] });
    const status = await capacity.capacityStatus({ now: NOW, settings });
    expect(status).toMatchObject({ enabled: true, mode: 'units', daily_limit: 4, used: 3, remaining: 1, reached: false });
    const query = Order.find.mock.calls[0][0];
    expect(query.createdAt.$gte.toISOString()).toBe('2026-09-07T05:00:00.000Z');
    expect(query.createdAt.$lt.toISOString()).toBe('2026-09-08T05:00:00.000Z');
    expect(await capacity.capacityProblem([{ quantity: 1 }], { now: NOW, settings })).toBeNull();
    const tooMany = await capacity.capacityProblem([{ quantity: 1 }, { quantity: 1 }], { now: NOW, settings });
    expect(tooMany.message).toBe('Hoy solo podemos tomar 1 unidad más. Reduce la cantidad o escríbenos por WhatsApp para coordinar el resto.');
    expect(tooMany.capacity).toMatchObject({ remaining: 1 });
  });

  test('cupo lleno: estado reached y rechazo con invitación a WhatsApp', async () => {
    const { capacity } = load({ orders: [order(), order({ products: [{ quantity: 1 }] })] });
    const status = await capacity.capacityStatus({ now: NOW, settings });
    expect(status).toMatchObject({ used: 4, remaining: 0, reached: true });
    const problem = await capacity.capacityProblem([{ quantity: 1 }], { now: NOW, settings });
    expect(problem.message).toMatch(/WhatsApp/);
    expect(problem.capacity.reached).toBe(true);
  });

  test('modo pedidos: cada pedido cuenta 1 sin importar las unidades', async () => {
    const { capacity } = load({ orders: [order(), order()] });
    const status = await capacity.capacityStatus({ now: NOW, settings: { status: 1, daily_limit: 3, mode: 'orders' } });
    expect(status).toMatchObject({ mode: 'orders', used: 2, remaining: 1, reached: false });
    expect(await capacity.capacityProblem([{ quantity: 10 }], { now: NOW, settings: { status: 1, daily_limit: 3, mode: 'orders' } })).toBeNull();
  });

  test('sin conexión a Mongo los ajustes no se leen y la capacidad queda desactivada', async () => {
    const { capacity, Setting } = load({ settingDoc: { values: { capacity: { status: 1, daily_limit: 1 } } } });
    const status = await capacity.capacityStatus({ now: NOW });
    expect(status.enabled).toBe(false);
    expect(Setting.findOne).not.toHaveBeenCalled();
  });
});
