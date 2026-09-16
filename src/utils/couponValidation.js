const Coupon = require('../models/Coupon');
const Order = require('../models/Order');

/**
 * Validación central de cupones — usada por la vista previa del checkout
 * (/checkout) y por la creación real del pedido (/payment/initialize), para
 * que el descuento SIEMPRE se calcule en el servidor con las mismas reglas.
 *
 * Reglas: código existente y activo, ventana de fechas (si el cupón expira),
 * gasto mínimo, límite total de usos, límite por cliente y "solo primer
 * pedido" (con cuenta por consumer_id; invitados por el correo del checkout)
 * y la restricción por productos de la pestaña Restricciones del admin
 * (`is_apply_all` + `exclude_products`, o solo `products`). Tipos:
 * percentage, fixed y free_shipping. El descuento se calcula sobre las
 * líneas elegibles del carrito y nunca supera su subtotal.
 *
 * Lanza un Error con .status (422) y mensaje legible cuando no es válido.
 */
function couponError(message) {
  const err = new Error(message);
  err.status = 422;
  return err;
}

const idOf = (value) => String(value && typeof value === 'object' ? value._id || value.id || '' : value || '');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * Líneas del carrito a las que aplica el cupón. `cartItems` traen
 * `product_id` poblado (documento) o como id suelto. Un cupón sin lista de
 * productos aplica a todo el carrito.
 */
function eligibleLines(coupon, cartItems = []) {
  const included = (coupon.products || []).map(idOf).filter(Boolean);
  const excluded = (coupon.exclude_products || []).map(idOf).filter(Boolean);
  const applyAll = coupon.is_apply_all !== false && Number(coupon.is_apply_all) !== 0;
  return (cartItems || []).filter((line) => {
    const productId = idOf(line?.product_id);
    if (applyAll) return !excluded.includes(productId);
    return included.length ? included.includes(productId) : true;
  });
}

async function validateCoupon(code, { userId, email, subtotal = 0, cartItems } = {}) {
  if (!code) return null;
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase(), status: 1 });
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

  // Quién compra: cuenta (consumer_id) o invitado (correo del checkout). Sin
  // ninguno de los dos (vista previa del invitado antes de escribir el
  // correo) no se puede comprobar; el pago vuelve a validar con el correo.
  const buyer = userId ? { consumer_id: userId } : normalizeEmail(email) ? { guest_email: normalizeEmail(email) } : null;
  if (buyer) {
    if (!coupon.is_unlimited && coupon.usage_per_customer) {
      const mine = await Order.countDocuments({ ...buyer, coupon_code: coupon.code });
      if (mine >= coupon.usage_per_customer) throw couponError('Ya usaste este cupón el máximo de veces permitido');
    }
    if (coupon.is_first_order) {
      const anyOrder = await Order.countDocuments(buyer);
      if (anyOrder > 0) throw couponError('Este cupón es válido solo para tu primer pedido');
    }
  }

  // Restricción por productos: el descuento solo cubre las líneas elegibles.
  const restricted = (coupon.products || []).length > 0 || (coupon.exclude_products || []).length > 0;
  const lines = Array.isArray(cartItems) ? eligibleLines(coupon, cartItems) : null;
  if (lines && restricted && lines.length === 0) throw couponError('Este cupón no aplica a los productos de tu carrito');
  const base = lines ? lines.reduce((sum, line) => sum + (Number(line?.sub_total) || 0), 0) : subtotal;

  const free_shipping = coupon.type === 'free_shipping';
  let discount = 0;
  if (coupon.type === 'percentage') discount = Math.round((base * Math.min(Number(coupon.amount) || 0, 100)) / 100);
  else if (coupon.type === 'fixed') discount = Number(coupon.amount || 0);
  discount = Math.max(0, Math.min(discount, base));

  return { coupon, discount, free_shipping, eligible_subtotal: base };
}

module.exports = { validateCoupon, eligibleLines };
