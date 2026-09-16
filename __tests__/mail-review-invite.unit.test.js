/**
 * Correo de cambio de estado (src/services/mail/index.js): al ENTREGAR se
 * invita a calificar la compra; en cualquier otro estado, o para pedidos de
 * invitado (sin cuenta con la que reseñar), no. Sin red: Brevo simulado.
 */

function load() {
  jest.resetModules();
  const send = jest.fn(async () => ({ messageId: 'x' }));
  jest.doMock('../src/services/mail/brevo', () => ({ sendTransactionalEmail: send, addContactToList: jest.fn(), isConfigured: () => true }));
  const mail = require('../src/services/mail');
  return { mail, send };
}

const consumer = { email: 'ana@example.com', name: 'Ana' };
const order = { _id: 'o1', order_number: 2002, is_guest: false, products: [{ name: 'Gorra' }, { name: 'Jean' }] };

describe('correo de estado del pedido', () => {
  test('entregado: incluye la invitación a calificar con enlace al detalle del pedido', async () => {
    const { mail, send } = load();
    await mail.sendOrderStatusUpdate({ order, consumer, statusName: 'Entregado', statusSlug: 'delivered' });
    const { htmlContent, to } = send.mock.calls[0][0];
    expect(to).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(htmlContent).toContain('Califica tu compra');
    expect(htmlContent).toContain('/account/order/details/2002');
    expect(htmlContent).toContain('Gorra');
    expect(htmlContent).toContain('Jean');
  });

  test('otros estados: sin invitación', async () => {
    const { mail, send } = load();
    await mail.sendOrderStatusUpdate({ order, consumer, statusName: 'Enviado', statusSlug: 'shipped' });
    expect(send.mock.calls[0][0].htmlContent).not.toContain('Califica tu compra');
  });

  test('pedido de invitado entregado: sin invitación (no puede reseñar)', async () => {
    const { mail, send } = load();
    await mail.sendOrderStatusUpdate({ order: { ...order, is_guest: true }, consumer: { email: 'guest@example.com' }, statusName: 'Entregado', statusSlug: 'delivered' });
    expect(send.mock.calls[0][0].htmlContent).not.toContain('Califica tu compra');
  });

  test('sin correo del cliente no se envía nada', async () => {
    const { mail, send } = load();
    await mail.sendOrderStatusUpdate({ order, consumer: {}, statusName: 'Entregado', statusSlug: 'delivered' });
    expect(send).not.toHaveBeenCalled();
  });
});
