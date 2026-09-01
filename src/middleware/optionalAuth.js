const User = require('../models/User');
const { verifyToken } = require('../config/jwt');

/**
 * Autenticación opcional: si llega un Bearer token válido, adjunta req.user;
 * si no hay token (o es inválido/expirado), continúa como invitado con
 * req.user = null. Usado por el checkout de invitados — las rutas deciden
 * qué exigir según haya usuario o no.
 */
module.exports = async (req, _res, next) => {
  req.user = null;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token === 'undefined' || token === 'null') return next();
  try {
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).populate('role').select('-password -otp -otp_expires_at');
    if (user && user.status !== 0) req.user = user;
  } catch (_) { /* token inválido → invitado */ }
  next();
};
