const User = require('../models/User');
const { verifyToken } = require('../config/jwt');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    // Don't leak WHY the token was rejected (expired vs bad signature vs
    // wrong audience) - a generic 401 is fine for the client.
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  req.user = await User.findById(decoded.id).populate('role').select('-password -otp -otp_expires_at');
  if (!req.user) return res.status(401).json({ message: 'User not found' });
  if (req.user.status === 0) return res.status(403).json({ message: 'Account disabled' });

  next();
};
