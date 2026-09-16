/**
 * Correos de pedido (src/services/mail/index.js): confirmación al crear el
 * pedido y aviso de cambio de estado. Llegan al cliente con cuenta Y al
 * invitado (guest_name / guest_email guardados en el pedido); antes sin
 * cuenta no se enviaba nada. Textos en español. Sin red: Brevo simulado.
 */

function load() {
  jest.resetModules();
  process.env.STORE_URL = 'https://tienda.example.com';
  const send = jest.fn(async () => ({ messageId: 'x' }));
  jest.doMock('../src/services/mail/brevo', () => ({ sendTransactionalEmail: send, addContactToList: jest.fn(), isConfigured: () => true }));
  const mail = require('../src/services/mail');
  return { mail, send };
}

const consumer = { email: 'ana@example.com', name: 'Ana' };
const products = [{ name: 'Gorra', quantity: 2, sub_total: 145800, variation_name: 'Única' }, { name: 'Jean', quantity: 1, sub_total: 149900 }];
const accountOrder = { _id: 'o1', order_number: 2002, is_guest: false, consumer_id: 'u1', products, total: 295700, payment_method: 'cod' };
const guestOrder = { _id: 'o2', order_number: 2004, is_guest: true, consumer_id: null, guest_name: 'Cliente Invitado', guest_email: 'Invitado@example.com', products, total: 295700, payment_method: 'mercadopago' };

describe('confirmación del pedido', () => {
  test('cliente con cuenta: a su correo, en español, con enlace a Mi cuenta', async () => {
    const { mail, send } = load();
    await mail.sendOrderConfirmation({ order: accountOrder, consumer });
    const { to, subject, htmlContent } = send.mock.calls[0][0];
    expect(to).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(subject).toMatch(/Pedido #2002/);
    expect(htmlContent).toContain('Hola Ana');
    expect(htmlContent).toContain('Gorra (Única)');
    expect(htmlContent).toContain('Jean');
    expect(htmlContent).toContain('Pago contra entrega');
    expect(htmlContent).toContain('https://tienda.example.com/account/order/details/2002');
    expect(htmlContent).not.toMatch(/Thanks for your order/);
  });

  test('invitado: al correo del pedido, con enlace de seguimiento público prellenado', async () => {
    const { mail, send } = load();
    await mail.sendOrderConfirmation({ order: guestOrder, consumer: null });
    const { to, htmlContent } = send.mock.calls[0][0];
    expect(to).toEqual({ email: 'Invitado@example.com', name: 'Cliente Invitado' });
    expect(htmlContent).toContain('Hola Cliente Invitado');
    expect(htmlContent).toContain('Mercado Pago');
    expect(htmlContent).toContain('/order/details?order_number=2004&amp;email_or_phone=Invitado%40example.com');
    expect(htmlContent).not.toContain('/account/order');
  });

  test('sin correo (ni cuenta ni invitado) no se envía nada', async () => {
    const { mail, send } = load();
    await mail.sendOrderConfirmation({ order: { ...accountOrder, guest_email: null }, consumer: {} });
    expect(send).not.toHaveBeenCalled();
  });

  test('pago confirmado por la pasarela: asunto y encabezado lo dicen, con el detalle del pedido', async () => {
    const { mail, send } = load();
    await mail.sendOrderConfirmation({ order: guestOrder, consumer: null, paymentConfirmed: true });
    const { subject, htmlContent } = send.mock.calls[0][0];
    expect(subject).toMatch(/Pago confirmado — pedido #2004/);
    expect(htmlContent).toContain('¡Recibimos tu pago!');
    expect(htmlContent).toContain('Gorra (Única)');
    expect(htmlContent).not.toContain('¡Gracias por tu compra!');
  });
});

describe('cambio de estado', () => {
  test('cliente con cuenta: estado en el asunto y en el cuerpo, en español', async () => {
    const { mail, send } = load();
    await mail.sendOrderStatusUpdate({ order: accountOrder, consumer, statusName: 'Enviado', statusSlug: 'shipped' });
    const { to, subject, htmlContent } = send.mock.calls[0][0];
    expect(to).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(subject).toMatch(/Pedido #2002.*Enviado/);
    expect(htmlContent).toContain('<strong>Enviado</strong>');
    expect(htmlContent).toContain('/account/order/details/2002');
    expect(htmlContent).not.toMatch(/Order update/);
  });

  test('invitado: también recibe el aviso, con su enlace de seguimiento', async () => {
    const { mail, send } = load();
    await mail.sendOrderStatusUpdate({ order: guestOrder, consumer: null, statusName: 'Enviado', statusSlug: 'shipped' });
    const { to, htmlContent } = send.mock.calls[0][0];
    expect(to.email).toBe('Invitado@example.com');
    expect(htmlContent).toContain('/order/details?order_number=2004');
  });

  test('pago confirmado por la pasarela: lo dice antes del estado', async () => {
    const { mail, send } = load();
    await mail.sendOrderStatusUpdate({ order: guestOrder, consumer: null, statusName: 'Procesando', statusSlug: 'processing', paymentConfirmed: true });
    const { subject, htmlContent } = send.mock.calls[0][0];
    expect(subject).toMatch(/Pago confirmado/);
    expect(htmlContent).toContain('Recibimos tu pago');
    expect(htmlContent).toContain('<strong>Procesando</strong>');
  });
});
