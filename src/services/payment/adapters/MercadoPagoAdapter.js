const PaymentGateway = require('../PaymentGateway');

/**
 * Adapter para Mercado Pago — Checkout Pro (flujo de redirect).
 *
 * Variables de entorno requeridas:
 *   MP_ACCESS_TOKEN  — Access Token (credenciales de prueba o de producción)
 *   BASE_URL         — URL pública del backend (para notification_url)
 *   STORE_URL        — URL pública del frontend (para back_urls)
 *
 * Para instalar el SDK: npm install mercadopago
 */
class MercadoPagoAdapter extends PaymentGateway {
  _getClient() {
    const { MercadoPagoConfig } = require('mercadopago');
    return new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  }

  async initializePayment(order) {
    const { Preference } = require('mercadopago');
    const client = this._getClient();
    const preference = new Preference(client);

    // Mercado Pago rejects `auto_return` when the back_urls are not publicly
    // reachable (e.g. http://localhost:3001 in local dev) with the error
    // "auto_return invalid. back_url.success must be defined". Locally we
    // omit auto_return (the buyer clicks "Volver al sitio" manually) and the
    // webhook URL (MP can't reach localhost anyway — /payment/verify on the
    // return page confirms the payment instead).
    const storeUrl = process.env.STORE_URL || '';
    const baseUrl = process.env.BASE_URL || '';
    const isLocal = (u) => /localhost|127\.0\.0\.1/i.test(u);

    // ── Items: el total cobrado por MP debe ser EXACTAMENTE order.total ──────
    // order.total = productos − cupón + envío (calculado en el servidor).
    // Sin cupón: se envían los productos itemizados. Con cupón: MP no acepta
    // ítems negativos, así que se consolida en un solo ítem con el valor ya
    // descontado (el detalle queda en la orden y en el correo de la tienda).
    const discount = Number(order.coupon_total_discount || 0);
    const shippingCost = Number(order.shipping_total || 0);
    const productsTotal = order.products.reduce((s, p) => s + Number(p.price) * Number(p.quantity), 0);

    let items;
    if (discount > 0) {
      const itemCount = order.products.reduce((s, p) => s + Number(p.quantity), 0);
      items = [{
        id: String(order._id),
        title: `Pedido XDOPE (${itemCount} producto${itemCount === 1 ? '' : 's'}${order.coupon_code ? `, cupón ${order.coupon_code}` : ''})`,
        quantity: 1,
        unit_price: productsTotal - discount,
        currency_id: 'COP',
      }];
    } else {
      items = order.products.map(p => ({
        id: String(p.product_id),
        title: p.name,
        quantity: Number(p.quantity),
        unit_price: Number(p.price),
        currency_id: 'COP',
      }));
    }

    // Verificación de consistencia: ítems + envío == total de la orden.
    // Si algún cambio futuro rompe la fórmula, es mejor frenar aquí que
    // cobrar un valor distinto al mostrado en el checkout.
    const itemsTotal = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    if (Math.round(itemsTotal + shippingCost) !== Math.round(Number(order.total))) {
      throw new Error(`Preferencia MP inconsistente: items ${itemsTotal} + envío ${shippingCost} != total ${order.total}`);
    }

    const body = {
      items,
      // Envío como costo de shipment — MP lo muestra como línea de envío y
      // lo suma al total cobrado.
      ...(shippingCost > 0 ? { shipments: { cost: shippingCost, mode: 'not_specified' } } : {}),
      external_reference: String(order._id),
      back_urls: {
        success: `${storeUrl}/order/success?id=${order._id}`,
        failure: `${storeUrl}/order/failure?id=${order._id}`,
        pending: `${storeUrl}/order/pending?id=${order._id}`,
      },
      ...(isLocal(storeUrl) ? {} : { auto_return: 'approved' }),
      ...(isLocal(baseUrl) ? {} : { notification_url: `${baseUrl}/payment/webhook` }),
    };

    const result = await preference.create({ body });
    // Siempre init_point. El antiguo sandbox_init_point apunta a
    // sandbox.mercadopago.com.co, dominio legado que hoy entra en un bucle de
    // redirecciones (ERR_TOO_MANY_REDIRECTS). El entorno de prueba se decide
    // por las CREDENCIALES (de prueba vs. producción), no por la URL: con
    // credenciales de prueba, init_point ya abre un checkout de prueba.
    // MP_SANDBOX queda solo como bandera informativa (banner QA, logs).
    const redirect_url = result.init_point || result.sandbox_init_point;
    if (!redirect_url) throw new Error('Mercado Pago no devolvió init_point para la preferencia');

    return { redirect_url, preference_id: result.id };
  }

  async verifyPayment(order) {
    if (!order.payment_transaction_id) return { status: 'pending' };
    const { Payment } = require('mercadopago');
    const payment = new Payment(this._getClient());
    const result = await payment.get({ id: order.payment_transaction_id });
    return { status: result.status }; // approved | pending | rejected
  }

  async handleWebhook(payload, headers) {
    // Mercado Pago envía: { type: 'payment', data: { id: '...' } }
    if (payload.type !== 'payment' || !payload.data?.id) return null;

    const { Payment } = require('mercadopago');
    const payment = new Payment(this._getClient());
    const result = await payment.get({ id: payload.data.id });

    return {
      orderId: result.external_reference,
      transactionId: String(result.id),
      status: result.status,       // approved | pending | rejected
      gatewayResponse: result,
    };
  }
}

module.exports = MercadoPagoAdapter;
