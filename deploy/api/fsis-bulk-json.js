// /api/fsis-bulk-json — bulk-load FSIS processors directly from the
// normalized JSON shape produced by our offline scraper. Accepts a JSON body:
//   { processors: [ { id, name, fsisEstNumber, inspectionType, street, city,
//                     state, zip, county, phone, lat, lng, activities, species,
//                     capabilities, grantDate, source }, ... ] }
//
// Filters out egg-only and other non-meat plants, dedups on (source, source_ref),
// and inserts into discovered_partners. Designed to be called repeatedly with
// chunks of ~500 records per call (Edge body limit is 4.5 MB).
//
// Admin only.
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

// FSIS establishment letters → species capability
//   M = red meat (cattle, hog, sheep, goat)
//   P = poultry
//   G = egg products
//   V = voluntary inspection
function speciesFromEst(en) {
  if (!en) return [];
  const u = en.toString().toUpperCase();
  const out = new Set();
  // Single est can be "M40A", "P12B", or combined "M40A-P12B"
  if (/(^|[^A-Z])M\d/.test(u)) ['beef','pork','lamb','goat'].forEach(s => out.add(s));
  if (/(^|[^A-Z])P\d/.test(u)) out.add('poultry');
  return [...out];
}

// Normalize capabilities array → species words (fallback when est-letter doesn't disambiguate)
function speciesFromCaps(caps) {
  if (!Array.isArray(caps)) return [];
  const out = new Set();
  for (const c of caps) {
    const s = String(c).toLowerCase();
    if (/cattle|beef|bovine/.test(s)) out.add('beef');
    if (/hog|swine|pork/.test(s)) out.add('pork');
    if (/sheep|lamb|ovine/.test(s)) out.add('lamb');
    if (/goat|caprine/.test(s)) out.add('goat');
    if (/bison/.test(s)) out.add('bison');
    if (/poultry|chicken|turkey/.test(s)) out.add('poultry');
  }
  return [...out];
}

async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS discovered_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    lat DOUBLE PRECISION, lng DOUBLE PRECISION,
    phone TEXT, email TEXT, website TEXT,
    species TEXT[],
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    raw_data JSONB,
    invite_status TEXT DEFAULT 'new',
    invited_by UUID,
    signed_up_user UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, source_ref)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS discovered_partners_state_idx ON discovered_partners(state)`;
  await sql`CREATE INDEX IF NOT EXISTS discovered_partners_kind_idx ON discovered_partners(kind)`;
}

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  let body;
  try { body = await req.json(); } catch { return err(400, 'invalid JSON'); }
  const records = body?.processors;
  if (!Array.isArray(records)) return err(400, 'expected { processors: [...] }');

  await ensureSchema();

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  const byState = {};
  const sample = [];

  for (const r of records) {
    try {
      const name = (r.name || '').trim();
      if (!name) { skipped++; continue; }

      // Derive species: prefer the FSIS est-number letter, fall back to capabilities
      const sp = speciesFromEst(r.fsisEstNumber).length
        ? speciesFromEst(r.fsisEstNumber)
        : speciesFromCaps(r.capabilities);

      // Filter: skip plants that don't handle our target species
      const TARGET = ['beef','pork','lamb','goat','bison','poultry'];
      if (!sp.some(s => TARGET.includes(s))) { skipped++; continue; }

      const sourceRef = (r.id || `${name}-${r.fsisEstNumber || r.zip || ''}`).slice(0, 200);
      const result = await sql`
        INSERT INTO discovered_partners (
          kind, name, address, city, state, zip, lat, lng, phone, species,
          source, source_ref, raw_data, invite_status
        ) VALUES (
          'processor',
          ${name},
          ${r.street || null},
          ${r.city || null},
          ${r.state || null},
          ${r.zip || null},
          ${r.lat || null},
          ${r.lng || null},
          ${r.phone || null},
          ${sp},
          'fsis',
          ${sourceRef},
          ${JSON.stringify({
            fsisEstNumber: r.fsisEstNumber,
            inspectionType: r.inspectionType,
            county: r.county,
            sizeTier: r.sizeTier,
            activities: r.activities,
            capabilities: r.capabilities,
            grantDate: r.grantDate,
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
          species = EXCLUDED.species,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`;

      if (result[0]?.inserted) inserted++; else updated++;
      const st = r.state || '??';
      byState[st] = (byState[st] || 0) + 1;
      if (sample.length < 5) sample.push({ name, state: r.state, est: r.fsisEstNumber });
    } catch (e) {
      skipped++;
      if (errors.length < 30) errors.push(`${r.name}: ${(e.message || '').slice(0, 100)}`);
    }
  }

  return json({
    received: records.length,
    inserted, updated, skipped,
    by_state: byState,
    errors,
    sample,
  });
}
