/**
 * utils/refundRules.refundableAmount: el reembolso de una línea descuenta la
 * parte proporcional del cupón aplicado al pedido.
 */
const { refundableAmount } = require('../src/utils/refundRules');

test('sin cupón se reembolsa el subtotal de la línea', () => {
  expect(refundableAmount({ amount: 300000, coupon_total_discount: 0 }, { sub_total: 100000 })).toBe(100000);
  expect(refundableAmount({}, { sub_total: 59900 })).toBe(59900);
});

test('con cupón se descuenta la proporción del descuento', () => {
  // 15 % de descuento sobre el pedido → la línea de 100.000 devuelve 85.000
  expect(refundableAmount({ amount: 300000, coupon_total_discount: 45000 }, { sub_total: 100000 })).toBe(85000);
  // cupón fijo de 10.000 sobre 250.000: la línea de 50.000 aporta 1/5 → 2.000 menos
  expect(refundableAmount({ amount: 250000, coupon_total_discount: 10000 }, { sub_total: 50000 })).toBe(48000);
});

test('nunca negativo ni mayor que la línea; sin línea, 0', () => {
  expect(refundableAmount({ amount: 100000, coupon_total_discount: 150000 }, { sub_total: 100000 })).toBe(0);
  expect(refundableAmount({ amount: 100000, coupon_total_discount: 5000 }, {})).toBe(0);
});
