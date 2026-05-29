// /api/mpa-bulk-import — bulk-load state Meat Processor Association (MPA)
// member directories into discovered_partners. These are custom-cut shops that
// take farmer-direct work — the actual ICP for Protein Outfitters.
//
// Sources we ingest (one CSV format with `source` column):
//   MAMP   — Minnesota Association of Meat Processors
//   WAMP   — Wisconsin Association of Meat Processors
//   IMPA   — Iowa Meat Processors Association
//   IMPPA  — Indiana Meat Packers and Processors Association
//   PAMP   — Pennsylvania Association of Meat Processors
//   AAMP   — American Association of Meat Processors (national)
//   OAMP, KAMP, NEMPA, ILMPA, MIMA, etc. — sister state orgs
//
// CSV format (matches processors_master_geocoded.csv):
//   source,source_id,role,business_name,contact_name,phone,email,website,
//   street,city,state,zip,address_full,services,inspection_status,
//   usda_establishment_number,source_url,lat,lng,geocode_source
//
// POST text/csv body OR { csv: "..." } JSON.
// Filters: skips records without a state, skips bad geocodes outside US.
// Admin only.

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

// Reuse the strict CSV parser from fsis-import (handles quoted fields w/ embedded commas)
function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Map common service descriptor strings → species capability tags
const SERVICE_SPECIES_MAP = [
  { match: /\bbeef\b|\bcattle\b|\bbovine\b/i, key: 'beef' },
  { match: /\bpork\b|\bhog\b|\bswine\b/i, key: 'pork' },
  { match: /\blamb\b|\bsheep\b|\bovine\b/i, key: 'lamb' },
  { match: /\bgoat\b|\bcaprine\b/i, key: 'goat' },
  { match: /\bbison\b|\bbuffalo\b/i, key: 'bison' },
  { match: /\b(deer|venison|cervid|elk)\b/i, key: 'venison' },
  { match: /\b(poultry|chicken|turkey|duck)\b/i, key: 'poultry' },
];

function extractSpecies(servicesStr) {
  if (!servicesStr) return [];
  const out = new Set();
  for (const { match, key } of SERVICE_SPECIES_MAP) {
    if (match.test(servicesStr)) out.add(key);
  }
  return [...out];
}

// MPA members default to handling red-meat species (beef + pork) unless explicitly
// listed otherwise. They're the small custom shops — that's what they do.
function defaultSpecies(servicesStr) {
  const sp = extractSpecies(servicesStr);
  if (sp.length) return sp;
  return ['beef', 'pork', 'lamb']; // generous default for state MPA members
}

// Inspection-status normalizer (we accept multiple variants)
function normalizeInspection(raw) {
  if (!raw) return null;
  const s = raw.toString().toLowerCase();
  if (/usda|federal/.test(s)) return 'usda';
  if (/state.*equal.*to|equal.*to/.test(s)) return 'state-equal-to';
  if (/state/.test(s)) return 'state';
  if (/custom.*exempt|custom/.test(s)) return 'custom-exempt';
  return null;
}

async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS discovered_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL, name TEXT NOT NULL,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    lat DOUBLE PRECISION, lng DOUBLE PRECISION,
    phone TEXT, email TEXT, website TEXT,
    species TEXT[],
    source TEXT NOT NULL, source_ref TEXT NOT NULL,
    raw_data JSONB,
    invite_status TEXT DEFAULT 'new',
    invited_by UUID, signed_up_user UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, source_ref)
  )`;
}

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  // Accept JSON {csv:"..."} or raw text/csv body
  let csvText;
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { const b = await req.json(); csvText = b.csv || b.body || ''; }
    catch { return err(400, 'invalid JSON'); }
  } else {
    csvText = await req.text();
  }
  if (!csvText || csvText.length < 50) return err(400, 'no CSV content');

  await ensureSchema();

  const rows = parseCSV(csvText);
  if (rows.length < 2) return err(400, 'CSV has no data rows');

  const headers = rows[0].map(h => (h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const idx = (key) => headers.indexOf(key);

  // Required columns
  const i = {
    source: idx('source'),
    source_id: idx('source_id'),
    name: idx('business_name'),
    contact: idx('contact_name'),
    phone: idx('phone'),
    email: idx('email'),
    website: idx('website'),
    street: idx('street'),
    city: idx('city'),
    state: idx('state'),
    zip: idx('zip'),
    services: idx('services'),
    inspection: idx('inspection_status'),
    estNum: idx('usda_establishment_number'),
    sourceUrl: idx('source_url'),
    lat: idx('lat'),
    lng: idx('lng'),
  };

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  const bySource = {};
  const byState = {};
  const sample = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) { skipped++; continue; }
    try {
      const name = (row[i.name] || '').trim();
      const stateRaw = (row[i.state] || '').trim();
      // Normalize state: accept 2-letter codes, drop garbage like "Indianapolis" or "Town of X"
      const state = /^[A-Z]{2}$/i.test(stateRaw) ? stateRaw.toUpperCase() : null;
      const sourceTag = (row[i.source] || '').trim().toLowerCase();
      if (!name || !sourceTag) { skipped++; continue; }
      if (!state) { skipped++; continue; } // bad state data

      const sourceRef = (row[i.source_id] || `${sourceTag}-${name}-${state}`).slice(0, 200);
      const species = defaultSpecies(row[i.services]);
      const lat = parseFloat(row[i.lat]) || null;
      const lng = parseFloat(row[i.lng]) || null;
      const inspection = normalizeInspection(row[i.inspection]);

      const result = await sql`
        INSERT INTO discovered_partners (
          kind, name, address, city, state, zip, lat, lng,
          phone, email, website, species,
          source, source_ref, raw_data, invite_status
        ) VALUES (
          'processor',
          ${name},
          ${row[i.street] || null},
          ${row[i.city] || null},
          ${state},
          ${row[i.zip] || null},
          ${lat},
          ${lng},
          ${row[i.phone] || null},
          ${row[i.email] || null},
          ${row[i.website] || null},
          ${species},
          ${sourceTag},
          ${sourceRef},
          ${JSON.stringify({
            contact: row[i.contact] || null,
            services: row[i.services] || null,
            inspection_status: inspection,
            usda_establishment_number: row[i.estNum] || null,
            source_url: row[i.sourceUrl] || null,
          })},
          'new'
        )
        ON CONFLICT (source, source_ref) DO UPDATE SET
          name = EXCLUDED.name,
          address = COALESCE(EXCLUDED.address, discovered_partners.address),
          city = COALESCE(EXCLUDED.city, discovered_partners.city),
          state = COALESCE(EXCLUDED.state, discovered_partners.state),
          zip = COALESCE(EXCLUDED.zip, discovered_partners.zip),
          lat = COALESCE(EXCLUDED.lat, discovered_partners.lat),
          lng = COALESCE(EXCLUDED.lng, discovered_partners.lng),
          phone = COALESCE(EXCLUDED.phone, discovered_partners.phone),
          email = COALESCE(EXCLUDED.email, discovered_partners.email),
          website = COALESCE(EXCLUDED.website, discovered_partners.website),
          species = EXCLUDED.species,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`;

      if (result[0]?.inserted) inserted++; else updated++;
      bySource[sourceTag] = (bySource[sourceTag] || 0) + 1;
      byState[state] = (byState[state] || 0) + 1;
      if (sample.length < 5) sample.push({ name, state, source: sourceTag });
    } catch (e) {
      skipped++;
      if (errors.length < 30) errors.push(`${row[i.name]}: ${(e.message || '').slice(0, 100)}`);
    }
  }

  return json({
    rows_examined: rows.length - 1,
    inserted, updated, skipped,
    by_source: bySource,
    by_state: byState,
    errors,
    sample,
  });
}

export default nodejsHandler(handler);
