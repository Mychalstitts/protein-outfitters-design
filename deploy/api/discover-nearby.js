// /api/discover-nearby — Google Places search for farms + processors near a location
//   GET ?zip=56601&kind=farm|processor&radius=80&species=beef
//   GET ?lat=...&lng=...&kind=...
// Returns candidate partners and (best-effort) inserts them into discovered_partners.
//
// Uses Places API (New) — set GOOGLE_MAPS_KEY in Vercel.
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };
export const maxDuration = 30;

// 8-second client-side timeout on every Google upstream call.
// Without this, Places-API stalls just hang the whole serverless function
// until Vercel's 10-second cold-start cap kills it (run-13/14 timeouts).
const UPSTREAM_TIMEOUT_MS = 8000;
async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// 8-second client-side timeout on every Google upstream call.
// Without this, Places-API stalls just hang the whole serverless function
// until Vercel's 10-second cold-start cap kills it (run-13/14 timeouts).
const UPSTREAM_TIMEOUT_MS = 8000;
async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

const QUERIES = {
  farm: {
    beef:    ['cattle ranch', 'beef farm', 'grass-fed beef'],
    pork:    ['hog farm', 'heritage pork farm'],
    lamb:    ['lamb farm', 'sheep ranch'],
    goat:    ['goat farm'],
    bison:   ['bison ranch'],
    venison: ['deer farm', 'elk ranch', 'venison farm'],
    poultry: ['pasture-raised poultry farm']
  },
  processor: {
    any: ['meat processor', 'butcher shop', 'USDA meat processing plant', 'custom meat processing']
  }
};

async function geocodeZip(zip, key) {
  const r = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip + ', USA')}&key=${key}`);
  const data = await r.json();
  if (data.status !== 'OK' || !data.results?.[0]) return null;
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

async function placesTextSearch(query, lat, lng, radiusMeters, key) {
  // Places API (New) — Text Search
  const body = {
    textQuery: query,
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
    maxResultCount: 20,
    includedType: undefined,
  };
  const r = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.nationalPhoneNumber,places.websiteUri,places.shortFormattedAddress,places.addressComponents'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Places API ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.places || [];
}

function extractStateZip(addressComponents = []) {
  let state, zip;
  for (const c of addressComponents) {
    if ((c.types || []).includes('administrative_area_level_1')) state = c.shortText || c.short_name;
    if ((c.types || []).includes('postal_code')) zip = c.longText || c.long_name;
  }
  return { state, zip };
}

export default async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return err(500, 'GOOGLE_MAPS_KEY not configured');

  const u = new URL(req.url, 'https://www.proteinoutfitters.com');
  const zip = u.searchParams.get('zip');
  const kind = u.searchParams.get('kind') || 'farm';
  const species = u.searchParams.get('species') || (kind === 'processor' ? 'any' : 'beef');
  const radius = Math.min(80, Math.max(5, parseInt(u.searchParams.get('radius') || '50'))) * 1609.34; // miles → meters
  let lat = parseFloat(u.searchParams.get('lat'));
  let lng = parseFloat(u.searchParams.get('lng'));
  const persist = u.searchParams.get('persist') !== 'false'; // default: insert into DB

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!zip) return err(400, 'Provide either zip OR lat+lng');
    const geo = await geocodeZip(zip, key);
    if (!geo) return err(400, `Could not geocode ZIP ${zip}`);
    lat = geo.lat; lng = geo.lng;
  }

  const queries = (QUERIES[kind] || {})[species] || (QUERIES[kind] || {}).any || ['meat producer'];

  // Run all queries in parallel, dedupe by Google place id
  const results = new Map();
  const errors = [];
  await Promise.all(queries.map(async (q) => {
    try {
      const rows = await placesTextSearch(q, lat, lng, radius, key);
      for (const p of rows) {
        if (!results.has(p.id)) results.set(p.id, { ...p, _matchedQuery: q });
      }
    } catch (e) { errors.push(e.message); }
  }));

  const candidates = Array.from(results.values()).map(p => {
    const { state, zip: zip2 } = extractStateZip(p.addressComponents);
    return {
      place_id: p.id,
      name: p.displayName?.text || 'Unknown',
      address: p.shortFormattedAddress || p.formattedAddress,
      city: null,
      state,
      zip: zip2,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      phone: p.nationalPhoneNumber || null,
      website: p.websiteUri || null,
      types: p.types || [],
      matched_query: p._matchedQuery
    };
  });

  // Best-effort: insert/update into discovered_partners table
  let inserted = 0;
  if (persist && candidates.length) {
    for (const c of candidates) {
      try {
        await sql`
          INSERT INTO discovered_partners (kind, name, address, state, zip, lat, lng, phone, website, species, source, source_ref, raw_data)
          VALUES (
            ${kind}, ${c.name}, ${c.address}, ${c.state}, ${c.zip},
            ${c.lat}, ${c.lng}, ${c.phone}, ${c.website},
            ${[species]}, 'places', ${c.place_id}, ${JSON.stringify(c)}
          )
          ON CONFLICT (source, source_ref) DO UPDATE
            SET name = EXCLUDED.name,
                address = EXCLUDED.address,
                phone = COALESCE(EXCLUDED.phone, discovered_partners.phone),
                website = COALESCE(EXCLUDED.website, discovered_partners.website),
                updated_at = NOW()`;
        inserted++;
      } catch (e) { /* keep going */ }
    }
  }

  return json({
    center: { lat, lng },
    kind, species, radius_miles: Math.round(radius / 1609.34),
    candidates,
    persisted: inserted,
    errors
  });
}
