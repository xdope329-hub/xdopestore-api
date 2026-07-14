/**
 * Reset script - wipes the seeded catalog / transactional data so the admin
 * can start clean. KEEPS the bits the admin needs to log in and operate:
 *   - users          (admin account)
 *   - roles          (admin role + permissions)
 *   - settings       (default currency, activation flags, etc.)
 *   - orderstatuses  (pending, processing, etc. referenced by orders)
 *
 * Drops everything else (products, categories, orders, cart, blogs, etc.).
 * Run with:    npm run reset
 * Add --hard to drop the entire collections (indexes too) instead of just
 * deleting documents:    npm run reset -- --hard
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

const HARD = process.argv.includes('--hard');
const YES  = process.argv.includes('--yes');

// Collections we'll wipe. The names are Mongoose's default pluralization of
// the model name (Product -> products, OrderStatus -> orderstatuses).
const COLLECTIONS_TO_WIPE = [
  'products',
  'categories',
  'brands',
  'attributes',
  'attributevalues',
  'tags',
  'blogs',
  'orders',
  'carts',
  'wishlists',
  'compares',
  'reviews',
  'questions',
  'coupons',
  'taxes',
  'shippings',
  'menus',
  'homepages',
  'themeoptions',
  'notifications',
  'addresses',
  'attachments',
];

// These stay untouched.
const KEEP = ['users', 'roles', 'settings', 'orderstatuses'];

function confirm(question) {
  if (YES) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Aborting.');
    process.exit(1);
  }
  console.log('Connecting to:', process.env.MONGODB_URI.replace(/:[^:@]+@/, ':***@'));
  await mongoose.connect(process.env.MONGODB_URI);

  const dbName = mongoose.connection.db.databaseName;
  console.log('');
  console.log('Database:        ', dbName);
  console.log('Mode:            ', HARD ? 'HARD (drop collections + indexes)' : 'soft (delete documents)');
  console.log('Will WIPE:       ', COLLECTIONS_TO_WIPE.join(', '));
  console.log('Will KEEP:       ', KEEP.join(', '));
  console.log('');

  const ok = await confirm(`Type "y" to proceed: `);
  if (!ok) {
    console.log('Aborted.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const existing = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  console.log('Existing collections:', existing.join(', '));

  let cleared = 0;
  let skipped = 0;
  for (const name of COLLECTIONS_TO_WIPE) {
    if (!existing.includes(name)) {
      console.log('  -', name, '(does not exist, skipping)');
      skipped++;
      continue;
    }
    if (HARD) {
      await mongoose.connection.db.collection(name).drop();
      console.log('  x', name, 'DROPPED');
    } else {
      const r = await mongoose.connection.db.collection(name).deleteMany({});
      console.log('  -', name, 'cleared', r.deletedCount, 'docs');
    }
    cleared++;
  }

  console.log('');
  console.log('Cleared:', cleared, ' Skipped:', skipped);
  console.log('Done. You can now log into the admin and add real catalog data.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
