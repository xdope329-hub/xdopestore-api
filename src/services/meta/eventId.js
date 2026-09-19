/**
 * Ids de eventos Meta. Para Purchase el id DEBE ser estable y unico por
 * pedido: si el mismo pago dispara CAPI (webhook) y browser (pagina de exito),
 * ambos comparten `purchase_<orderId>` y Meta hace deduplicacion.
 */
function purchaseEventId(orderId) {
  return `purchase_${String(orderId)}`;
}

module.exports = { purchaseEventId };
