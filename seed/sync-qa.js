/**
 * Clona la base de datos de PRODUCCIÓN → QA (xdopestore → xdopestore_qa).
 *
 *   npm run sync:qa
 *
 * Garantías de seguridad (a producción NUNCA se le escribe ni borra nada):
 *  - La conexión de origen solo se usa para LEER (listCollections, find,
 *    indexes). No hay ni un solo drop/insert/update contra el origen.
 *  - Se niega a correr si el destino no termina en "_qa", si origen y
 *    destino son la misma base, o si el destino se llama "xdopestore".
 *  - Lo único que se borra son las colecciones de la base *_qa, para que
 *    cada sync deje QA como una copia fresca (mismos usuarios y contraseñas,
 *    mismos productos, mismas configuraciones).
 *
 * Las URIs salen de los archivos .env (origen) y .env.qa (destino) del
 * proyecto — no dependen de variables ya cargadas en la sesión.
 */

const fs = require('fs');
const path = require('path');

// ── Helpers (exportados para las pruebas unitarias) ────────────────────────

/** Parser mínimo de archivos .env: KEY=VALUE, ignora comentarios y vacíos. */
function parseEnvFile(content) {
  const out = {};
  for (const raw of String(content).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Nombre de la base de datos dentro de una URI de MongoDB (o null). */
function dbNameOf(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/.exec(String(uri || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/** URI sin credenciales, apta para logs. */
function sanitizeUri(uri) {
  return String(uri || '').replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]+@/, '$1***@');
}

/**
 * Reglas que protegen producción. Lanza Error si la combinación es insegura.
 * El destino DEBE terminar en "_qa" — así jamás puede ser producción.
 */
function assertSafe(sourceUri, targetUri) {
  const sourceDb = dbNameOf(sourceUri);
  const targetDb = dbNameOf(targetUri);
  if (!sourceUri || !targetUri) throw new Error('Missing MONGODB_URI in .env or .env.qa');
  if (!sourceDb) throw new Error('Source MONGODB_URI has no database name in its path');
  if (!targetDb) throw new Error('Target MONGODB_URI has no database name in its path');
  if (sourceDb === targetDb) throw new Error(`Source and target are the SAME database (${sourceDb}) — refusing`);
  if (!/_qa$/i.test(targetDb)) throw new Error(`Target database "${targetDb}" does not end in _qa — refusing to overwrite it`);
  return { sourceDb, targetDb };
}

module.exports = { parseEnvFile, dbNameOf, sanitizeUri, assertSafe };

// ── Clonado ────────────────────────────────────────────────────────────────

async function main() {
  const root = path.resolve(__dirname, '..');
  const prodEnv = parseEnvFile(fs.readFileSync(path.join(root, '.env'), 'utf8'));
  const qaEnv = parseEnvFile(fs.readFileSync(path.join(root, '.env.qa'), 'utf8'));
  const sourceUri = prodEnv.MONGODB_URI;
  const targetUri = qaEnv.MONGODB_URI;
  const { sourceDb, targetDb } = assertSafe(sourceUri, targetUri);

  console.log(`[sync:qa] source (READ-ONLY): ${sanitizeUri(sourceUri)}`);
  console.log(`[sync:qa] target (overwritten): ${sanitizeUri(targetUri)}`);

  const { MongoClient } = require('mongodb');
  const sourceClient = await MongoClient.connect(sourceUri);
  const targetClient = await MongoClient.connect(targetUri);
  const sdb = sourceClient.db(sourceDb);
  const tdb = targetClient.db(targetDb);

  try {
    const collections = (await sdb.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();

    console.log(`[sync:qa] ${collections.length} collections: ${collections.join(', ')}`);
    let totalDocs = 0;

    for (const name of collections) {
      // Solo se borra en la base _qa (asegurada por assertSafe de arriba).
      await tdb.collection(name).drop().catch((err) => {
        if (err.codeName !== 'NamespaceNotFound') throw err;
      });

      const cursor = sdb.collection(name).find({}, { raw: false });
      let batch = [];
      let count = 0;
      for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= 500) {
          await tdb.collection(name).insertMany(batch, { ordered: false });
          count += batch.length;
          batch = [];
        }
      }
      if (batch.length) {
        await tdb.collection(name).insertMany(batch, { ordered: false });
        count += batch.length;
      }

      // Índices (menos _id_, que Mongo crea solo).
      try {
        const indexes = await sdb.collection(name).indexes();
        for (const idx of indexes) {
          if (idx.name === '_id_') continue;
          const { key, ...rest } = idx;
          delete rest.v; delete rest.ns;
          await tdb.collection(name).createIndex(key, rest).catch(() => {});
        }
      } catch (_) { /* colección vacía sin índices — irrelevante */ }

      totalDocs += count;
      console.log(`[sync:qa]   ${name}: ${count} docs`);
    }

    console.log(`[sync:qa] DONE — ${totalDocs} documents copied from "${sourceDb}" to "${targetDb}".`);
    console.log('[sync:qa] Production was only read; nothing was modified there.');
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[sync:qa] FAILED:', err.message);
    process.exit(1);
  });
}
