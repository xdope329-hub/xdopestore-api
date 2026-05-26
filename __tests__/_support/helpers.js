// Shared helpers for the API test suite. We never touch a real MongoDB —
// each test injects mocks for the model methods it needs and mounts an
// express app with the route under test.

const path = require('path');
const express = require('express');
const methodOverride = require('method-override');

// Resolve project files relative to the API project root so callers can use
// short paths like "src/middleware/auth" or "../src/routes/checkout.routes"
// (older callstyle) regardless of where the test file lives in the tree.
const ROOT = path.resolve(__dirname, '..', '..');
const fromRoot = (...segs) => path.join(ROOT, ...segs);
const resolveModulePath = (modulePath) =>
  fromRoot(modulePath.replace(/^(\.\.\/)+/, ''));

const TEST_USER = {
  _id: '64b0000000000000000000a1',
  role: { name: 'consumer', system_reserve: '0' },
};

const TEST_ADMIN = {
  _id: '64b0000000000000000000b1',
  role: { name: 'admin', system_reserve: '1' },
};

function mockAuth(role) {
  const isAdmin = role === 'admin';
  jest.doMock(fromRoot('src', 'middleware', 'auth'), () => function authMiddleware(req, _res, next) {
    req.user = isAdmin ? TEST_ADMIN : TEST_USER;
    next();
  });
  jest.doMock(fromRoot('src', 'middleware', 'adminOnly'), () => function adminOnlyMiddleware(req, res, next) {
    if (!(req.user && req.user.role && req.user.role.name === 'admin')) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  });
}

function buildApp(mountSpec) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(methodOverride(function methodOverrideFn(req) {
    if (req.body && typeof req.body === 'object' && '_method' in req.body) {
      const m = req.body._method;
      delete req.body._method;
      return m;
    }
  }));
  for (let i = 0; i < mountSpec.length; i++) {
    const entry = mountSpec[i];
    app.use(entry.prefix, require(resolveModulePath(entry.modulePath)));
  }
  app.use(function errorHandler(err, _req, res, _next) {
    res.status(err.status || 500).json({ message: err.message });
  });
  return app;
}

module.exports = { TEST_USER, TEST_ADMIN, mockAuth, buildApp };
