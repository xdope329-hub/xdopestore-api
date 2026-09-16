const router = require('express').Router();
const { checkoutLimiter } = require('../middleware/rateLimiters');
const Order = require('../models/Order');
const { buildOrderLineSnapshot, describeOrderLine } = require('../utils/orderLineSnapshot');
const { applyPaymentResult } = require('../services/orderTransitions');
const Cart = require('../models/Cart');
const OrderStatus = require('../models/OrderStatus');
const Address = require('../models/Address');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const { getGateway } = require('../services/payment/PaymentFactory');
const { findCountry, findState } = require('../data/countries');
const { isPaymentConfirmed } = require('../utils/orderStatusFlow');
const { stockProblems, stockMessage, reserveStock } = require('../utils/stock');
const { capacityProblem } = require('../utils/capacity');
const { unitPrice } = require('../utils/cartPricing');

// ── Helpers ────────────────────────────────────────────────────────────────────

// Flatten an Address document (or inline body) to the plain object stored on the
// Order. State/country are kept as { id, name } so they survive without the
// catalog at query time.
function flattenAddressDoc(addr) {
  if (!addr) return null;
  const out = addr.toObject ? addr.toObject({ virtuals: true }) : addr;
  return {
    title: out.title,
    street: out.street,
    city: out.city,
    pincode: out.pincode,
    phone: out.phone,
    country_code: out.country_code,
    country: out.country || (out.country_id ? { id: out.country_id, name: out.country_name } : null),
    state: out.state || (out.state_id ? { id: out.state_id, name: out.state_name } : null),
  };
}

// Resolve inline-form values (country_id / state_id) to the same shape we store.
function flattenInlineAddress(input) {
  if (!input || !input.street) return null;
  const country = findCountry(input.country_id);
  const state = findState(input.country_id, input.state_id);
  return {
    title: input.title,
    street: input.street,
    city: input.city,
    pincode: input.pincode ? String(input.pincode) : '',
    phone: input.phone ? String(input.phone) : '',
    country_code: input.country_code,
    country: country ? { id: country.id, name: country.name } : null,
    state: state ? { id: state.id, name: state.name } : null,
  };
}

// Persist a fresh inline address to the user's address book so the next
// checkout pre-selects it. Returns the saved Address document (or null).
async function persistInlineAddress(input, userId) {
  if (!input || !input.street) return null;
  const country = findCountry(input.country_id);
  const state = findState(input.country_id, input.state_id);
  const existingCount = await Address.countDocuments({ user_id: userId });
  return Address.create({
    user_id: userId,
    title: input.title || 'Checkout',
    street: input.street,
    city: input.city,
    pincode: input.pincode ? String(input.pincode) : '',
    phone: input.phone ? String(input.phone) : '',
    country_code: input.country_code,
    country_id: country ? country.id : null,
    state_id: state ? state.id : null,
    country_name: country ? country.name : '',
    state_name: state ? state.name : '',
    is_default: existingCount === 0,
  });
}

async function resolveAddress(addrInput, addrId, userId, { saveIfInline = false } = {}) {
  if (addrInput && addrInput.street) {
    if (saveIfInline) {
      try { await persistInlineAddress(addrInput, userId); }
      catch (e) { console.warn('[payment] could not persist inline address:', e.message); }
    }
    return flattenInlineAddress(addrInput);
  }
  if (addrId) {
    const addr = await Address.findOne({ _id: addrId, user_id: userId });
    if (addr) return flattenAddressDoc(addr);
  }
  return null;
}

// A cart line for a variable product stores only variation_id — resolve the
// actual variant subdocument from the populated product so the order can
// snapshot its name (size/color) and price.
function findCartVariation(product, variationId) {
  if (!product || !variationId || !Array.isArray(product.variations)) return null;
  const wanted = String(variationId);
  return product.variations.find((v) => String(v._id || v.id) === wanted) || null;
}

// Uso de cupón (límite total de usos). Se cuenta solo con el pago
// confirmado: contra entrega al crear el pedido, pasarela en
// onPaymentConfirmed. Un checkout de Mercado Pago abandonado no consume usos.
async function countCouponUse(code) {
  if (!code) return;
  const Coupon = require('../models/Coupon');
  await Coupon.updateOne({ code }, { $inc: { used: 1 } });
}

async function buildOrderFromCart(userId, body) {
  const { billing_address, billing_address_id, shipping_address, shipping_address_id, payment_method, notes } = body;
  const couponCode = body.coupon_code || body.coupon || '';
  // Persist inline checkout addresses so the user sees them pre-selected next time.
  const resolvedBilling = await resolveAddress(billing_address, billing_address_id, userId, { saveIfInline: Boolean(userId) });
  const resolvedShipping = await resolveAddress(shipping_address, shipping_address_id || billing_address_id, userId, { saveIfInline: Boolean(userId) });

  // Usuarios: carrito del servidor. Invitados: se reconstruye desde los ids
  // enviados, con precios SIEMPRE tomados de la base de datos.
  let cartItems;
  if (userId) {
    cartItems = await Cart.find({ consumer_id: userId }).populate('product_id');
  } else {
    const { buildGuestCartItems } = require('../utils/guestCart');
    cartItems = await buildGuestCartItems(body.products);
  }
  // Líneas cuyo producto ya no existe no se cobran (antes tumbaban el
  // checkout con un 500 al leer product_id.name).
  cartItems = cartItems.filter((i) => i.product_id && typeof i.product_id === 'object');
  if (!cartItems.length) return null;

  const products = cartItems.map(i => {
    const variation = findCartVariation(i.product_id, i.variation_id);
    return {
      product_id: i.product_id._id,
      variation_id: i.variation_id || null,
      // variation_name + variation_attributes (Color, Talla…) + sku
      ...buildOrderLineSnapshot(i.product_id, variation),
      name: i.product_id.name,
      quantity: i.quantity,
      // Precio ACTUAL de la variante o del producto (utils/cartPricing.js) y
      // subtotal recalculado con él: el sub_total guardado en el carrito era
      // el de cuando se agregó y quedaba viejo si el admin cambiaba el precio.
      price: unitPrice(i.product_id, variation),
      sub_total: Math.round(unitPrice(i.product_id, variation) * i.quantity),
    };
  });

  const amount = products.reduce((s, p) => s + p.sub_total, 0);

  // Cupón: se revalida y calcula SIEMPRE en el servidor (mismas reglas que la
  // vista previa) — nunca se confía en un descuento enviado por el cliente.
  let coupon_total_discount = 0;
  let couponFreeShipping = false;
  let coupon_code = null;
  if (couponCode) {
    const { validateCoupon } = require('../utils/couponValidation');
    // Si el cupón dejó de ser válido entre la vista previa y el pago, el
    // error 422 detiene la orden y el cliente ve el motivo.
    const result = await validateCoupon(couponCode, { userId: userId || null, email: userId ? null : body.email, subtotal: amount, cartItems });
    coupon_total_discount = result.discount;
    couponFreeShipping = result.free_shipping;
    coupon_code = result.coupon.code;
  }

  // El envío SIEMPRE se calcula en el servidor a partir de la ciudad de la
  // dirección de entrega — nunca se confía en un valor enviado por el
  // cliente (evita manipular el total desde el navegador).
  const { quoteShipping } = require('../utils/shippingQuote');
  const shipCity = resolvedShipping?.city || resolvedBilling?.city || '';
  const quote = await quoteShipping(shipCity, amount);
  const shipping_total = couponFreeShipping ? 0 : quote.amount;

  // COP no tiene decimales: el total se redondea (un descuento porcentual
  // podía dejar centavos que Mercado Pago cobra distinto).
  const total = Math.round(amount - coupon_total_discount + shipping_total);
  const pendingStatus = await OrderStatus.findOne({ slug: 'pending' });

  return {
    products, amount, total, pendingStatus, billing_address: resolvedBilling, shipping_address: resolvedShipping,
    payment_method, coupon_total_discount, coupon_code, shipping_total, notes,
    delivery_description: body.delivery_description || null,
    delivery_interval: body.delivery_interval || null,
    cartItems,
  };
}

// ── POST /payment/initialize ───────────────────────────────────────────────────
// Crea la orden y delega al gateway correspondiente.
// COD: retorna { success: true, order_id }
// MP:  retorna { redirect_url, order_id }
router.post('/initialize', checkoutLimiter, optionalAuth, async (req, res) => {
  // Checkout de invitados: sin sesión se exigen nombre y correo para poder
  // confirmar el pedido y enviarle el número de orden.
  const isGuest = !req.user;
  if (isGuest) {
    const { name, email } = req.body || {};
    if (!name || !email) return res.status(422).json({ message: 'Nombre y correo son obligatorios para comprar como invitado' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return res.status(422).json({ message: 'Correo inválido' });
  }
  let built;
  try {
    built = await buildOrderFromCart(req.user ? req.user._id : null, req.body);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    throw err;
  }
  if (!built) return res.status(422).json({ message: 'El carrito está vacío' });

  // Stock: se comprueba con las cantidades reales antes de crear el pedido
  // (la tienda limita el selector, pero el servidor es quien manda).
  const problems = stockProblems(built.cartItems);
  if (problems.length) return res.status(422).json({ message: stockMessage(problems), stock: problems });

  // Capacidad diaria (utils/capacity.js): con el cupo de hoy lleno el pedido
  // solo se coordina por WhatsApp. La tienda ya oculta el checkout, pero el
  // servidor es quien manda.
  const capacity = await capacityProblem(built.cartItems);
  if (capacity) return res.status(422).json({ message: capacity.message, capacity: capacity.capacity });

  const { products, amount, total, pendingStatus, shipping_address,
          payment_method, coupon_total_discount, coupon_code, shipping_total, notes,
          delivery_description, delivery_interval } = built;

  // Sin dirección de envío no hay pedido: antes un id inexistente (o un
  // invitado sin direcciones) creaba la orden con direcciones vacías y sin
  // costo de envío. Sin facturación se factura a la dirección de envío.
  if (!shipping_address) return res.status(422).json({ message: 'Selecciona una dirección de envío para realizar tu pedido' });
  const billing_address = built.billing_address || shipping_address;
  if (!payment_method) return res.status(422).json({ message: 'Elige un método de pago para realizar tu pedido' });

  const order = await Order.create({
    consumer_id: req.user ? req.user._id : null,
    is_guest: isGuest,
    guest_name: isGuest ? String(req.body.name).trim() : null,
    guest_email: isGuest ? String(req.body.email).trim().toLowerCase() : null,
    products,
    billing_address,
    shipping_address,
    payment_method: payment_method || 'cod',
    payment_status: 'pending',
    amount,
    coupon_total_discount,
    coupon_code,
    shipping_total,
    total,
    status_id: pendingStatus?._id,
    notes,
    delivery_description,
    delivery_interval,
    payment_initiated_at: new Date(),
  });

  // Uso del cupón solo con el pago confirmado (contra entrega); con pasarela
  // se cuenta en onPaymentConfirmed.
  if (coupon_code && isPaymentConfirmed(order)) await countCouponUse(coupon_code);

  let gatewayResult;
  try {
    const gateway = getGateway(order.payment_method);
    gatewayResult = await gateway.initializePayment(order);
  } catch (err) {
    // Si la pasarela falla, deja la orden en pending y retorna el error
    await Order.findByIdAndUpdate(order._id, { payment_error: err.message });
    return res.status(502).json({ message: 'Error al inicializar el pago', detail: err.message });
  }

  // Para COD: limpiar carrito inmediatamente (los invitados no tienen
  // carrito en el servidor — el suyo es local y lo limpia el frontend).
  if (order.payment_method === 'cod' && req.user) {
    await Cart.deleteMany({ consumer_id: req.user._id });
  }

  // Contra entrega: el pedido queda confirmado al crearse → se descuenta el
  // stock y se envía la confirmación al comprador (cuenta o invitado). Con
  // pasarela (Mercado Pago) nada de esto ocurre hasta que el pago se confirma
  // (webhook / verify): un checkout abandonado no reserva stock ni manda
  // correos. Nunca bloquea el pedido.
  if (isPaymentConfirmed(order)) {
    reserveStock(order._id).catch((err) => console.error('[stock] reserve failed', err?.message || err));
    const mail = require('../services/mail');
    mail
      .sendOrderConfirmation({
        order: order.toJSON ? order.toJSON() : order,
        consumer: req.user ? { name: req.user.name, email: req.user.email } : null,
      })
      .catch(mail.logMailError('order-confirmation'));
  }

  res.status(201).json({ order_id: String(order._id), ...gatewayResult });
});

// Pago confirmado por la pasarela (webhook o verificación) y pedido pasado a
// "processing": ahora sí se descuenta el stock y el comprador (cuenta o
// invitado) recibe la confirmación del pedido. Nunca interrumpe el flujo.
async function onPaymentConfirmed(orderId) {
  const mail = require('../services/mail');
  reserveStock(orderId).catch((err) => console.error('[stock] reserve failed', err?.message || err));
  try {
    const order = await Order.findById(orderId).populate([{ path: 'consumer_id', select: 'name email' }, { path: 'status_id' }]);
    if (!order) return;
    try { await countCouponUse(order.coupon_code); } catch (err) { console.error('[coupon] usage count failed', err?.message || err); }
    const account = order.consumer_id && typeof order.consumer_id === 'object' ? order.consumer_id : null;
    await mail.sendOrderConfirmation({
      order: order.toJSON ? order.toJSON() : order,
      consumer: account ? { name: account.name, email: account.email } : null,
      paymentConfirmed: true,
    });
  } catch (err) {
    mail.logMailError('payment-confirmed')(err);
  }
}

// ── POST /payment/webhook ──────────────────────────────────────────────────────
// Recibe notificaciones de la pasarela (sin autenticación JWT).
// Mercado Pago envía: { type: 'payment', data: { id: '...' } }
router.post('/webhook', async (req, res) => {
  // Responder 200 de inmediato para que la pasarela no reintente
  res.sendStatus(200);

  try {
    const paymentMethod = req.query.gateway || 'mercadopago';
    const gateway = getGateway(paymentMethod);
    const result = await gateway.handleWebhook(req.body, req.headers);
    if (!result) return;

    const { orderId, transactionId, status, gatewayResponse } = result;
    // Solo toca el estado del PAGO. El único efecto logístico es
    // pending → processing al completarse el pago; una notificación
    // repetida o tardía nunca regresa un pedido ya enviado
    // (services/orderTransitions.js).
    const applied = await applyPaymentResult(orderId, { transactionId, status, gatewayResponse });
    if (!applied) return;
    if (applied.advanced && applied.order.consumer_id) {
      await Cart.deleteMany({ consumer_id: applied.order.consumer_id });
    }
    if (applied.advanced) await onPaymentConfirmed(orderId);
  } catch (err) {
    console.error('[payment/webhook] error:', err.message);
  }
});

// ── GET /payment/verify/:orderId ───────────────────────────────────────────────
// El frontend llama este endpoint desde la back_url de MP para confirmar el estado.
router.get('/verify/:orderId', optionalAuth, async (req, res) => {
  const order = await Order.findById(req.params.orderId).populate('status_id');
  if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
  // Órdenes de usuario: solo su dueño puede verificarlas. Órdenes de
  // invitado (consumer_id null): el id de la orden — no adivinable — es la
  // credencial, igual que el enlace de seguimiento del correo.
  if (order.consumer_id && (!req.user || order.consumer_id.toString() !== req.user._id.toString()))
    return res.status(403).json({ message: 'No autorizado' });

  let gatewayStatus = order.payment_status;

  // Si el webhook ya actualizó la orden, retornamos ese estado directamente
  // `order_number`: la página de éxito lo muestra al cliente (antes no viajaba
  // y el número quedaba en blanco).
  if (order.payment_status !== 'pending') {
    return res.json({ order_id: String(order._id), order_number: order.order_number, payment_status: order.payment_status, order_status: order.status_id });
  }

  // Si aún está pending, consultamos a la pasarela. Misma regla que el
  // webhook (services/orderTransitions.js): solo cambia el estado del pago
  // y, si quedó completado con el pedido en pending, lo pasa a processing.
  let orderStatus = order.status_id;
  try {
    const gateway = getGateway(order.payment_method);
    const result = await gateway.verifyPayment(order);
    const applied = await applyPaymentResult(order._id, { transactionId: order.payment_transaction_id, status: result.status });
    if (applied) {
      gatewayStatus = applied.paymentStatus;
      if (applied.advanced) {
        if (order.consumer_id) await Cart.deleteMany({ consumer_id: order.consumer_id });
        orderStatus = await OrderStatus.findById(applied.update.status_id);
        // Sin esperar el correo: la tienda está aguardando esta respuesta.
        onPaymentConfirmed(order._id);
      }
    }
  } catch (err) {
    console.error('[payment/verify] error:', err.message);
  }

  res.json({ order_id: String(order._id), order_number: order.order_number, payment_status: gatewayStatus, order_status: orderStatus });
});

// Compartido con el POST /order heredado (order.routes.js): un solo
// constructor de pedidos con precios, cupón y envío calculados en el servidor.
router.buildOrderFromCart = buildOrderFromCart;

module.exports = router;
