// /api/ams-import — bulk-load USDA AMS Local Food Directory listings
//   POST text/csv body OR { csv: "..." } JSON
//   Filters for farms that produce meat (beef, pork, lamb, goat, bison, venison, poultry, eggs)
//   and inserts them into discovered_partners with source='ams'.
//
// Source: download a CSV from the USDA AMS Local Food Portal:
//   https://www.usdalocalfoodportal.com/  (CSA, On-Farm Markets, Farmers Markets, Food Hubs)
//   The portal exposes "Export to CSV" on each directory.
//
// Auth: any signed-in user during early ops. Tighten to admin role later.
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

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

// Normalize a column header so different AMS directory exports map to one canonical key.
function normalizeHeader(h) {
  const k = (h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const map = {
    listing_id: 'source_ref',
    id: 'source_ref',
    listing_name: 'name',
    market_name: 'name',
    farm_name: 'name',
    business_name: 'name',
    name: 'name',
    location_address: 'address',
    address: 'address',
    location_street: 'address',
    street: 'address',
    location_city: 'city',
    city: 'city',
    location_state: 'state',
    state: 'state',
    location_zipcode: 'zip',
    location_zip: 'zip',
    zipcode: 'zip',
    zip_code: 'zip',
    zip: 'zip',
    contact_email: 'email',
    email: 'email',
    contact_phone: 'phone',
    phone: 'phone',
    media_website: 'website',
    website: 'website',
    location_x: 'lng',
    longitude: 'lng',
    location_y: 'lat',
    latitude: 'lat',
    products: 'products',
    product_list: 'products',
    food_products: 'products',
    listing_categories: 'categories',
    categories: 'categories',
    type: 'kind_hint',
    listing_type: 'kind_hint',
  };
  return map[k] || k;
}

// Species patterns we care about — Protein Outfitters ICP (farm side)
const TARGET_SPECIES = [
  { match: /\bbeef\b|\bcattle\b|\bbovine\b/i, key: 'beef' },
  { match: /\bpork\b|\bhog\b|\bswine\b|\bpig\b/i, key: 'pork' },
  { match: /\blamb\b|\bsheep\b|\bovine\b|\bmutton\b/i, key: 'lamb' },
  { match: /\bgoat\b|\bcaprine\b|\bchevon\b/i, key: 'goat' },
  { match: /\bbison\b|\bbuffalo\b/i, key: 'bison' },
  { match: /\bvenison\b|\bdeer\b|\belk\b|\bcervid/i, key: 'venison' },
  { match: /\brabbit\b/i, key: 'rabbit' },
  { match: /\bpoultry\b|\bchicken\b|\bturkey\b|\bduck\b|\bgoose\b/i, key: 'poultry' },
  { match: /\beggs?\b/i, key: 'eggs' },
];

function speciesMatch(text) {
  if (!text) return [];
  const matched = [];
  for (const { match, key } of TARGET_SPECIES) {
    if (match.test(text)) matched.push(key);
  }
  return matched;
}

// AMS directories use a "type" column we can use to distinguish CSA vs on-farm market vs farmers market
function inferKind(row) {
  const hint = (row.kind_hint || '').toLowerCase();
  if (/csa|community.?supported/i.test(hint)) return 'farm';
  if (/on.?farm/i.test(hint)) return 'farm';
  if (/farmers?.?market/i.test(hint)) return 'market';
  if (/food.?hub|hub/i.test(hint)) return 'hub';
  // Default: treat as farm — most AMS listings are farms
  return 'farm';
}

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

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
        const u = new URL(body.url);
        if (!/^(www\.)?(usdalocalfoodportal\.com|ams\.usda\.gov|fsis\.usda\.gov)$/i.test(u.hostname)) {
          return err(400, 'URL must point to a USDA host (usdalocalfoodportal.com, ams.usda.gov, fsis.usda.gov)');
        }
        const r = await fetch(u.toString(), { redirect: 'follow' });
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

  // Filter: must mention at least one target species in products or categories
  const filtered = dataRows
    .map(r => {
      const blob = `${r.products || ''} ${r.categories || ''} ${r.name || ''}`;
      return { ...r, _species: speciesMatch(blob), _kind: inferKind(r) };
    })
    .filter(r => r._species.length > 0)
    // Skip non-meat filters (eggs-only is fine, that's still livestock)
    .filter(r => !(r._species.length === 1 && r._species[0] === 'poultry' && /produce|vegetable|fruit/i.test(r.products || '')));

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const r of filtered) {
    try {
      const sourceRef = (r.source_ref || `${r.name}|${r.zip}`).toString().toUpperCase();
      const phone = r.phone ? r.phone.replace(/[^\d]/g, '').slice(0, 11) : null;
      const phoneFmt = phone && phone.length >= 10
        ? `(${phone.slice(-10, -7)}) ${phone.slice(-7, -4)}-${phone.slice(-4)}`
        : (r.phone || null);

      const lat = r.lat ? parseFloat(r.lat) : null;
      const lng = r.lng ? parseFloat(r.lng) : null;

      const result = await sql`
        INSERT INTO discovered_partners (
          kind, name, address, city, state, zip,
          lat, lng, phone, email, website, species,
          source, source_ref, raw_data, invite_status
        ) VALUES (
          ${r._kind},
          ${r.name},
          ${r.address || null},
          ${r.city || null},
          ${(r.state || '').toUpperCase().slice(0, 2) || null},
          ${(r.zip || '').slice(0, 10) || null},
          ${Number.isFinite(lat) ? lat : null},
          ${Number.isFinite(lng) ? lng : null},
          ${phoneFmt},
          ${r.email || null},
          ${r.website || null},
          ${r._species},
          'ams',
          ${sourceRef},
          ${JSON.stringify({ products: r.products, categories: r.categories, kind_hint: r.kind_hint })},
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

      if (result[0]?.inserted) inserted++;
      else updated++;
    } catch (e) {
      skipped++;
      if (errors.length < 20) errors.push(`${r.name}: ${e.message}`);
    }
  }

  // Summary stats per state
  const byState = {};
  for (const r of filtered) {
    const s = (r.state || '??').toUpperCase().slice(0, 2);
    byState[s] = (byState[s] || 0) + 1;
  }

  // Summary stats per species
  const bySpecies = {};
  for (const r of filtered) {
    for (const sp of r._species) {
      bySpecies[sp] = (bySpecies[sp] || 0) + 1;
    }
  }

  return json({
    received_rows: dataRows.length,
    matched_rows: filtered.length,
    inserted,
    updated,
    skipped,
    by_state: byState,
    by_species: bySpecies,
    errors,
    sample: filtered.slice(0, 3).map(r => ({ name: r.name, state: r.state, species: r._species }))
  });
}
