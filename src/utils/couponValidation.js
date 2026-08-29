const Coupon = require('../models/Coupon');
const Order = require('../models/Order');

/**
 * Validación central de cupones — usada por la vista previa del checkout
 * (/checkout) y por la creación real del pedido (/payment/initialize), para
 * que el descuento SIEMPRE se calcule en el servidor con las mismas reglas.
 *
 * Reglas: código existente y activo, ventana de fechas (si el cupón expira),
 * gasto mínimo, límite total de usos, límite por cliente y "solo primer
 * pedido". Tipos: percentage, fixed y free_shipping.
 *
 * Lanza un Error con .status (422) y mensaje legible cuando no es válido.
 */
function couponError(message) {
  const err = new Error(message);
  err.status = 422;
  return err;
}

async function validateCoupon(code, { userId, subtotal = 0 } = {}) {
  if (!code) return null;
  const coupon = await Coupon.findOne({ code: String(code).toUpperCase(), status: 1 });
  if (!coupon) throw couponError('Cupón inválido');

  const now = new Date();
  if (coupon.start_date && coupon.start_date > now) throw couponError('El cupón aún no está activo');
  if (coupon.end_date && coupon.end_date < now) throw couponError('El cupón ya expiró');

  if ((coupon.min_spend || 0) > 0 && subtotal < coupon.min_spend) {
    throw couponError(`Compra mínima de $${Number(coupon.min_spend).toLocaleString('es-CO')} para usar este cupón`);
  }

  if (!coupon.is_unlimited && coupon.usage_per_coupon && (coupon.used || 0) >= coupon.usage_per_coupon) {
    throw couponError('Este cupón alcanzó su límite de usos');
  }

  if (userId) {
    if (!coupon.is_unlimited && coupon.usage_per_customer) {
      const mine = await Order.countDocuments({ consumer_id: userId, coupon_code: coupon.code });
      if (mine >= coupon.usage_per_customer) throw couponError('Ya usaste este cupón el máximo de veces permitido');
    }
    if (coupon.is_first_order) {
      const anyOrder = await Order.countDocuments({ consumer_id: userId });
      if (anyOrder > 0) throw couponError('Este cupón es válido solo para tu primer pedido');
    }
  }

  const free_shipping = coupon.type === 'free_shipping';
  let discount = 0;
  if (coupon.type === 'percentage') discount = Math.round((subtotal * (coupon.amount || 0)) / 100);
  else if (coupon.type === 'fixed') discount = Math.min(Number(coupon.amount || 0), subtotal);

  return { coupon, discount, free_shipping };
}

module.exports = { validateCoupon };
