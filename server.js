require('dotenv').config();
require('express-async-errors');

// Surface ANY startup-time failure (missing module, env var crash, async error
// before listen) instead of letting the process exit silently. Without these,
// a host like Render shows only "Exited with status 1" with no clue why.
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled promise rejection:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err && err.stack ? err.stack : err);
  process.exit(1);
});

// Quick sanity log so we know how far startup got even if a require throws
// somewhere below.
console.log('[startup] Node', process.version, 'PID', process.pid);
console.log('[startup] MONGODB_URI set:', Boolean(process.env.MONGODB_URI));
console.log('[startup] JWT_SECRET set:', Boolean(process.env.JWT_SECRET));

const app = require('./app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`xdopestore API running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
