const mongoose = require('mongoose');

// Global plugin: expose created_at / updated_at aliases from Mongoose timestamps
mongoose.plugin((schema) => {
  schema.set('toJSON', {
    virtuals: true,
    transform(doc, ret) {
      if (ret.createdAt) ret.created_at = ret.createdAt;
      if (ret.updatedAt) ret.updated_at = ret.updatedAt;
      return ret;
    },
  });
});

// URI sin credenciales, apta para logs.
const sanitizeUri = (uri) => String(uri || '').replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]+@/, '$1***@');
const dbNameOf = (uri) => {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/.exec(String(uri || ''));
  return m ? decodeURIComponent(m[1]) : '(default)';
};

module.exports = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const dbName = dbNameOf(process.env.MONGODB_URI);
  const isQa = /_qa$/i.test(dbName) || process.env.APP_ENV === 'qa';
  // Banner de entorno: imposible confundirse de base de datos.
  console.log('════════════════════════════════════════════════');
  console.log(`  ENVIRONMENT : ${isQa ? 'QA  (safe to test)' : 'PRODUCTION DATA'}`);
  console.log(`  DATABASE    : ${dbName}`);
  console.log('════════════════════════════════════════════════');
  console.log('MongoDB connected:', sanitizeUri(process.env.MONGODB_URI));
};

module.exports.sanitizeUri = sanitizeUri;
module.exports.dbNameOf = dbNameOf;
