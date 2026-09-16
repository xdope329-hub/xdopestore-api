const mongoose = require('mongoose');

// Contadores atómicos (p. ej. `order_number`). Un $inc en findOneAndUpdate
// nunca entrega el mismo número a dos pedidos simultáneos; el antiguo
// "leer el último y sumar 1" sí lo hacía y el índice único tumbaba el
// segundo checkout con un 500.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, { versionKey: false });

counterSchema.statics.next = async function next(name, { atLeast = 0 } = {}) {
  // `atLeast` deja el contador por encima del mayor valor ya usado (primera
  // ejecución sobre una base con pedidos, o huecos hechos a mano).
  await this.updateOne({ _id: name }, { $max: { seq: Number(atLeast) || 0 } }, { upsert: true });
  const doc = await this.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true });
  return doc.seq;
};

module.exports = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
