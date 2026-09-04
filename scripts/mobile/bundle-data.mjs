#!/usr/bin/env node
/**
 * Refresh the offline processor bundle shipped inside the mobile app.
 *
 * Source of truth in this repo: supabase/seed/processors.bundled.json
 * (the same file scripts/seed-supabase.mjs loads into Postgres).
 * Destination: mobile/src/data/processors.bundled.json — imported at build
 * time so the map renders on first launch with no network.
 *
 * Filters out rows without lat/lng (can't render on the map). Idempotent.
 *
 *   npm run mobile:bundle-data
 */
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SRC = resolve(ROOT, 'supabase', 'seed', 'processors.bundled.json');
const DST = resolve(ROOT, 'mobile', 'src', 'data', 'processors.bundled.json');

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const all = Array.isArray(raw) ? raw : Object.values(raw)[0];

const valid = all.filter(
  r =>
    typeof r.lat === 'number' &&
    typeof r.lng === 'number' &&
    !Number.isNaN(r.lat) &&
    !Number.isNaN(r.lng),
);

mkdirSync(dirname(DST), { recursive: true });
writeFileSync(DST, JSON.stringify(valid));
const size = statSync(DST).size;

console.log(`Source records: ${all.length}`);
console.log(`Filtered (no geo): ${all.length - valid.length}`);
console.log(`Bundled: ${valid.length}`);
console.log(`Output size: ${(size / 1024).toFixed(1)} KB`);
console.log(`→ ${DST.replace(ROOT + '/', '')}`);
