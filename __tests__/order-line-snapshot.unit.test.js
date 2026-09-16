/**
 * Instantánea de variante por línea de pedido (utils/orderLineSnapshot.js):
 * atributos (Color, Talla…) y SKU al crear el pedido, y reconstrucción para
 * pedidos antiguos que no la tienen. Sin base de datos.
 */

const { buildOrderLineSnapshot, describeOrderLine } = require('../src/utils/orderLineSnapshot');

const id = (n) => n.toString(16).padStart(24, '0');
const product = {
  _id: id(1),
  name: 'RinRin',
  sku: 'RINRIN',
  variations: [
    { _id: id(10), name: 'Cafe/M', sku: 'RINRIN-CAFE-M', attribute_values: [{ name: 'Color', value: 'Cafe' }, { name: 'Talla', value: 'M' }] },
    { _id: id(11), name: 'Beige/S', sku: '', attribute_values: [{ name: 'Color', value: 'Beige' }, { name: 'Talla', value: 'S' }] },
  ],
};

describe('buildOrderLineSnapshot', () => {
  test('guarda cada atributo elegido y el SKU de la variante', () => {
    const snap = buildOrderLineSnapshot(product, product.variations[0]);
    expect(snap).toEqual({
      variation_name: 'Cafe/M',
      sku: 'RINRIN-CAFE-M',
      variation_attributes: [{ name: 'Color', value: 'Cafe' }, { name: 'Talla', value: 'M' }],
    });
  });

  test('sin SKU en la variante usa el del producto', () => {
    expect(buildOrderLineSnapshot(product, product.variations[1]).sku).toBe('RINRIN');
  });

  test('producto simple: sin atributos, SKU del producto', () => {
    expect(buildOrderLineSnapshot({ sku: 'SIMPLE-1' }, null)).toEqual({ variation_name: null, sku: 'SIMPLE-1', variation_attributes: [] });
    expect(buildOrderLineSnapshot({}, null).sku).toBeNull();
  });
});

describe('describeOrderLine', () => {
  test('usa la instantánea guardada en la línea', () => {
    const line = { variation_id: id(10), variation_name: 'Cafe/M', sku: 'SNAP-SKU', variation_attributes: [{ name: 'Color', value: 'Cafe' }] };
    expect(describeOrderLine(line, product)).toEqual({ variation_name: 'Cafe/M', sku: 'SNAP-SKU', variation_attributes: [{ name: 'Color', value: 'Cafe' }] });
  });

  test('pedido antiguo sin instantánea: reconstruye desde la variante del producto', () => {
    const line = { variation_id: id(10), variation_name: 'Cafe/M' };
    expect(describeOrderLine(line, product)).toEqual({
      variation_name: 'Cafe/M',
      sku: 'RINRIN-CAFE-M',
      variation_attributes: [{ name: 'Color', value: 'Cafe' }, { name: 'Talla', value: 'M' }],
    });
  });

  test('pedido antiguo cuya variante ya no existe: conserva el nombre guardado', () => {
    const line = { variation_id: id(99), variation_name: 'Rojo/L' };
    expect(describeOrderLine(line, product)).toEqual({ variation_name: 'Rojo/L', sku: 'RINRIN', variation_attributes: [] });
    expect(describeOrderLine(line, null)).toEqual({ variation_name: 'Rojo/L', sku: null, variation_attributes: [] });
  });
});
