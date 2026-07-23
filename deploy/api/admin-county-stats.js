// /api/admin-county-stats — data backbone for the hardware hotspot map (admin only).
//
// Imports and reports the county-level market data that the hotspot scoring
// blends with live platform activity:
//   - population + population density per US county (Census TIGERweb + ACS)
//   - livestock inventory per county (USDA NASS Quick Stats, 2022 Census of Ag)
//   - association/state-registry processors (bulk import into the processors
//     table so real-world capacity is counted whether or not they're on PO)
//
// Actions (dispatch on ?action=):
//   GET  ?action=status                          → row counts + coverage
//   POST ?action=import-census                   → all ~3,200 counties: centroid,
//         land area (TIGERweb REST) + population (ACS 5-year). No API key.
//   POST ?action=import-nass&state=XX            → county livestock inventory for
//         one state (cattle, hogs, sheep, goats). Requires NASS_API_KEY env var
//         (free: https://quickstats.nass.usda.gov/api). One state per call so
//         each request stays well inside the serverless time budget.
//   POST ?action=import-association-processors   → JSON body {processors:[{name,
//         city,state,phone,website,source}]}. Inserts into processors, deduped
//         case-insensitively on (name, state) against existing rows.
//   POST ?action=geocode-processors              → geocode up to 200 processors
//         missing lat/lng (cache-first Nominatim via _lib/geocode).

import zlib from 'zlib';
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { backfillEntity } from './_lib/geocode.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const NASS = 'https://quickstats.nass.usda.gov/api/api_GET/';
const SQ_M_PER_SQ_MI = 2589988.11;

// The TIGERweb Counties layer carries state as a FIPS code (no STUSAB field).
const FIPS_TO_STATE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC',
  '12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY',
  '22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT',
  '31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH',
  '40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT',
  '50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY','60':'AS','66':'GU','69':'MP',
  '72':'PR','78':'VI',
};

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS county_stats (
      fips        TEXT PRIMARY KEY,
      name        TEXT,
      state       TEXT,
      lat         DOUBLE PRECISION,
      lng         DOUBLE PRECISION,
      land_sq_mi  DOUBLE PRECISION,
      population  INT,
      pop_density DOUBLE PRECISION,
      cattle      INT,
      hogs        INT,
      sheep       INT,
      goats       INT,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS county_stats_state_idx ON county_stats(state)`;
}

async function fetchJson(url, label) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'Accept': 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${label} HTTP ${r.status}: ${text.slice(0, 120)}`);
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${label} returned non-JSON: ${text.slice(0, 120)}`); }
  // ArcGIS reports errors inside a 200 response.
  if (data && data.error) throw new Error(`${label} error: ${JSON.stringify(data.error).slice(0, 160)}`);
  return data;
}

// ── Census: county centroids + land area + population ────────
//
// Uses Census Bureau STATIC FILES (www2.census.gov) — the api.census.gov
// data API now requires an API key even for light use, but the published
// Gazetteer (centroids/land area) and Population Estimates Program CSV
// need no key at all.
const GAZETTEER_ZIP = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip';
const PEP_CSV = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv';
// Population-WEIGHTED county centers (where people actually live), so heat
// and hotspot markers land on the metro, not the geometric middle of the
// county (e.g. LA County's weighted center is downtown LA; its geometric
// center is in the Angeles National Forest).
const CENPOP_CSV = 'https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO.txt';

async function fetchBuffer(url, label) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${label} HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Minimal ZIP extraction (first entry) via the End Of Central Directory
// record — enough for single-file Census gazetteer archives.
function unzipFirstEntry(buf) {
  // EOCD signature 0x06054b50, scan from the end (comment can pad it).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: EOCD not found');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('ZIP: bad central directory');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  const extraLen = buf.readUInt16LE(cdOffset + 30);
  const commentLen = buf.readUInt16LE(cdOffset + 32);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  void nameLen; void extraLen; void commentLen;
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP: bad local header');
  const lNameLen = buf.readUInt16LE(localOffset + 26);
  const lExtraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + lNameLen + lExtraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
  throw new Error(`ZIP: unsupported compression method ${method}`);
}

// Split one CSV line respecting double quotes.
function csvSplit(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function importCensus() {
  await ensureTable();

  // 1) Gazetteer ZIP → tab-separated county rows with centroid + land area.
  const counties = {}; // fips → row
  const gazTxt = unzipFirstEntry(await fetchBuffer(GAZETTEER_ZIP, 'Gazetteer'));
  const gazLines = gazTxt.split('\n');
  const gazHdr = gazLines[0].replace(/^﻿/, '').split('\t').map(s => s.trim());
  const gi = Object.fromEntries(gazHdr.map((h, i) => [h, i]));
  for (const line of gazLines.slice(1)) {
    const p = line.split('\t').map(s => s.trim());
    if (p.length < gazHdr.length) continue;
    const fips = p[gi.GEOID];
    if (!fips) continue;
    counties[fips] = {
      fips,
      name: (p[gi.NAME] || '').replace(/ (County|Parish|Borough|Census Area)$/, ''),
      state: p[gi.USPS] || '',
      lat: parseFloat(p[gi.INTPTLAT]),
      lng: parseFloat(p[gi.INTPTLONG]),
      land_sq_mi: p[gi.ALAND] ? Number(p[gi.ALAND]) / SQ_M_PER_SQ_MI : null,
    };
  }

  // 2) Population-weighted centers override the geometric internal points
  //    wherever available (CT's redrawn planning regions fall back to the
  //    gazetteer point).
  let weighted = 0;
  try {
    const cenLines = (await fetchBuffer(CENPOP_CSV, 'CenPop')).toString('latin1').split('\n');
    const cenHdr = csvSplit(cenLines[0]).map(s => s.trim());
    const ci = Object.fromEntries(cenHdr.map((h, i) => [h, i]));
    for (const line of cenLines.slice(1)) {
      const p = csvSplit(line);
      if (p.length < cenHdr.length) continue;
      const fips = p[ci.STATEFP].padStart(2, '0') + p[ci.COUNTYFP].padStart(3, '0');
      const row = counties[fips];
      if (!row) continue;
      const lat = parseFloat(p[ci.LATITUDE]);
      const lng = parseFloat(p[ci.LONGITUDE]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        row.lat = lat; row.lng = lng; weighted++;
      }
    }
  } catch { /* fall back to gazetteer internal points */ }

  // 3) PEP county population estimates CSV (latin-1 for accented names).
  const pepBuf = await fetchBuffer(PEP_CSV, 'PEP');
  const pepLines = pepBuf.toString('latin1').split('\n');
  const pepHdr = csvSplit(pepLines[0]).map(s => s.trim());
  const pi = Object.fromEntries(pepHdr.map((h, i) => [h, i]));
  const popCol = pepHdr.filter(h => /^POPESTIMATE\d{4}$/.test(h)).sort().pop();
  if (!popCol) throw new Error('PEP: no POPESTIMATE column found');
  let matched = 0;
  for (const line of pepLines.slice(1)) {
    const p = csvSplit(line);
    if (p.length < pepHdr.length) continue;
    if (p[pi.COUNTY] === '000') continue; // state totals
    const fips = p[pi.STATE].padStart(2, '0') + p[pi.COUNTY].padStart(3, '0');
    const row = counties[fips];
    if (!row) continue;
    row.population = parseInt(p[pi[popCol]], 10) || 0;
    row.pop_density = row.land_sq_mi ? row.population / row.land_sq_mi : null;
    matched++;
  }

  // 4) Chunked upsert.
  const all = Object.values(counties).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500).map(c => ({
      fips: c.fips, name: c.name, state: c.state, lat: c.lat, lng: c.lng,
      land_sq_mi: c.land_sq_mi ?? null,
      population: c.population ?? null,
      pop_density: c.pop_density ?? null,
    }));
    await sql`
      INSERT INTO county_stats ${sql(chunk, 'fips', 'name', 'state', 'lat', 'lng', 'land_sq_mi', 'population', 'pop_density')}
      ON CONFLICT (fips) DO UPDATE SET
        name = EXCLUDED.name, state = EXCLUDED.state,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        land_sq_mi = EXCLUDED.land_sq_mi,
        population = EXCLUDED.population,
        pop_density = EXCLUDED.pop_density,
        updated_at = NOW()`;
  }
  return { counties: all.length, population_matched: matched, population_weighted_centers: weighted };
}

// ── NASS: county livestock inventory for one state ───────────
const NASS_SPECIES = [
  { col: 'cattle', commodity: 'CATTLE', short: 'CATTLE, INCL CALVES - INVENTORY' },
  { col: 'hogs',   commodity: 'HOGS',   short: 'HOGS - INVENTORY' },
  { col: 'sheep',  commodity: 'SHEEP',  short: 'SHEEP, INCL LAMBS - INVENTORY' },
  { col: 'goats',  commodity: 'GOATS',  short: 'GOATS - INVENTORY' },
];

async function importNass(stateAlpha) {
  if (!process.env.NASS_API_KEY) {
    throw Object.assign(new Error('NASS_API_KEY env var is not set. Get a free key at https://quickstats.nass.usda.gov/api and add it in Vercel → Settings → Environment Variables.'), { status: 503 });
  }
  await ensureTable();

  const byFips = {}; // fips → {cattle, hogs, ...}
  const speciesCounts = {};
  for (const sp of NASS_SPECIES) {
    const u = new URL(NASS);
    u.searchParams.set('key', process.env.NASS_API_KEY);
    u.searchParams.set('source_desc', 'CENSUS');
    u.searchParams.set('year', '2022');
    u.searchParams.set('agg_level_desc', 'COUNTY');
    u.searchParams.set('state_alpha', stateAlpha);
    u.searchParams.set('commodity_desc', sp.commodity);
    u.searchParams.set('short_desc', sp.short);
    u.searchParams.set('domain_desc', 'TOTAL');
    u.searchParams.set('format', 'JSON');
    let data;
    try {
      data = await fetchJson(u, `NASS ${sp.commodity}`);
    } catch (e) {
      // NASS returns 400 when a state has zero rows for a species — treat as empty.
      speciesCounts[sp.col] = 0;
      continue;
    }
    let n = 0;
    for (const row of data.data || []) {
      const st = row.state_fips_code, co = row.county_code;
      if (!st || !co || co === '998') continue; // 998 = "other counties" rollup
      const fips = `${st}${co}`;
      const v = parseInt(String(row.Value || '').replace(/,/g, ''), 10);
      if (!Number.isFinite(v)) continue; // "(D)" = suppressed
      byFips[fips] = byFips[fips] || {};
      byFips[fips][sp.col] = v;
      n++;
    }
    speciesCounts[sp.col] = n;
  }

  let updated = 0;
  for (const [fips, vals] of Object.entries(byFips)) {
    const r = await sql`
      UPDATE county_stats SET
        cattle = COALESCE(${vals.cattle ?? null}, cattle),
        hogs   = COALESCE(${vals.hogs ?? null}, hogs),
        sheep  = COALESCE(${vals.sheep ?? null}, sheep),
        goats  = COALESCE(${vals.goats ?? null}, goats),
        updated_at = NOW()
      WHERE fips = ${fips}`;
    updated += r.count ?? 0;
  }
  return { state: stateAlpha, counties_updated: updated, species_rows: speciesCounts };
}

// ── Bundled livestock (2022 Census of Ag, shipped in /data) ───
// One-click load with no API key: reads the site's own static bundle.
// The NASS Quick Stats API path (import-nass) stays available for
// refreshes once a NASS_API_KEY is configured.
async function importLivestockBundled(host) {
  await ensureTable();
  const bundle = await fetchJson(`https://${host}/data/county_livestock_2022.json`, 'livestock bundle');
  const entries = Object.entries(bundle.counties || {});
  if (!entries.length) throw new Error('livestock bundle is empty');
  let updated = 0;
  for (let i = 0; i < entries.length; i += 300) {
    const chunk = entries.slice(i, i + 300).map(([fips, v]) => ({
      fips, cattle: v[0] || null, hogs: v[1] || null, sheep: v[2] || null, goats: v[3] || null,
    }));
    await sql`
      INSERT INTO county_stats ${sql(chunk, 'fips', 'cattle', 'hogs', 'sheep', 'goats')}
      ON CONFLICT (fips) DO UPDATE SET
        cattle = EXCLUDED.cattle, hogs = EXCLUDED.hogs,
        sheep = EXCLUDED.sheep, goats = EXCLUDED.goats, updated_at = NOW()`;
    updated += chunk.length;
  }
  return { counties_loaded: updated, source: bundle.source || '2022 Census of Ag bundle' };
}

// ── Association processors bulk import ───────────────────────
async function importAssociationProcessors(body) {
  const incoming = (body?.processors || []).filter(p => p?.name && p?.state);
  if (!incoming.length) return { inserted: 0, skipped_duplicates: 0, received: 0 };

  const existing = await sql`SELECT LOWER(name) AS n, UPPER(COALESCE(state,'')) AS s FROM processors`;
  const seen = new Set(existing.map(r => `${r.n}|${r.s}`));

  let inserted = 0, skipped = 0;
  const toInsert = [];
  for (const p of incoming) {
    const key = `${String(p.name).toLowerCase().trim()}|${String(p.state).toUpperCase().trim()}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    toInsert.push({
      name: String(p.name).trim().slice(0, 200),
      city: p.city ? String(p.city).trim().slice(0, 100) : null,
      state: String(p.state).toUpperCase().trim().slice(0, 2),
      phone: p.phone ? String(p.phone).trim().slice(0, 40) : null,
      website: p.website ? String(p.website).trim().slice(0, 300) : null,
      bio: p.source ? `Imported from ${p.source} registry sweep` : 'Imported from association registry sweep',
    });
  }
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    await sql`INSERT INTO processors ${sql(chunk, 'name', 'city', 'state', 'phone', 'website', 'bio')}`;
    inserted += chunk.length;
  }
  return { inserted, skipped_duplicates: skipped, received: incoming.length };
}

// ── Status ───────────────────────────────────────────────────
async function status() {
  await ensureTable();
  const [c] = await sql`
    SELECT COUNT(*)::int AS counties,
           COUNT(population)::int AS with_population,
           COUNT(cattle)::int AS with_cattle,
           COALESCE(SUM(population),0)::bigint AS total_population,
           COALESCE(SUM(cattle),0) + COALESCE(SUM(hogs),0) + COALESCE(SUM(sheep),0) + COALESCE(SUM(goats),0) AS total_livestock
    FROM county_stats`;
  const [p] = await sql`
    SELECT COUNT(*)::int AS processors,
           COUNT(lat)::int AS geocoded,
           COUNT(*) FILTER (WHERE bio ILIKE 'Imported from assoc%')::int AS from_associations
    FROM processors`;
  const statesWithLivestock = await sql`
    SELECT state FROM county_stats WHERE cattle IS NOT NULL GROUP BY state ORDER BY state`;
  return {
    county_stats: { ...c, total_population: Number(c.total_population), total_livestock: Number(c.total_livestock) },
    processors: p,
    livestock_states: statesWithLivestock.map(r => r.state),
    nass_key_configured: Boolean(process.env.NASS_API_KEY),
  };
}

async function handler(req) {
  const user = await currentUser(req).catch(() => null);
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'admin') return err(403, 'Admin only');

  const url = new URL(req.url, 'https://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const action = url.searchParams.get('action') || 'status';

  try {
    if (action === 'status') return json(await status());
    if (req.method !== 'POST') return err(405, 'POST required for imports');
    if (action === 'import-census') return json(await importCensus());
    if (action === 'import-livestock') {
      const host = (req.headers?.get ? req.headers.get('host') : null) || 'www.proteinoutfitters.com';
      return json(await importLivestockBundled(host));
    }
    if (action === 'import-nass') {
      const state = (url.searchParams.get('state') || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(state)) return err(400, 'Pass ?state=XX (two-letter state code)');
      return json(await importNass(state));
    }
    if (action === 'import-association-processors') {
      const body = await req.json().catch(() => null);
      return json(await importAssociationProcessors(body));
    }
    if (action === 'geocode-processors') {
      return json(await backfillEntity('processors'));
    }
    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    return err(e.status || 500, `admin-county-stats ${action} failed: ` + (e.message || 'unknown').slice(0, 300));
  }
}

export default nodejsHandler(handler);
