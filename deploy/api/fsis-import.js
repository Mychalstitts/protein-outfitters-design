// /api/fsis-import — bulk-load USDA FSIS Meat & Poultry Inspection Directory
//   POST text/csv body OR { csv: "..." } JSON
//   Filters for federally-inspected plants that handle our target species
//   (cattle, hogs, sheep, goats, bison, cervidae) and inserts them into
//   discovered_partners with source='fsis'.
//
// Source: download the XLSX from
//   https://www.fsis.usda.gov/inspection/establishments/meat-poultry-and-egg-product-inspection-directory
// Open in Excel/Numbers/Sheets, Save As → CSV, then upload here.
//
// Auth: admin session.
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

// Lazy schema bootstrap — runs once per cold start, idempotent.
// Lets the import work even if the main /api/migrate hasn't been run.
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
  await sql`CREATE INDEX IF NOT EXISTS discovered_partners_status_idx ON discovered_partners(invite_status)`;
}

// Strict CSV parser (handles quoted fields, escaped quotes, embedded commas/newlines)
function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else { cur += c; }
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Normalize a column header so different FSIS export variants map to one canonical key.
function normalizeHeader(h) {
  const k = (h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const map = {
    establishment_number: 'establishment_number',
    estab_no: 'establishment_number',
    establishment_no: 'establishment_number',
    establishment_id: 'establishment_number',
    establishment_name: 'name',
    company_name: 'name',
    name: 'name',
    dba_name: 'dba',
    dba: 'dba',
    mailing_address: 'address',
    address: 'address',
    physical_address: 'address',
    street: 'address',
    mailing_city: 'city',
    city: 'city',
    mailing_state: 'state',
    state: 'state',
    mailing_zip_code: 'zip',
    zip_code: 'zip',
    zip: 'zip',
    mailing_phone: 'phone',
    phone: 'phone',
    phone_number: 'phone',
    activities: 'activities',
    activity: 'activities',
    inspection_type: 'inspection_type',
    grant_inspection_type: 'inspection_type',
    species: 'species',
    species_inspected: 'species',
    federally_inspected_plant: 'federal',
    federal_inspection: 'federal',
    federally_inspected: 'federal',
    email: 'email',
    email_address: 'email',
    website: 'website',
    web_site: 'website',
  };
  return map[k] || k;
}

// Species patterns we care about (Protein Outfitters ICP)
const TARGET_SPECIES = [
  { match: /cattle|beef|bovine/i, key: 'beef' },
  { match: /hog|swine|pork|porcine/i, key: 'pork' },
  { match: /sheep|lamb|ovine/i, key: 'lamb' },
  { match: /goat|caprine/i, key: 'goat' },
  { match: /bison|buffalo/i, key: 'bison' },
  { match: /cervid|deer|elk|reindeer/i, key: 'venison' },
  { match: /rabbit/i, key: 'rabbit' },
  { match: /poultry|chicken|turkey|duck|goose|game_bird/i, key: 'poultry' },
];

function speciesMatch(speciesStr) {
  if (!speciesStr) return [];
  const matched = [];
  for (const { match, key } of TARGET_SPECIES) {
    if (match.test(speciesStr)) matched.push(key);
  }
  return matched;
}

// FSIS establishment numbers encode species: M = meat (red meat), P = poultry, E = egg, V = voluntary.
// When the source CSV lacks a species column we fall back to inferring from the est. number.
function inferSpeciesFromEstNumber(en) {
  if (!en) return [];
  const u = en.toString().toUpperCase().trim();
  // Some entries are "M40-A", "P12-B", "M40-A,P12-B" (combined meat+poultry plant), or "EST. 12345"
  const meat = /(^|[\s,;])M\s*\.?\s*\d|^EST\s*\.?\s*\d/i.test(u);
  const poultry = /(^|[\s,;])P\s*\.?\s*\d/i.test(u);
  const out = [];
  if (meat) out.push('beef', 'pork', 'lamb', 'goat'); // red-meat plant — capable of all four
  if (poultry) out.push('poultry');
  return out;
}

function looksFederal(row) {
  // FSIS plants in this directory are federally inspected by definition,
  // BUT the directory also lists state-inspected ones with a flag column.
  const flag = (row.federal || '').toString().toLowerCase().trim();
  if (flag === 'n' || flag === 'no' || flag === 'false') return false;
  // Establishment numbers like "M40-A" / "P12-B" / "EST. 12345" are federal
  const en = (row.establishment_number || '').toString().toUpperCase();
  if (/^(M|P|EST)\s*\.?\s*\d/i.test(en)) return true;
  // Default: trust the row unless explicitly state-only
  return true;
}

function activitiesMatch(actStr) {
  if (!actStr) return false;
  return /slaughter|processing|cut|wrap|grind/i.test(actStr);
}

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'admin') return err(403, 'Admin only');

  try { await ensureSchema(); } catch (e) { return err(500, `Schema bootstrap failed: ${e.message}`); }

  // Accept text/csv body OR { csv: "..." } JSON OR { url: "..." } JSON (server fetch)
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  let csvText = '';
  if (ct.includes('text/csv') || ct.includes('text/plain')) {
    csvText = await req.text();
  } else {
    try {
      const body = await req.json();
      if (body.url) {
        // Server-side fetch (sidesteps CORS + browser truncation). Allow USDA hosts only.
        const u = new URL(body.url);
        if (!/^(www\.)?(fsis\.usda\.gov|usdalocalfoodportal\.com|ams\.usda\.gov)$/i.test(u.hostname)) {
          return err(400, 'URL must point to a USDA host (fsis.usda.gov, usdalocalfoodportal.com, ams.usda.gov)');
        }
        const r = await fetch(u.toString(), {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ProteinOutfittersBot/1.0; +https://www.proteinoutfitters.com)',
            'Accept': 'text/csv,application/csv,text/plain;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (!r.ok) return err(502, `Upstream fetch failed: HTTP ${r.status}`);
        csvText = await r.text();
      } else {
        csvText = body.csv || '';
      }
    } catch (e) {
      return err(400, 'Send CSV as text/csv body, JSON {csv:"..."}, or JSON {url:"https://..."}');
    }
  }
  if (!csvText || csvText.length < 100) return err(400, 'CSV too short or empty');

  const rows = parseCSV(csvText);
  if (rows.length < 2) return err(400, 'CSV must have a header row + data rows');

  const headers = rows[0].map(normalizeHeader);
  const dataRows = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  }).filter(r => r.name); // drop blank rows

  const filtered = dataRows
    .filter(r => looksFederal(r))
    .filter(r => activitiesMatch(r.activities))
    .map(r => {
      // Prefer explicit species column; fall back to inferring from establishment number prefix.
      let sp = speciesMatch(r.species);
      if (sp.length === 0) sp = inferSpeciesFromEstNumber(r.establishment_number);
      return { ...r, _species: sp };
    })
    .filter(r => r._species.length > 0); // must handle at least one target species

  // Optional offset/limit so the client can chunk through a large dataset.
  // Lets us stay under the 25s edge-runtime initial-response limit.
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = parseInt(url.searchParams.get('limit') || '0', 10);
  const slice = limit > 0 ? filtered.slice(offset, offset + limit) : filtered;

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];

  async function upsertOne(r) {
    try {
      const sourceRef = (r.establishment_number || `${r.name}|${r.zip}`).toUpperCase();
      const phone = r.phone ? r.phone.replace(/[^\d]/g, '').slice(0, 11) : null;
      const phoneFmt = phone && phone.length >= 10
        ? `(${phone.slice(-10, -7)}) ${phone.slice(-7, -4)}-${phone.slice(-4)}`
        : (r.phone || null);

      const result = await sql`
        INSERT INTO discovered_partners (
          kind, name, address, city, state, zip,
          phone, email, website, species,
          source, source_ref, raw_data, invite_status
        ) VALUES (
          'processor',
          ${r.name},
          ${r.address || null},
          ${r.city || null},
          ${(r.state || '').toUpperCase().slice(0, 2) || null},
          ${(r.zip || '').slice(0, 10) || null},
          ${phoneFmt},
          ${r.email || null},
          ${r.website || null},
          ${r._species},
          'fsis',
          ${sourceRef},
          ${JSON.stringify({ activities: r.activities, inspection: r.inspection_type, fsis_species: r.species, dba: r.dba })},
          'new'
        )
        ON CONFLICT (source, source_ref) DO UPDATE SET
          name = EXCLUDED.name,
          address = COALESCE(EXCLUDED.address, discovered_partners.address),
          city = COALESCE(EXCLUDED.city, discovered_partners.city),
          state = COALESCE(EXCLUDED.state, discovered_partners.state),
          zip = COALESCE(EXCLUDED.zip, discovered_partners.zip),
          phone = COALESCE(EXCLUDED.phone, discovered_partners.phone),
          species = EXCLUDED.species,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`;

      if (result[0]?.inserted) inserted++;
      else updated++;
    } catch (e) {
      skipped++;
      if (errors.length < 20) errors.push(`${r.name}: ${e.message}`);
    }
  }

  // Parallel inserts in chunks of 25 — keeps the Neon HTTP pool happy
  // and finishes ~5,000 rows in well under 25s.
  const CHUNK = 25;
  for (let i = 0; i < slice.length; i += CHUNK) {
    await Promise.all(slice.slice(i, i + CHUNK).map(upsertOne));
  }

  // Summary stats per state
  const byState = {};
  for (const r of filtered) {
    const s = (r.state || '??').toUpperCase().slice(0, 2);
    byState[s] = (byState[s] || 0) + 1;
  }

  return json({
    received_rows: dataRows.length,
    matched_rows: filtered.length,
    processed_in_this_call: slice.length,
    offset,
    has_more: limit > 0 && (offset + slice.length) < filtered.length,
    next_offset: offset + slice.length,
    inserted,
    updated,
    skipped,
    by_state: byState,
    errors,
    sample: filtered.slice(0, 3).map(r => ({ name: r.name, state: r.state, species: r._species }))
  });
}

export default nodejsHandler(handler);
