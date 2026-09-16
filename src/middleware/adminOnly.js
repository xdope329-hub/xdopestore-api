const { canAccessAdminRequest } = require('../utils/roles');

/**
 * Área administrativa. El administrador (rol reservado del sistema o
 * llamado "admin") pasa siempre; cualquier otro rol solo pasa si su rol
 * tiene el permiso "módulo.acción" que corresponde a la ruta y al método
 * (utils/roles.js). Hasta ahora esa matriz de permisos solo se pintaba en
 * el menú del admin y no se comprobaba en el servidor.
 */
module.exports = (req, res, next) => {
  if (!canAccessAdminRequest(req.user, req)) {
    return res.status(403).json({ message: 'Forbidden: admin only' });
  }
  next();
};
