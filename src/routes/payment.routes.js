const router = require('express').Router();
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const OrderStatus = require('../models/OrderStatus');
const Address = require('../models/Address');
const auth = require('../middleware/auth');
const { getGateway } = require('../services/payment/PaymentFactory');
const { findCountry, findState } = require('../data/countries');

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

async function buildOrderFromCart(userId, body) {
  const { billing_address, billing_address_id, shipping_address, shipping_address_id, payment_method, coupon_total_discount = 0, shipping_total = 0, notes } = body;
  // Persist inline checkout addresses so the user sees them pre-selected next time.
  const resolvedBilling = await resolveAddress(billing_address, billing_address_id, userId, { saveIfInline: true });
  const resolvedShipping = await resolveAddress(shipping_address, shipping_address_id || billing_address_id, userId, { saveIfInline: true });
  const cartItems = await Cart.find({ consumer_id: userId }).populate('product_id');
  if (!cartItems.length) return null;

  const products = cartItems.map(i => {
    const variation = findCartVariation(i.product_id, i.variation_id);
    return {
      product_id: i.product_id._id,
      variation_id: i.variation_id || null,
      variation_name: variation ? variation.name : null,
      name: i.product_id.name,
      quantity: i.quantity,
      // For variable products the unit price is the variant's, not the parent's.
      price: variation ? (variation.sale_price ?? variation.price) : (i.product_id.sale_price || i.product_id.price),
      sub_total: i.sub_total,
    };
  });

  const amount = cartItems.reduce((s, i) => s + i.sub_total, 0);
  const total = amount - coupon_total_discount + shipping_total;
  const pendingStatus = await OrderStatus.findOne({ slug: 'pending' });

  return { products, amount, total, pendingStatus, billing_address: resolvedBilling, shipping_address: resolvedShipping, payment_method, coupon_total_discount, shipping_total, notes };
}

// ── POST /payment/initialize ───────────────────────────────────────────────────
// Crea la orden y delega al gateway correspondiente.
// COD: retorna { success: true, order_id }
// MP:  retorna { redirect_url, order_id }
router.post('/initialize', auth, async (req, res) => {
  const built = await buildOrderFromCart(req.user._id, req.body);
  if (!built) return res.status(422).json({ message: 'El carrito está vacío' });

  const { products, amount, total, pendingStatus, billing_address, shipping_address,
          payment_method, coupon_total_discount, shipping_total, notes } = built;

  const order = await Order.create({
    consumer_id: req.user._id,
    products,
    billing_address,
    shipping_address,
    payment_method: payment_method || 'cod',
    payment_status: 'pending',
    amount,
    coupon_total_discount,
    shipping_total,
    total,
    status_id: pendingStatus?._id,
    notes,
    payment_initiated_at: new Date(),
  });

  let gatewayResult;
  try {
    const gateway = getGateway(order.payment_method);
    gatewayResult = await gateway.initializePayment(order);
  } catch (err) {
    // Si la pasarela falla, deja la orden en pending y retorna el error
    await Order.findByIdAndUpdate(order._id, { payment_error: err.message });
    return res.status(502).json({ message: 'Error al inicializar el pago', detail: err.message });
  }

  // Para COD: limpiar carrito inmediatamente
  if (order.payment_method === 'cod') {
    await Cart.deleteMany({ consumer_id: req.user._id });
  }

  res.status(201).json({ order_id: String(order._id), ...gatewayResult });
});

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
    const order = await Order.findById(orderId);
    if (!order) return;

    const update = {
      payment_transaction_id: transactionId,
      payment_gateway_response: gatewayResponse,
    };

    if (status === 'approved') {
      update.payment_status = 'completed';
      update.payment_completed_at = new Date();
      // Avanzar la orden a 'processing' y limpiar carrito
      const processingStatus = await OrderStatus.findOne({ slug: 'processing' });
      if (processingStatus) update.status_id = processingStatus._id;
      await Cart.deleteMany({ consumer_id: order.consumer_id });
    } else if (status === 'rejected' || status === 'cancelled') {
      update.payment_status = 'failed';
      update.payment_error = `Pago ${status} por la pasarela`;
    }

    await Order.findByIdAndUpdate(orderId, update);
  } catch (err) {
    console.error('[payment/webhook] error:', err.message);
  }
});

// ── GET /payment/verify/:orderId ───────────────────────────────────────────────
// El frontend llama este endpoint desde la back_url de MP para confirmar el estado.
router.get('/verify/:orderId', auth, async (req, res) => {
  const order = await Order.findById(req.params.orderId).populate('status_id');
  if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
  if (order.consumer_id.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'No autorizado' });

  let gatewayStatus = order.payment_status;

  // Si el webhook ya actualizó la orden, retornamos ese estado directamente
  if (order.payment_status !== 'pending') {
    return res.json({ order_id: String(order._id), payment_status: order.payment_status, order_status: order.status_id });
  }

  // Si aún está pending, consultamos a la pasarela
  try {
    const gateway = getGateway(order.payment_method);
    const result = await gateway.verifyPayment(order);
    gatewayStatus = result.status;

    if (gatewayStatus === 'approved') {
      const processingStatus = await OrderStatus.findOne({ slug: 'processing' });
      await Order.findByIdAndUpdate(order._id, {
        payment_status: 'completed',
        payment_completed_at: new Date(),
        ...(processingStatus ? { status_id: processingStatus._id } : {}),
      });
      await Cart.deleteMany({ consumer_id: order.consumer_id });
    }
  } catch (err) {
    console.error('[payment/verify] error:', err.message);
  }

  res.json({ order_id: String(order._id), payment_status: gatewayStatus, order_status: order.status_id });
});

module.exports = router;
