const router = require('express').Router();
const { capacityStatus } = require('../utils/capacity');

// GET /capacity — público. La tienda lo consulta (y lo refresca) para
// decidir si muestra el carrito/checkout o solo WhatsApp; el admin lo usa
// para mostrar "hoy: usadas X de Y". No expone nada sensible.
router.get('/', async (req, res) => {
  try {
    res.json(await capacityStatus());
  } catch (err) {
    console.error('[capacity] status failed', err?.message || err);
    res.status(500).json({ message: 'No se pudo consultar la capacidad de hoy' });
  }
});

module.exports = router;
