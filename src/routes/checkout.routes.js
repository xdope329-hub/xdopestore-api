const router = require('express').Router();
const { checkoutLimiter } = require('../middleware/rateLimiters');
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// POST /checkout  — returns totals summary (does not create order)
router.post('/', checkoutLimiter, optionalAuth, async (req, res) => {
  const { coupon_code, shipping_id } = req.body;
  // Ciudad de entrega: enviada directamente (invitados) o resuelta desde la
  // dirección de envío guardada (usuarios con sesión).
  let city = req.body.city || req.body.shipping_address?.city || req.body.billing_address?.city || '';
  const addressId = req.body.shipping_address_id || req.body.billing_address_id;
  if (!city && addressId) {
    try {
      const Address = require('../models/Address');
      const addr = req.user ? await Address.findOne({ _id: addressId, user_id: req.user._id }) : null;
      if (addr?.city) city = addr.city;
    } catch (_) { /* id inválido — sin ciudad, envío 0 en la vista previa */ }
  }
  // Usuarios: carrito del servidor. Invitados: reconstruido desde los ids
  // enviados con precios de la base de datos.
  let cartItems;
  if (req.user) {
    cartItems = await Cart.find({ consumer_id: req.user._id }).populate('product_id');
  } else {
    const { buildGuestCartItems } = require('../utils/guestCart');
    cartItems = await buildGuestCartItems(req.body.products);
  }
  if (!cartItems.length) return res.status(422).json({ message: 'Cart is empty' });

  let subtotal = cartItems.reduce((sum, i) => sum + i.sub_total, 0);
  let discount = 0;
  let couponFreeShipping = false;
  let appliedCoupon = null;

  if (coupon_code) {
    const { validateCoupon } = require('../utils/couponValidation');
    try {
      const result = await validateCoupon(coupon_code, { userId: req.user ? req.user._id : null, subtotal });
      discount = result.discount;
      couponFreeShipping = result.free_shipping;
      appliedCoupon = { code: result.coupon.code, type: result.coupon.type, amount: result.coupon.amount, title: result.coupon.title };
    } catch (err) {
      return res.status(err.status || 422).json({ message: err.message });
    }
  }

  // Envío por zonas según la ciudad de entrega (0 mientras no haya ciudad,
  // y gratis al superar el umbral — ver src/utils/shippingQuote.js).
  const { quoteShipping } = require('../utils/shippingQuote');
  let quote = city ? await quoteShipping(city, subtotal) : null;
  // Cupón de envío gratis: anula el costo de envío de cualquier zona.
  if (quote && couponFreeShipping && quote.amount > 0) {
    quote = { ...quote, amount: 0, free_shipping: true };
  }
  const shipping_total = quote ? quote.amount : 0;
  const total = subtotal - discount + shipping_total;

  res.json({
    sub_total: subtotal,
    coupon_total_discount: discount,
    applied_coupon: appliedCoupon,
    shipping_total,
    shipping_quote: quote,
    total,
    cart: cartItems,
  });
});

module.exports = router;
