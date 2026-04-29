const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const bearerHeader = req.headers.authorization || req.headers.Authorization;
  const altHeader = req.headers['x-access-token'];
  let token = undefined;

  if (bearerHeader && typeof bearerHeader === 'string' && bearerHeader.toLowerCase().startsWith('bearer ')) {
    token = bearerHeader.split(' ')[1];
  } else if (altHeader && typeof altHeader === 'string') {
    token = altHeader;
  }

  if (!token) {
    return res.status(401).json({ message: 'Missing token' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    return res.status(500).json({ message: 'Server misconfiguration' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.warn('JWT verify failed:', err?.message);
    if (err && err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
}

module.exports = authMiddleware;
