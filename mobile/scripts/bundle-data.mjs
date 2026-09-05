#!/usr/bin/env node
/**
 * Bundle processors into the Expo app for offline first launch.
 *
 * Design-repo source of truth: ../../supabase/seed/processors.bundled.json
 * (same file seed-supabase loads into Postgres). Falls back to legacy
 * ../../data/processors.json if present (app-repo layout).
 *
 *   npm run bundle:data   # from mobile/
 */

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = resolve(__dirname, '..');
const DESIGN_ROOT = resolve(MOBILE_ROOT, '..');

const CANDIDATES = [
  resolve(DESIGN_ROOT, 'supabase', 'seed', 'processors.bundled.json'),
  resolve(DESIGN_ROOT, 'data', 'processors.json'),
];
const SRC = CANDIDATES.find((p) => existsSync(p));
if (!SRC) {
  console.error(
    'No processors source found. Expected one of:\n' +
      CANDIDATES.map((p) => `  ${p}`).join('\n'),
  );
  process.exit(1);
}

const DST = resolve(
  MOBILE_ROOT,
  'apps',
  'mobile',
  'src',
  'data',
  'processors.bundled.json',
);

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const all = Array.isArray(raw) ? raw : Object.values(raw)[0];

const valid = all.filter(
  (r) =>
    typeof r.lat === 'number' &&
    typeof r.lng === 'number' &&
    !Number.isNaN(r.lat) &&
    !Number.isNaN(r.lng),
);

mkdirSync(dirname(DST), { recursive: true });
writeFileSync(DST, JSON.stringify(valid));
const size = statSync(DST).size;

console.log(`Source:            ${SRC.replace(DESIGN_ROOT + '/', '')}`);
console.log(`Source records:    ${all.length}`);
console.log(`Filtered (no geo): ${all.length - valid.length}`);
console.log(`Bundled:           ${valid.length}`);
console.log(`Output size:       ${(size / 1024).toFixed(1)} KB`);
console.log(`→ ${DST.replace(MOBILE_ROOT + '/', 'mobile/')}`);
