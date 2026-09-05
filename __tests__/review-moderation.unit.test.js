/**
 * Reglas puras de moderación de reseñas (src/utils/reviewModeration.js).
 * Sin base de datos.
 */

const mod = require('../src/utils/reviewModeration');

const id = (n) => n.toString(16).padStart(24, '0');

describe('estado de moderación', () => {
  test('acepta slug, número o texto numérico', () => {
    expect(mod.parseModerationStatus('approved')).toBe(1);
    expect(mod.parseModerationStatus('REJECTED')).toBe(2);
    expect(mod.parseModerationStatus('pending')).toBe(0);
    expect(mod.parseModerationStatus(1)).toBe(1);
    expect(mod.parseModerationStatus('2')).toBe(2);
    expect(mod.parseModerationStatus(true)).toBe(1);
  });

  test('rechaza valores desconocidos', () => {
    expect(mod.parseModerationStatus('published')).toBeNull();
    expect(mod.parseModerationStatus(7)).toBeNull();
    expect(mod.parseModerationStatus(undefined)).toBeNull();
    expect(mod.parseModerationStatus('')).toBeNull();
  });

  test('slug y publicación', () => {
    expect(mod.statusSlug(0)).toBe('pending');
    expect(mod.statusSlug('1')).toBe('approved');
    expect(mod.statusSlug(2)).toBe('rejected');
    expect(mod.isPublished(1)).toBe(true);
    expect(mod.isPublished(0)).toBe(false);
  });
});

describe('validación de la reseña', () => {
  test('creación: la calificación es obligatoria y entera entre 1 y 5', () => {
    expect(mod.validateReviewInput({}).ok).toBe(false);
    expect(mod.validateReviewInput({ rating: 0 }).ok).toBe(false);
    expect(mod.validateReviewInput({ rating: 6 }).ok).toBe(false);
    expect(mod.validateReviewInput({ rating: 3.5 }).ok).toBe(false);
    expect(mod.validateReviewInput({ rating: 'cinco' }).ok).toBe(false);
    expect(mod.validateReviewInput({ rating: '4' })).toEqual({ ok: true, values: { rating: 4 } });
  });

  test('la opinión se recorta y tiene tope de longitud', () => {
    expect(mod.validateReviewInput({ rating: 5, description: '  muy bueno  ' }).values.description).toBe('muy bueno');
    expect(mod.validateReviewInput({ rating: 5, description: 'x'.repeat(mod.MAX_DESCRIPTION_LENGTH + 1) }).ok).toBe(false);
    expect(mod.validateReviewInput({ rating: 5, description: { $gt: '' } }).ok).toBe(false);
  });

  test('edición parcial: se puede cambiar solo la opinión', () => {
    expect(mod.validateReviewInput({ description: 'nuevo' }, { partial: true })).toEqual({ ok: true, values: { description: 'nuevo' } });
    expect(mod.validateReviewInput({ rating: 9 }, { partial: true }).ok).toBe(false);
  });
});

describe('productos pendientes de reseña', () => {
  const product = (n, name) => ({ _id: id(n), name, slug: `p-${n}`, product_thumbnail_id: { original_url: `/${n}.jpg` } });
  const orders = [
    { _id: id(100), order_number: 2002, products: [{ product_id: product(1, 'Camisa') }, { product_id: product(2, 'Jean') }] },
    { _id: id(101), order_number: 2001, products: [{ product_id: product(2, 'Jean') }, { product_id: id(3), name: 'Sin poblar' }] },
  ];

  test('excluye lo ya reseñado (en cualquier estado) y no repite productos', () => {
    const items = mod.pendingReviewItems(orders, [{ product_id: id(1), status: 0 }]);
    expect(items.map((i) => i.product.id)).toEqual([id(2), id(3)]);
    expect(items[0]).toEqual({
      order_id: id(100),
      order_number: 2002,
      product: { id: id(2), name: 'Jean', slug: 'p-2', product_thumbnail: { original_url: '/2.jpg' } },
    });
    // Línea sin producto poblado: usa el nombre guardado en el pedido.
    expect(items[1].product).toEqual({ id: id(3), name: 'Sin poblar', slug: null, product_thumbnail: null });
  });

  test('una línea marcada como calificada (reviewed_at) no se lista aunque ya no exista la reseña', () => {
    const marked = [
      { _id: id(100), order_number: 2002, products: [{ product_id: product(1, 'Camisa'), reviewed_at: new Date('2026-02-01') }, { product_id: product(2, 'Jean') }] },
      // El mismo producto en un pedido anterior sin calificar sí se lista.
      { _id: id(101), order_number: 2001, products: [{ product_id: product(1, 'Camisa') }] },
    ];
    expect(mod.pendingReviewItems(marked, []).map((i) => [i.order_number, i.product.id])).toEqual([[2002, id(2)], [2001, id(1)]]);
  });

  test('sin pedidos entregados no hay nada que calificar', () => {
    expect(mod.pendingReviewItems([], [])).toEqual([]);
    expect(mod.pendingReviewItems(undefined, undefined)).toEqual([]);
  });
});
