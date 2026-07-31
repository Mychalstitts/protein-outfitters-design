// Geocoding helper — resolves "city, state, zip" → { lat, lng } using
// Nominatim (OpenStreetMap, free, no API key required). Aggressively cached
// in geocode_cache so we never re-hit Nominatim for the same query.
//
// Nominatim usage policy: max 1 req/sec, must include a User-Agent. We add
// a 1.1s delay between requests when we know we're calling fresh. For a
// platform-scale geocoding job, this should run as a backfill job, not on
// the request path. /api/map-data uses cache-first reads.
//
// Centroids fallback — if Nominatim fails (rate limit, network), we try
// the bundled MIDWEST_CENTROIDS table (city-level lat/lng for the upper
// Midwest service area). Better to plot the wrong county than nothing.

import { sql } from './db.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'ProteinOutfitters/1.0 (hello@proteinoutfitters.com)';

// Coarse city-level fallback covering the upper Midwest service area.
// Sourced from public US Census TIGER + GeoNames data, abbreviated to top
// cities each state. If Nominatim is unreachable, we degrade to these.
const MIDWEST_CENTROIDS = {
  // MN
  'bemidji,mn':            [47.4736, -94.8803],
  'bagley,mn':             [47.5236, -95.3986],
  'minneapolis,mn':        [44.9778, -93.2650],
  'st paul,mn':            [44.9537, -93.0900],
  'rochester,mn':          [44.0121, -92.4802],
  'duluth,mn':             [46.7867, -92.1005],
  'st cloud,mn':           [45.5579, -94.1632],
  'mankato,mn':            [44.1636, -93.9994],
  'moorhead,mn':           [46.8739, -96.7678],
  'fergus falls,mn':       [46.2830, -96.0775],
  'park rapids,mn':        [46.9221, -95.0586],
  'detroit lakes,mn':      [46.8172, -95.8453],
  'thief river falls,mn':  [48.1191, -96.1812],
  'crookston,mn':          [47.7741, -96.6080],
  'hibbing,mn':            [47.4271, -92.9376],
  'grand rapids,mn':       [47.2371, -93.5302],
  'brainerd,mn':           [46.3580, -94.2008],
  'wadena,mn':             [46.4422, -95.1339],
  // ND
  'fargo,nd':              [46.8772, -96.7898],
  'bismarck,nd':           [46.8083, -100.7837],
  'grand forks,nd':        [47.9253, -97.0329],
  'minot,nd':              [48.2330, -101.2960],
  'dickinson,nd':          [46.8792, -102.7896],
  'jamestown,nd':          [46.9105, -98.7084],
  'williston,nd':          [48.1470, -103.6180],
  'wahpeton,nd':           [46.2655, -96.6059],
  // SD
  'sioux falls,sd':        [43.5446, -96.7311],
  'rapid city,sd':         [44.0805, -103.2310],
  'aberdeen,sd':           [45.4647, -98.4865],
  'brookings,sd':          [44.3114, -96.7984],
  'watertown,sd':          [44.8997, -97.1142],
  'mitchell,sd':           [43.7094, -98.0298],
  'pierre,sd':             [44.3683, -100.3510],
  // WI
  'milwaukee,wi':          [43.0389, -87.9065],
  'madison,wi':            [43.0731, -89.4012],
  'green bay,wi':          [44.5133, -88.0133],
  'kenosha,wi':            [42.5847, -87.8212],
  'racine,wi':             [42.7261, -87.7829],
  'appleton,wi':           [44.2619, -88.4154],
  'eau claire,wi':         [44.8113, -91.4985],
  'oshkosh,wi':            [44.0247, -88.5426],
  'janesville,wi':         [42.6828, -89.0187],
  'la crosse,wi':          [43.8014, -91.2396],
  'wausau,wi':             [44.9591, -89.6301],
  'superior,wi':           [46.7208, -92.1041],
  // IA
  'des moines,ia':         [41.5868, -93.6250],
  'cedar rapids,ia':       [41.9779, -91.6656],
  'davenport,ia':          [41.5236, -90.5776],
  'sioux city,ia':         [42.5000, -96.4003],
  'iowa city,ia':          [41.6611, -91.5302],
  'waterloo,ia':           [42.4928, -92.3426],
  'council bluffs,ia':     [41.2619, -95.8608],
  'ames,ia':               [42.0308, -93.6319],
  'dubuque,ia':            [42.5006, -90.6646],
  // MT
  'billings,mt':           [45.7833, -108.5007],
  'missoula,mt':           [46.8721, -113.9940],
  'great falls,mt':        [47.5052, -111.3008],
  'bozeman,mt':            [45.6770, -111.0429],
  'butte,mt':              [46.0038, -112.5348],
  'helena,mt':             [46.5891, -112.0391],
  // MI
  'detroit,mi':            [42.3314, -83.0458],
  'grand rapids,mi':       [42.9634, -85.6681],
  'lansing,mi':            [42.7325, -84.5555],
  'ann arbor,mi':          [42.2808, -83.7430],
  'flint,mi':              [43.0125, -83.6875],
  'kalamazoo,mi':          [42.2917, -85.5872],
  'traverse city,mi':      [44.7631, -85.6206],
  'marquette,mi':          [46.5436, -87.3954],
  // NE
  'omaha,ne':              [41.2565, -95.9345],
  'lincoln,ne':            [40.8136, -96.7026],
  'grand island,ne':       [40.9264, -98.3420],
  'kearney,ne':            [40.6993, -99.0817],
  'norfolk,ne':            [42.0287, -97.4170],
  'north platte,ne':       [41.1239, -100.7654],
  'scottsbluff,ne':        [41.8666, -103.6672],
};

// State centroids — last-resort fallback when we can't resolve a city.
// Full US coverage so nationwide farm creates still land on the map.
const STATE_CENTROIDS = {
  al: [32.8067, -86.7911], ak: [61.3707, -152.4044], az: [33.7298, -111.4312],
  ar: [34.9697, -92.3731], ca: [36.1162, -119.6816], co: [39.0598, -105.3111],
  ct: [41.5978, -72.7554], de: [39.3185, -75.5071], fl: [27.7663, -81.6868],
  ga: [33.0406, -83.6431], hi: [21.0943, -157.4983], id: [44.2405, -114.4788],
  il: [40.3495, -88.9861], in: [39.8494, -86.2583], ia: [42.0115, -93.2105],
  ks: [38.5266, -96.7265], ky: [37.6681, -84.6701], la: [31.1695, -91.8678],
  me: [44.6939, -69.3819], md: [39.0639, -76.8021], ma: [42.2302, -71.5301],
  mi: [43.3266, -84.5361], mn: [45.6945, -93.9002], ms: [32.7416, -89.6787],
  mo: [38.4561, -92.2884], mt: [46.9219, -110.4544], ne: [41.1254, -98.2681],
  nv: [38.3135, -117.0554], nh: [43.4525, -71.5639], nj: [40.2989, -74.5210],
  nm: [34.8405, -106.2485], ny: [42.1657, -74.9481], nc: [35.6301, -79.8064],
  nd: [47.5289, -99.7840], oh: [40.3888, -82.7649], ok: [35.5653, -96.9289],
  or: [44.5720, -122.0709], pa: [40.5908, -77.2098], ri: [41.6809, -71.5118],
  sc: [33.8569, -80.9450], sd: [44.2998, -99.4388], tn: [35.7478, -86.6923],
  tx: [31.0545, -97.5635], ut: [40.1500, -111.8624], vt: [44.0459, -72.7107],
  va: [37.7693, -78.1700], wa: [47.4009, -121.4905], wv: [38.4912, -80.9545],
  wi: [44.2685, -89.6165], wy: [42.75597, -107.3025], dc: [38.9072, -77.0369],
};

function normalizeKey(city, state, zip) {
  return [city, state, zip].filter(Boolean).join(',').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function ensureCache() {
  await sql`
    CREATE TABLE IF NOT EXISTS geocode_cache (
      query_key  TEXT PRIMARY KEY,
      lat        DOUBLE PRECISION NOT NULL,
      lng        DOUBLE PRECISION NOT NULL,
      display    TEXT,
      source     TEXT NOT NULL DEFAULT 'nominatim',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function fromCache(key) {
  const rows = await sql`SELECT lat, lng, display FROM geocode_cache WHERE query_key = ${key} LIMIT 1`;
  return rows[0] || null;
}

async function writeCache(key, lat, lng, display, source) {
  await sql`
    INSERT INTO geocode_cache (query_key, lat, lng, display, source)
    VALUES (${key}, ${lat}, ${lng}, ${display || null}, ${source})
    ON CONFLICT (query_key) DO NOTHING`;
}

function fromMidwest(city, state) {
  if (!city || !state) return null;
  const k = `${city.toLowerCase().trim()},${state.toLowerCase().trim()}`;
  const c = MIDWEST_CENTROIDS[k];
  return c ? { lat: c[0], lng: c[1] } : null;
}

function fromState(state) {
  if (!state) return null;
  const c = STATE_CENTROIDS[state.toLowerCase().trim()];
  return c ? { lat: c[0], lng: c[1] } : null;
}

async function fromNominatim(city, state, zip) {
  const q = [city, state, zip, 'USA'].filter(Boolean).join(', ');
  if (!q) return null;
  try {
    const url = new URL(NOMINATIM_BASE);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'us');
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.[0]) return null;
    const item = data[0];
    return {
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      display: item.display_name,
    };
  } catch { return null; }
}

/**
 * Resolve a US-style address to lat/lng.
 * Cache-first → Nominatim → Midwest centroids → state centroid → null.
 */
export async function geocode({ city, state, zip }) {
  const key = normalizeKey(city, state, zip);
  if (!key) return null;

  await ensureCache().catch(() => {});

  const cached = await fromCache(key).catch(() => null);
  if (cached) return { lat: cached.lat, lng: cached.lng, source: 'cache' };

  const live = await fromNominatim(city, state, zip);
  if (live) {
    await writeCache(key, live.lat, live.lng, live.display, 'nominatim').catch(() => {});
    return { ...live, source: 'nominatim' };
  }

  const midwest = fromMidwest(city, state);
  if (midwest) {
    await writeCache(key, midwest.lat, midwest.lng, `${city}, ${state}`, 'midwest_centroid').catch(() => {});
    return { ...midwest, source: 'midwest_centroid' };
  }

  const stateCentroid = fromState(state);
  if (stateCentroid) {
    await writeCache(key, stateCentroid.lat, stateCentroid.lng, `${state} centroid`, 'state_centroid').catch(() => {});
    return { ...stateCentroid, source: 'state_centroid' };
  }

  return null;
}

/** Backfill geocoding for any farms/processors missing lat/lng.
 *
 * Time-budgeted: stops cleanly ~35s in and reports partial progress, instead
 * of being killed mid-batch by the serverless timeout. Adds a small delay
 * between fresh Nominatim lookups (cache hits skip it) to respect the
 * 1 req/sec upstream policy — hammering it just produces failures.
 */
export async function backfillEntity(table) {
  if (!['farms', 'processors'].includes(table)) throw new Error('Invalid table');
  // Fetch rows missing coords. Using string interpolation safe because table is whitelisted.
  const rows = table === 'farms'
    ? await sql`SELECT id, city, state, zip FROM farms WHERE lat IS NULL OR lng IS NULL LIMIT 200`
    : await sql`SELECT id, city, state, zip FROM processors WHERE lat IS NULL OR lng IS NULL LIMIT 200`;
  const deadline = Date.now() + 35000;
  let resolved = 0;
  let failed = 0;
  let scanned = 0;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    scanned++;
    const t0 = Date.now();
    const r = await geocode({ city: row.city, state: row.state, zip: row.zip });
    const wasFresh = Date.now() - t0 > 300; // cache hits return in a few ms
    if (!r) { failed++; }
    else {
      if (table === 'farms') {
        await sql`UPDATE farms SET lat = ${r.lat}, lng = ${r.lng} WHERE id = ${row.id}`;
      } else {
        await sql`UPDATE processors SET lat = ${r.lat}, lng = ${r.lng} WHERE id = ${row.id}`;
      }
      resolved++;
    }
    if (wasFresh) await new Promise(res => setTimeout(res, 1100));
  }
  return { table, scanned, remaining_in_batch: rows.length - scanned, resolved, failed };
}

/**
 * Pure synchronous geocoding — no network, no DB. Uses the bundled Midwest
 * centroid table first, then state centroids. Returns null if neither hits.
 *
 * Used on the request path of /api/map-data so we never time out on Nominatim.
 * The async geocode() runs in the backfill job and writes the cache for
 * Nominatim-resolved rows.
 */
export function geocodeSync({ city, state }) {
  if (!city && !state) return null;
  const midwest = fromMidwest(city, state);
  if (midwest) return { ...midwest, source: 'midwest_centroid' };
  const stateCentroid = fromState(state);
  if (stateCentroid) return { ...stateCentroid, source: 'state_centroid' };
  return null;
}

export { MIDWEST_CENTROIDS, STATE_CENTROIDS };
