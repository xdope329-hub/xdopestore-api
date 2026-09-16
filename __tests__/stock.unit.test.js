/**
 * utils/stock.js: comprobación del carrito, descuento/reposición atómica del
 * stock de un pedido (flag `stock_reserved` reclamado de forma condicional,
 * $inc condicionado a la cantidad disponible) y campos derivados del
 * producto (estado de stock, cantidad y precio "desde" del padre).
 * Sin base de datos: Product y Order se simulan (_support/fakeProduct.js).
 */

const id = (n) => n.toString(16).padStart(24, '0');

function load({ product, order }) {
  jest.resetModules();
  const { fakeProductModel, fakeOrderModel } = require('./_support/fakeProduct');
  const Product = fakeProductModel(product);
  const Order = fakeOrderModel(order);
  jest.doMock('../src/models/Product', () => Product);
  jest.doMock('../src/models/Order', () => Order);
  const stock = require('../src/utils/stock');
  return { stock, Product, Order };
}

const simple = (over = {}) => ({ _id: id(1), name: 'Gorra', status: 1, quantity: 5, stock_status: 'in_stock', price: 50, sale_price: 40, variations: [], ...over });
const variable = (over = {}) => ({
  _id: id(2), name: 'Camisa', status: 1, quantity: 6, stock_status: 'in_stock', price: 100, sale_price: 100, discount: null,
  variations: [
    { _id: id(21), name: 'S', quantity: 1, stock_status: 'in_stock', price: 120, sale_price: 100, discount: 17, status: 1 },
    { _id: id(22), name: 'M', quantity: 5, stock_status: 'in_stock', price: 200, sale_price: null, discount: null, status: 1 },
  ],
  ...over,
});
const orderFor = (lines, over = {}) => ({ _id: id(100), order_number: 3000, stock_reserved: false, products: lines, ...over });

describe('stockProblems', () => {
  test('sin problemas cuando hay stock; ignora líneas sin producto poblado', () => {
    const { stock } = load({ product: simple(), order: orderFor([]) });
    expect(stock.stockProblems([{ product_id: simple(), quantity: 2 }, { product_id: id(9), quantity: 99 }])).toEqual([]);
  });

  test('cantidad por encima del stock, agotado, inactivo', () => {
    const { stock } = load({ product: simple(), order: orderFor([]) });
    expect(stock.stockProblems([{ product_id: simple(), quantity: 6 }])).toMatchObject([{ name: 'Gorra', requested: 6, available: 5, reason: 'insufficient' }]);
    expect(stock.stockProblems([{ product_id: simple({ stock_status: 'out_of_stock' }), quantity: 1 }])).toMatchObject([{ name: 'Gorra', available: 0, reason: 'sold_out' }]);
    expect(stock.stockProblems([{ product_id: simple({ status: 0 }), quantity: 1 }])).toMatchObject([{ reason: 'sold_out' }]);
    expect(stock.stockMessage(stock.stockProblems([{ product_id: simple(), quantity: 6 }]))).toBe('Sin stock suficiente. Gorra: quedan 5 (pediste 6)');
  });

  test('cantidad inválida (0, negativa, fraccionaria) y producto con variantes sin variante', () => {
    const { stock } = load({ product: simple(), order: orderFor([]) });
    for (const quantity of [0, -2, 1.5, 'abc']) {
      expect(stock.stockProblems([{ product_id: simple(), quantity }])).toMatchObject([{ reason: 'invalid_quantity' }]);
    }
    expect(stock.stockProblems([{ product_id: variable(), quantity: 1 }])).toMatchObject([{ name: 'Camisa', reason: 'variation_required' }]);
    expect(stock.stockProblems([{ product_id: variable(), variation_id: id(99), quantity: 1 }])).toMatchObject([{ reason: 'variation_required' }]);
    expect(stock.stockMessage(stock.stockProblems([{ product_id: variable(), quantity: 1 }]))).toBe('Sin stock suficiente. Camisa: elige talla y color');
  });

  test('variante: usa la cantidad de la variante y cantidad sin control no limita', () => {
    const { stock } = load({ product: simple(), order: orderFor([]) });
    expect(stock.stockProblems([{ product_id: variable(), variation_id: id(21), quantity: 2 }])).toMatchObject([{ name: 'Camisa (S)', available: 1, requested: 2 }]);
    expect(stock.stockProblems([{ product_id: variable(), variation_id: id(22), quantity: 5 }])).toEqual([]);
    expect(stock.stockProblems([{ product_id: simple({ quantity: null }), quantity: 50 }])).toEqual([]);
  });
});

describe('reserveStock / releaseStock (producto simple)', () => {
  test('descuenta una sola vez, repone una sola vez y usa updates condicionales', async () => {
    const { stock, Product, Order } = load({ product: simple(), order: orderFor([{ product_id: id(1), name: 'Gorra', quantity: 2 }]) });
    expect(await stock.reserveStock(id(100))).toBe(true);
    expect(Product.store).toMatchObject({ quantity: 3, stock_status: 'in_stock' });
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: id(100), stock_reserved: { $ne: true } }, { $set: { stock_reserved: true } });
    expect(Product.updateOne.mock.calls[0]).toEqual([{ _id: id(1), quantity: { $gte: 2 } }, { $inc: { quantity: -2 } }]);
    // segunda reserva: el flag ya está puesto → nada
    expect(await stock.reserveStock(id(100))).toBe(false);
    expect(Product.store.quantity).toBe(3);
    // reposición
    expect(await stock.releaseStock(id(100))).toBe(true);
    expect(Product.store.quantity).toBe(5);
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: id(100), stock_reserved: true }, { $set: { stock_reserved: false } });
    expect(await stock.releaseStock(id(100))).toBe(false);
    expect(Product.store.quantity).toBe(5);
  });

  test('a cero queda agotado y al reponer vuelve a in_stock', async () => {
    const { stock, Product } = load({ product: simple({ quantity: 2 }), order: orderFor([{ product_id: id(1), quantity: 2 }]) });
    await stock.reserveStock(id(100));
    expect(Product.store).toMatchObject({ quantity: 0, stock_status: 'out_of_stock' });
    await stock.releaseStock(id(100));
    expect(Product.store).toMatchObject({ quantity: 2, stock_status: 'in_stock' });
  });

  test('sin stock suficiente (carrera): deja 0, avisa en el log y el pedido queda reservado', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { stock, Product, Order } = load({ product: simple({ quantity: 1 }), order: orderFor([{ product_id: id(1), name: 'Gorra', quantity: 3 }]) });
    expect(await stock.reserveStock(id(100))).toBe(true);
    expect(Product.store).toMatchObject({ quantity: 0, stock_status: 'out_of_stock' });
    expect(Order.doc.stock_reserved).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/sin stock suficiente \(faltaban 3\)/));
    warn.mockRestore();
  });

  test('cantidad sin control (null) no se toca; agotado a mano con cantidad > 0 sigue agotado al vender', async () => {
    const untracked = load({ product: simple({ quantity: null }), order: orderFor([{ product_id: id(1), quantity: 3 }]) });
    await untracked.stock.reserveStock(id(100));
    expect(untracked.Product.store).toMatchObject({ quantity: null, stock_status: 'in_stock' });

    const manual = load({ product: simple({ quantity: 5, stock_status: 'out_of_stock' }), order: orderFor([{ product_id: id(1), quantity: 1 }]) });
    await manual.stock.reserveStock(id(100));
    expect(manual.Product.store).toMatchObject({ quantity: 4, stock_status: 'out_of_stock' });
  });

  test('pedido antiguo sin flag: se puede reservar pero nunca reponer; otro proceso ganó el flag → no toca nada', async () => {
    const legacy = load({ product: simple(), order: orderFor([{ product_id: id(1), quantity: 1 }], { stock_reserved: undefined }) });
    expect(await legacy.stock.releaseStock(id(100))).toBe(false);
    expect(legacy.Product.updateOne).not.toHaveBeenCalled();
    expect(await legacy.stock.reserveStock(id(100))).toBe(true);
    expect(legacy.Product.store.quantity).toBe(4);

    const raced = load({ product: simple(), order: orderFor([{ product_id: id(1), quantity: 1 }]) });
    raced.Order.updateOne.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });
    expect(await raced.stock.reserveStock(id(100))).toBe(false);
    expect(raced.Product.updateOne).not.toHaveBeenCalled();
  });
});

describe('reserveStock / releaseStock (producto con variantes)', () => {
  test('descuenta la variante con arrayFilters, deja la variante agotada y recalcula el padre (cantidad y precio "desde")', async () => {
    const { stock, Product } = load({ product: variable(), order: orderFor([{ product_id: id(2), variation_id: id(21), name: 'Camisa', quantity: 1 }]) });
    expect(await stock.reserveStock(id(100))).toBe(true);
    const [filter, update, options] = Product.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: id(2) });
    expect(update).toEqual({ $inc: { 'variations.$[v].quantity': -1 } });
    expect(String(options.arrayFilters[0]['v._id'])).toBe(id(21));
    expect(options.arrayFilters[0]['v.quantity']).toEqual({ $gte: 1 });
    const s = Product.store.variations.find((v) => String(v._id) === id(21));
    expect(s).toMatchObject({ quantity: 0, stock_status: 'out_of_stock' });
    // padre: suma de variantes y precio de la variante más barata que se puede comprar (M)
    expect(Product.store).toMatchObject({ quantity: 5, stock_status: 'in_stock', price: 200, sale_price: 200, discount: null });
  });

  test('al cancelar vuelve la variante, su estado y el precio "desde" original', async () => {
    const { stock, Product } = load({ product: variable(), order: orderFor([{ product_id: id(2), variation_id: id(21), quantity: 1 }]) });
    await stock.reserveStock(id(100));
    await stock.releaseStock(id(100));
    const s = Product.store.variations.find((v) => String(v._id) === id(21));
    expect(s).toMatchObject({ quantity: 1, stock_status: 'in_stock' });
    expect(Product.store).toMatchObject({ quantity: 6, stock_status: 'in_stock', price: 120, sale_price: 100, discount: 17 });
  });

  test('todas las variantes agotadas → padre agotado; reponer lo vuelve a in_stock', async () => {
    const product = variable({ variations: [{ _id: id(21), name: 'S', quantity: 1, stock_status: 'in_stock', price: 120, sale_price: 100, status: 1 }] });
    const { stock, Product } = load({ product, order: orderFor([{ product_id: id(2), variation_id: id(21), quantity: 1 }]) });
    await stock.reserveStock(id(100));
    expect(Product.store).toMatchObject({ quantity: 0, stock_status: 'out_of_stock' });
    await stock.releaseStock(id(100));
    expect(Product.store).toMatchObject({ quantity: 1, stock_status: 'in_stock' });
  });

  test('variante que ya no existe: avisa y no toca el padre', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { stock, Product } = load({ product: variable(), order: orderFor([{ product_id: id(2), variation_id: id(99), name: 'Camisa', quantity: 1 }]) });
    expect(await stock.reserveStock(id(100))).toBe(true);
    expect(Product.store.variations.map((v) => v.quantity)).toEqual([1, 5]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ya no existe/));
    warn.mockRestore();
  });
});
