const router = require('express').Router();
const { isAdminUser } = require('../utils/roles');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { buildOrderLineSnapshot, describeOrderLine } = require('../utils/orderLineSnapshot');
const { transitionOrder, allowedNextStatusDocs } = require('../services/orderTransitions');
const Cart = require('../models/Cart');
const OrderStatus = require('../models/OrderStatus');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

// Resolve the variant subdocument from the populated product (cart lines only
// store variation_id) so the order can snapshot its name and price.
function findCartVariation(product, variationId) {
  if (!product || !variationId || !Array.isArray(product.variations)) return null;
  const wanted = String(variationId);
  return product.variations.find((v) => String(v._id || v.id) === wanted) || null;
}

function transformProduct(p) {
  const item = p.toJSON ? p.toJSON() : { ...p };
  const productDoc = item.product_id; // populated or ObjectId
  // Atributos (Color, Talla…) y SKU: de la instantánea guardada en la línea
  // o, para pedidos anteriores, resueltos desde la variante del producto.
  const line = describeOrderLine(item, productDoc && typeof productDoc === 'object' ? productDoc : null);
  return {
    id: item._id,
    product_id: productDoc?._id || productDoc,
    variation_id: item.variation_id,
    name: item.name,
    sku: line.sku,
    variation_attributes: line.variation_attributes,
    product_thumbnail: productDoc?.product_thumbnail_id || null,
    // Siempre 1/0: el producto lo guarda como booleano y el detalle del pedido
    // de la tienda compara con `=== 1` (con `true` el botón Reembolso nunca
    // se habilitaba).
    is_return: Number(productDoc?.is_return ?? 1),
    pivot: {
      single_price: item.price,
      quantity: item.quantity,
      subtotal: item.sub_total,
      // Admin & storefront order views render pivot.variation.name when
      // present (falling back to the product name), so include the product
      // name for context: "Gato curioso — S / Negro".
      variation: line.variation_name
        ? { name: `${item.name} — ${line.variation_name}`, sku: line.sku, attributes: line.variation_attributes }
        : null,
      refund_status: item.refund_status || null,
    },
  };
}

// Campos de diagnóstico de la pasarela: solo el administrador los ve. El
// cliente no los necesita y el payload crudo de Mercado Pago trae datos que
// no son suyos para exponer.
const GATEWAY_INTERNAL_FIELDS = ['payment_gateway_response', 'payment_error', 'payment_gateway_status'];

function transformOrder(order, { admin = false } = {}) {
  const obj = order.toJSON ? order.toJSON() : { ...order };
  if (!admin) GATEWAY_INTERNAL_FIELDS.forEach((field) => { delete obj[field]; });
  obj.order_status = obj.status_id || null;
  obj.consumer = obj.consumer_id || null;
  obj.created_at = obj.createdAt;
  if (!obj.order_status_activities) obj.order_status_activities = [];
  if (!obj.sub_orders) obj.sub_orders = [];
  if (Array.isArray(obj.products)) {
    obj.products = order.products.map(transformProduct);
  }
  return obj;
}

// Returns a Mongoose Query (not yet executed) or null
function findOrderQuery(param) {
  const isObjectId = mongoose.Types.ObjectId.isValid(param) && String(new mongoose.Types.ObjectId(param)) === param;
  if (isObjectId) return Order.findById(param);
  const num = parseInt(param, 10);
  if (!isNaN(num)) return Order.findOne({ order_number: num });
  return null;
}

const populateDetail = [
  { path: 'consumer_id', select: 'name email phone' },
  { path: 'status_id' },
  // `sku` y `variations` permiten reconstruir atributos/SKU de pedidos
  // anteriores a la instantánea por línea (utils/orderLineSnapshot.js).
  { path: 'products.product_id', select: 'name product_thumbnail_id is_return sku variations', populate: { path: 'product_thumbnail_id', select: 'original_url' } },
];

// GET /order
router.get('/', auth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 10;
  const isAdmin = isAdminUser(req.user);
  const filter = isAdmin ? {} : { consumer_id: req.user._id };
  // Las pestañas del admin enlazan con el SLUG del estado ('pending',
  // 'delivered', ...), no con su ObjectId: se resuelve el slug antes de
  // filtrar (un slug crudo en status_id provocaba un CastError → 500).
  if (req.query.status) {
    const raw = String(req.query.status);
    if (mongoose.Types.ObjectId.isValid(raw) && String(new mongoose.Types.ObjectId(raw)) === raw) {
      filter.status_id = raw;
    } else {
      const st = await OrderStatus.findOne({ slug: raw }, '_id');
      // Slug desconocido → ninguna orden coincide (mejor lista vacía que 500).
      filter.status_id = st ? st._id : null;
    }
  }
  // Filtros por pago (usados por las pestañas del admin, p. ej. "Mercado
  // Pago pagados" = payment_method=mercadopago & payment_status=completed).
  if (req.query.payment_method) filter.payment_method = req.query.payment_method;
  if (req.query.payment_status) filter.payment_status = req.query.payment_status;
  const total = await Order.countDocuments(filter);
  const data = await Order.find(filter)
    .skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 })
    .populate('consumer_id', 'name email phone')
    .populate('status_id');
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data: data.map((o) => transformOrder(o, { admin: isAdmin })) });
});

// POST /order — create new order
router.post('/', auth, async (req, res) => {
  if (req.body && req.body.order_status_id !== undefined) {
    // Cambio de estado por esta vía: solo administradores.
    if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Forbidden: admin only' });
    return handleStatusUpdate(req, res);
  }

  const { billing_address, shipping_address, payment_method, coupon_total_discount = 0, shipping_total = 0, notes } = req.body;
  const cartItems = await Cart.find({ consumer_id: req.user._id }).populate('product_id');
  if (!cartItems.length) return res.status(422).json({ message: 'Cart is empty' });

  const products = cartItems.map(i => {
    const variation = findCartVariation(i.product_id, i.variation_id);
    return {
      product_id: i.product_id._id,
      variation_id: i.variation_id,
      // variation_name + variation_attributes (Color, Talla…) + sku
      ...buildOrderLineSnapshot(i.product_id, variation),
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
  });

  await Cart.deleteMany({ consumer_id: req.user._id });
  const populated = await Order.findById(order._id).populate(populateDetail);

  const mail = require('../services/mail');
  mail
    .sendOrderConfirmation({ order: populated.toJSON(), consumer: populated.consumer_id })
    .catch(mail.logMailError('order-confirmation'));

  res.status(201).json(transformOrder(populated));
});

// GET /order/:id — supports MongoDB _id or order_number
router.get('/:id', auth, async (req, res) => {
  const q = findOrderQuery(req.params.id);
  if (!q) return res.status(404).json({ message: 'Order not found' });
  const order = await q.populate(populateDetail);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  const isAdmin = isAdminUser(req.user);
  if (!isAdmin && order.consumer_id._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const payload = transformOrder(order, { admin: isAdmin });
  // Siguientes estados que el administrador puede elegir (la regla vive en
  // el backend; el admin solo muestra estas opciones).
  payload.allowed_next_statuses = await allowedNextStatusDocs(order.status_id?.slug);
  res.json(payload);
});

// PUT /order/:id — update order status (SOLO administradores: antes bastaba
// cualquier sesión de cliente para cambiar el estado de cualquier pedido).
router.put('/:id', auth, adminOnly, async (req, res) => {
  await handleStatusUpdate(req, res);
});

// POST /order/:id — method-override from admin dashboard (sends _method:put)
router.post('/:id', auth, adminOnly, async (req, res) => {
  await handleStatusUpdate(req, res);
});

async function handleStatusUpdate(req, res) {
  const param = req.params.id;
  const { order_status_id, note, changed_at } = req.body;

  if (!param) return res.status(422).json({ message: 'Order ID required' });

  let statusId = order_status_id;
  if (typeof order_status_id === 'object' && order_status_id?.id) {
    statusId = order_status_id.id;
  }

  const q = findOrderQuery(param);
  if (!q) return res.status(404).json({ message: 'Order not found' });
  const found = await q;
  if (!found) return res.status(404).json({ message: 'Order not found' });

  const prevStatusId = String(found.status_id || '');

  // Cambio MANUAL del estado logístico: solo el siguiente paso de la
  // secuencia (o cancelar antes de enviar). Un salto devuelve 422 con los
  // estados permitidos. Nunca toca el estado del pago.
  const result = await transitionOrder(found, statusId);
  if (!result.ok) return res.status(result.status || 422).json({ message: result.message, allowed_next_statuses: result.allowed || [] });

  const order = await Order.findById(found._id).populate(populateDetail);
  if (!order) return res.status(404).json({ message: 'Order not found' });

  if (String(order.status_id?._id || order.status_id || '') !== prevStatusId) {
    const mail = require('../services/mail');
    mail
      .sendOrderStatusUpdate({
        order: order.toJSON(),
        consumer: order.consumer_id,
        statusName: order.status_id?.name || 'updated',
        statusSlug: order.status_id?.slug || null,
      })
      .catch(mail.logMailError('order-status-update'));
  }

  const payload = transformOrder(order, { admin: true });
  payload.allowed_next_statuses = await allowedNextStatusDocs(order.status_id?.slug);
  res.json(payload);
}

// Compartido con GET /trackOrder (misc.routes.js): el seguimiento público
// devuelve exactamente la misma vista del pedido que el detalle del cliente.
router.transformOrder = transformOrder;
router.populateDetail = populateDetail;

module.exports = router;
