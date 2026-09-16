/**
 * Reglas puras del ciclo de vida del pedido y del estado del pago
 * (src/utils/orderStatusFlow.js). Sin base de datos.
 */

const flow = require('../src/utils/orderStatusFlow');

describe('estado del pedido: secuencia manual', () => {
  test('cada paso solo admite el siguiente (y cancelar antes de enviar)', () => {
    expect(flow.allowedNextStatuses('pending')).toEqual(['processing', 'cancelled']);
    expect(flow.allowedNextStatuses('processing')).toEqual(['shipped', 'cancelled']);
    expect(flow.allowedNextStatuses('shipped')).toEqual(['out_for_delivery']);
    expect(flow.allowedNextStatuses('out_for_delivery')).toEqual(['delivered']);
    expect(flow.allowedNextStatuses('delivered')).toEqual([]);
    expect(flow.allowedNextStatuses('cancelled')).toEqual([]);
  });

  test('transiciones válidas', () => {
    expect(flow.canTransition('processing', 'shipped')).toBe(true);
    expect(flow.canTransition('shipped', 'out_for_delivery')).toBe(true);
    expect(flow.canTransition('out_for_delivery', 'delivered')).toBe(true);
    expect(flow.canTransition('pending', 'processing')).toBe(true); // COD, manual
    expect(flow.canTransition('processing', 'cancelled')).toBe(true);
  });

  test('saltos y retrocesos prohibidos', () => {
    expect(flow.canTransition('processing', 'delivered')).toBe(false);
    expect(flow.canTransition('processing', 'out_for_delivery')).toBe(false);
    expect(flow.canTransition('shipped', 'delivered')).toBe(false);
    expect(flow.canTransition('shipped', 'processing')).toBe(false);
    expect(flow.canTransition('delivered', 'processing')).toBe(false);
    expect(flow.canTransition('shipped', 'cancelled')).toBe(false);
    expect(flow.canTransition('delivered', 'cancelled')).toBe(false);
  });

  test('sin estado se asume pending', () => {
    expect(flow.allowedNextStatuses(undefined)).toEqual(['processing', 'cancelled']);
    expect(flow.transitionError('processing', 'delivered')).toMatch(/secuenciales/);
    expect(flow.transitionError('processing', 'delivered')).toMatch(/shipped, cancelled/);
    expect(flow.transitionError('delivered', 'processing')).toMatch(/ya no admite/);
  });
});

describe('estado del pago', () => {
  test('mapeo de Mercado Pago', () => {
    expect(flow.mapGatewayPaymentStatus('approved')).toBe('completed');
    expect(flow.mapGatewayPaymentStatus('rejected')).toBe('rejected');
    expect(flow.mapGatewayPaymentStatus('cancelled')).toBe('cancelled');
    expect(flow.mapGatewayPaymentStatus('refunded')).toBe('refunded');
    expect(flow.mapGatewayPaymentStatus('charged_back')).toBe('refunded');
    expect(flow.mapGatewayPaymentStatus('in_process')).toBe('pending');
    expect(flow.mapGatewayPaymentStatus('pending')).toBe('pending');
    expect(flow.mapGatewayPaymentStatus(undefined)).toBe('pending');
  });

  test('valores antiguos se normalizan sin migrar datos', () => {
    expect(flow.normalizePaymentStatus('paid')).toBe('completed');
    expect(flow.normalizePaymentStatus('FAILED')).toBe('rejected');
    expect(flow.normalizePaymentStatus('')).toBe('pending');
    expect(flow.isPaymentCompleted('paid')).toBe(true);
    expect(flow.isPaymentFailed('failed')).toBe(true);
  });

  test('un pago completado no vuelve a pending por una notificación tardía', () => {
    expect(flow.nextPaymentStatus('completed', 'pending')).toBe('completed');
    expect(flow.nextPaymentStatus('completed', 'refunded')).toBe('refunded');
    expect(flow.nextPaymentStatus('pending', 'completed')).toBe('completed');
    expect(flow.nextPaymentStatus('pending', 'rejected')).toBe('rejected');
  });
});

describe('único cambio automático: pago completado → processing', () => {
  test('solo desde pending', () => {
    expect(flow.shouldAdvanceOnPayment('pending', 'completed')).toBe(true);
    expect(flow.shouldAdvanceOnPayment(undefined, 'completed')).toBe(true);
    expect(flow.shouldAdvanceOnPayment('processing', 'completed')).toBe(false);
    expect(flow.shouldAdvanceOnPayment('shipped', 'completed')).toBe(false);
    expect(flow.shouldAdvanceOnPayment('delivered', 'completed')).toBe(false);
  });

  test('nunca con un pago que no esté completado', () => {
    expect(flow.shouldAdvanceOnPayment('pending', 'pending')).toBe(false);
    expect(flow.shouldAdvanceOnPayment('pending', 'rejected')).toBe(false);
    expect(flow.shouldAdvanceOnPayment('pending', 'refunded')).toBe(false);
  });
});
