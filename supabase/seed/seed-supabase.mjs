#!/usr/bin/env node
/**
 * Seed processors from the existing data/processors.json into Supabase.
 *
 * Usage:
 *   1. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in app/.env
 *   2. From the app/ directory: node scripts/seed-supabase.mjs
 *
 * Idempotent — PostgREST upsert via Prefer: resolution=merge-duplicates,
 * on_conflict=id. You can re-run this safely.
 *
 * Why fetch and not @supabase/supabase-js: the SDK initializes RealtimeClient
 * on construction, which requires a native WebSocket implementation only
 * available in Node 22+. Direct PostgREST works on any Node 18+ and removes
 * one dependency from the seed path.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROCESSORS_JSON = join(__dirname, '..', '..', 'data', 'processors.json');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill them in.',
  );
  process.exit(1);
}

const ENDPOINT = `${url.replace(/\/$/, '')}/rest/v1/processors?on_conflict=id`;
const HEADERS = {
  apikey: key,
  authorization: `Bearer ${key}`,
  'content-type': 'application/json',
  prefer: 'resolution=merge-duplicates,return=minimal',
};

async function upsertBatch(rows) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
  }
}

async function main() {
  console.log(`Reading ${PROCESSORS_JSON}…`);
  const raw = JSON.parse(await readFile(PROCESSORS_JSON, 'utf8'));
  // The source JSON wraps the array under a single top-level key
  const records = Array.isArray(raw) ? raw : Object.values(raw)[0];
  // Skip rows without coordinates — schema requires lat/lng NOT NULL because
  // the PostGIS location column is generated from them. Un-geocoded rows can
  // be added later via a follow-up geocode pass.
  const total = records.length;
  const geocoded = records.filter(r => r.lat != null && r.lng != null);
  const dropped = total - geocoded.length;
  if (dropped > 0) {
    console.log(`Skipping ${dropped} un-geocoded row(s) (no lat/lng).`);
  }
  console.log(`Upserting ${geocoded.length} of ${total} processors in batches of 100…`);

  // Map source schema → DB columns (flatten address)
  const rows = geocoded.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    role: r.role,
    contact_name: r.contact_name,
    phone: r.phone,
    email: r.email,
    website: r.website,
    street: r.address?.street ?? null,
    city: r.address?.city ?? null,
    state: r.address?.state ?? null,
    zip: r.address?.zip ?? null,
    address_full: r.address?.full ?? null,
    lat: r.lat,
    lng: r.lng,
    geocode_source: r.geocode_source,
    services: r.services ?? [],
    inspection_status: r.inspection_status,
    usda_establishment_number: r.usda_establishment_number,
    source: r.source,
    source_url: r.source_url,
    claim_status: r.claim_status ?? 'unclaimed',
  }));

  const BATCH = 100;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    try {
      await upsertBatch(slice);
    } catch (err) {
      console.error(`\nBatch ${i}–${i + slice.length} failed:`, err.message);
      process.exit(1);
    }
    done += slice.length;
    process.stdout.write(`  ${done}/${rows.length}\r`);
  }
  console.log(`\nDone. ${done} processors loaded.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
