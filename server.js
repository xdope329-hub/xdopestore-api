require('dotenv').config();
require('express-async-errors');

// Force stdout/stderr to be synchronous. On hosts like Render the default
// async buffering can swallow the last few log lines before a process exit,
// which is why earlier deploys showed "Exited with status 1" with no error.
try {
  if (process.stdout._handle && process.stdout._handle.setBlocking) process.stdout._handle.setBlocking(true);
  if (process.stderr._handle && process.stderr._handle.setBlocking) process.stderr._handle.setBlocking(true);
} catch (_) { /* ignore - non-fatal */ }

// Surface ANY startup-time failure (missing module, env var crash, async
// error before listen) instead of letting the process exit silently.
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled promise rejection:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err && err.stack ? err.stack : err);
  process.exit(1);
});

console.log('[startup] Node', process.version, 'PID', process.pid);
console.log('[startup] MONGODB_URI set:', Boolean(process.env.MONGODB_URI));
console.log('[startup] JWT_SECRET set:', Boolean(process.env.JWT_SECRET));
console.log('[startup] CLOUDINARY_CLOUD_NAME set:', Boolean(process.env.CLOUDINARY_CLOUD_NAME));
console.log('[startup] CLOUDINARY_API_KEY set:', Boolean(process.env.CLOUDINARY_API_KEY));
console.log('[startup] CLOUDINARY_API_SECRET set:', Boolean(process.env.CLOUDINARY_API_SECRET));

// Bracket each require so a synchronous throw in the import chain is
// pinpointed instead of producing a silent "Exited with status 1".
let app;
try {
  console.log('[startup] requiring ./app ...');
  app = require('./app');
  console.log('[startup] ./app loaded');
} catch (err) {
  console.error('[FATAL] require(./app) failed:', err && err.stack ? err.stack : err);
  process.exit(1);
}

let connectDB;
try {
  console.log('[startup] requiring ./src/config/db ...');
  connectDB = require('./src/config/db');
  console.log('[startup] ./src/config/db loaded');
} catch (err) {
  console.error('[FATAL] require(./src/config/db) failed:', err && err.stack ? err.stack : err);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('xdopestore API running on port', PORT);
  });
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err && err.message ? err.message : err);
  process.exit(1);
});
