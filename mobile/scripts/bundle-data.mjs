#!/usr/bin/env node
/**
 * Bundle the source processors.json into the mobile app, filtering out
 * records that can't render on the map (missing lat/lng).
 *
 * Run after the data pipeline produces a new processors.json. Idempotent.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', '..', 'data', 'processors.json');
const DST = resolve(
  __dirname,
  '..',
  'apps',
  'mobile',
  'src',
  'data',
  'processors.bundled.json',
);

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const all = Array.isArray(raw) ? raw : Object.values(raw)[0];

const valid = all.filter(
  r =>
    typeof r.lat === 'number' &&
    typeof r.lng === 'number' &&
    !Number.isNaN(r.lat) &&
    !Number.isNaN(r.lng),
);

const dropped = all.length - valid.length;

writeFileSync(DST, JSON.stringify(valid));
const size = statSync(DST).size;

console.log(`Source records:    ${all.length}`);
console.log(`Filtered (no geo): ${dropped}`);
console.log(`Bundled:           ${valid.length}`);
console.log(`Output size:       ${(size / 1024).toFixed(1)} KB`);
console.log(`→ ${DST.replace(resolve(__dirname, '..') + '/', '')}`);
