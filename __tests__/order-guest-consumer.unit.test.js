/**
 * Vista del pedido (routes/order.routes.js → transformOrder): el campo
 * `consumer` que leen el admin (lista, detalle, recibo) y la tienda. Para un
 * pedido de invitado no hay cuenta: antes `consumer` era null y el nombre y
 * el correo del comprador salían en blanco aunque el pedido los guardara en
 * guest_name / guest_email. Sin base de datos.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

const { transformOrder } = require('../src/routes/order.routes');

const id = (n) => n.toString(16).padStart(24, '0');
const base = (extra = {}) => ({
  _id: id(100),
  order_number: 2004,
  products: [],
  shipping_address: { street: 'Calle 1', phone: '3105550199', country_code: '57' },
  billing_address: { street: 'Calle 1', phone: '3001112233', country_code: '57' },
  status_id: { _id: id(9), slug: 'pending', name: 'Pendiente' },
  ...extra,
});

describe('transformOrder → consumer', () => {
  test('pedido de invitado: nombre, correo y teléfono guardados en el pedido', () => {
    const out = transformOrder(base({ is_guest: true, guest_name: 'Cliente Invitado', guest_email: 'invitado@example.com', consumer_id: null }));
    expect(out.consumer).toEqual({ name: 'Cliente Invitado', email: 'invitado@example.com', phone: '3105550199', is_guest: true });
    expect(out.guest_email).toBe('invitado@example.com');
  });

  test('pedido de invitado adoptado por una cuenta: manda la cuenta poblada', () => {
    const account = { _id: id(7), name: 'Ana', email: 'ana@example.com' };
    const out = transformOrder(base({ is_guest: false, guest_email: 'ana@example.com', consumer_id: account }));
    expect(out.consumer).toBe(account);
  });

  test('cliente con cuenta poblada', () => {
    const account = { _id: id(7), name: 'Ana', email: 'ana@example.com', phone: '3000000000' };
    const out = transformOrder(base({ consumer_id: account }));
    expect(out.consumer).toBe(account);
    expect(out.order_status).toMatchObject({ slug: 'pending' });
  });

  test('cuenta sin poblar: se conserva el id (comportamiento anterior)', () => {
    const out = transformOrder(base({ consumer_id: id(7) }));
    expect(out.consumer).toBe(id(7));
  });

  test('pedido de invitado sin teléfono en las direcciones', () => {
    const out = transformOrder(base({ is_guest: true, guest_name: 'X', guest_email: 'x@example.com', consumer_id: null, shipping_address: null, billing_address: null }));
    expect(out.consumer).toEqual({ name: 'X', email: 'x@example.com', phone: '', is_guest: true });
  });
});
