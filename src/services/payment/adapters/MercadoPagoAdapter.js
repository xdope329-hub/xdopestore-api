const PaymentGateway = require('../PaymentGateway');

/**
 * Adapter para Mercado Pago — Checkout Pro (flujo de redirect).
 *
 * Variables de entorno requeridas:
 *   MP_ACCESS_TOKEN  — Access Token de producción o sandbox
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

    const body = {
      items: order.products.map(p => ({
        id: String(p.product_id),
        title: p.name,
        quantity: Number(p.quantity),
        unit_price: Number(p.price),
        currency_id: 'COP',
      })),
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
    // En producción usar result.init_point; en sandbox usar result.sandbox_init_point
    const redirect_url = process.env.MP_SANDBOX === 'true'
      ? result.sandbox_init_point
      : result.init_point;

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
