// scripts/db-bootstrap.mjs — apply the full database schema (and optionally the
// demo seed) to the database pointed at by DATABASE_URL, using the exact same
// idempotent statements the production /api/migrate endpoint runs.
//
// Usage:
//   DATABASE_URL=postgres://po:po@127.0.0.1:5432/protein_outfitters \
//     node scripts/db-bootstrap.mjs [--seed]
//
// Idempotent: every statement is CREATE ... IF NOT EXISTS / ALTER ... IF NOT
// EXISTS / ON CONFLICT DO NOTHING, so it is safe to run repeatedly.

import { SCHEMA_STATEMENTS, SEED_SQL } from '../deploy/api/migrate.js';
import { rawQuery, sql } from '../deploy/api/_lib/db.js';

const withSeed = process.argv.includes('--seed');

let ran = 0;
let failed = 0;

for (const stmt of SCHEMA_STATEMENTS) {
  try {
    await rawQuery(stmt);
    ran++;
  } catch (e) {
    failed++;
    console.error(`✗ ${stmt.slice(0, 90).replace(/\s+/g, ' ')} :: ${String(e.message || e).slice(0, 160)}`);
  }
}
console.log(`schema: ${ran} statements applied, ${failed} failed`);

if (withSeed) {
  let seeded = 0;
  for (const stmt of SEED_SQL) {
    try {
      await rawQuery(stmt);
      seeded++;
    } catch (e) {
      console.error(`seed ✗ ${String(e.message || e).slice(0, 160)}`);
    }
  }
  console.log(`seed: ${seeded}/${SEED_SQL.length} statements applied`);
}

await sql.end({ timeout: 5 });
process.exit(failed > 0 ? 1 : 0);
