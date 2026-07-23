// /api/admin-hotspots — hardware opportunity hotspot map data (admin only).
//
//   GET ?radius_miles=50&max_hotspots=25        → radius-cluster hotspots
//   GET ?scope=nationwide                       → state-level ranking
//   GET ?layers=population,livestock,...        → which signals feed the score
//         (any of: population, livestock, farms, buyers, reservations;
//          default = all). Lets the map show pure population density, pure
//          farm/livestock density, platform-only activity, etc.
//   GET ?capacity=all|platform|non_registry|none → what counts as competition
//         all          every geocoded processor (default)
//         platform     PO member processors only (owner_id set)
//         non_registry exclude association-registry sweep imports — some of
//                      those plants aren't real competition for PO's model
//         none         ignore capacity entirely (pure density view)
//
// A hotspot is a market area where DEMAND and ANIMAL SUPPLY are both present
// but processing capacity is thin — the prime target markets for PO hardware:
// a processor who buys hardware in a hotspot inherits built-in demand.
//
// Scoring blends live platform activity with county-level market data
// (imported via /api/admin-county-stats):
//   demand  = buyers ×1 + reservations ×3            (platform, geocoded)
//           + √(county population within area)/100    (market potential)
//   supply  = farms ×2 + active listings ×1           (platform)
//           + √(county livestock head within area)/100 (animal availability,
//             USDA NASS: cattle + hogs + sheep + goats)
//   score   = √(demand × supply) / (1 + processors within area)
// The geometric mean means an area needs BOTH demand and supply to rank.
// Capacity counts every geocoded processor in the DB — platform members,
// FSIS/MPA imports, and association-registry imports alike.
//
// `heat` output drives the Snap-style gradient: every point's intensity is
// its weight divided by (1 + processors nearby), so the map burns darkest
// red where demand stacks up with nobody to process it.

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { geocode } from './_lib/geocode.js';

export const config = { runtime: 'nodejs' };

// Weights — platform signals
const W_BUYER = 1;
const W_RESERVATION = 3;
const W_FARM = 2;
const W_LISTING = 1;
// Market-data scaling: √(value)/DIVISOR keeps big metros/herds from drowning
// out everything else. 1M people → 10 pts; 250k head → 5 pts.
const POP_DIVISOR = 100;
const LIVESTOCK_DIVISOR = 100;
const MAX_FRESH_GEOCODES = 8;

const RADIUS_CHOICES = [25, 50, 100, 200, 500];

function distanceMi(aLat, aLng, bLat, bLng) {
  const R = 3959;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const la1 = aLat * Math.PI / 180, la2 = bLat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function loadPoints() {
  const totals = {
    buyers: 0, buyers_geocoded: 0, reservations: 0,
    farms: 0, farms_geocoded: 0, listings: 0,
    processors: 0, processors_geocoded: 0, hardware_leads: 0,
    counties: 0, population: 0, livestock_head: 0,
  };
  const demand = [];   // { lat, lng, weight, label, state, counts }
  const supply = [];
  const capacity = []; // { lat, lng, state }

  // ── Supply: farms weighted by active listings ────────────────
  const farms = await sql`
    SELECT f.id, f.name, f.city, f.state, f.lat, f.lng,
           (SELECT COUNT(*)::int FROM listings l WHERE l.farm_id = f.id AND l.status = 'active') AS listings_count
    FROM farms f`;
  const farmById = {};
  for (const f of farms) {
    totals.farms++;
    totals.listings += f.listings_count;
    farmById[f.id] = f;
    if (f.lat == null || f.lng == null) continue;
    totals.farms_geocoded++;
    supply.push({
      lat: f.lat, lng: f.lng,
      weight: W_FARM + W_LISTING * f.listings_count,
      label: f.city ? `${f.city}, ${f.state || ''}`.replace(/, $/, '') : null,
      state: f.state || null,
      layer: 'farms',
      counts: { farms: 1, listings: f.listings_count },
    });
  }

  // ── Demand: active reservations, located at the reserved farm ─
  const reservations = await sql`
    SELECT r.id, l.farm_id
    FROM reservations r
    JOIN listings l ON l.id = r.listing_id
    WHERE r.status NOT IN ('cancelled','refunded')`;
  for (const r of reservations) {
    totals.reservations++;
    const f = farmById[r.farm_id];
    if (!f || f.lat == null || f.lng == null) continue;
    demand.push({
      lat: f.lat, lng: f.lng,
      weight: W_RESERVATION,
      label: f.city ? `${f.city}, ${f.state || ''}`.replace(/, $/, '') : null,
      state: f.state || null,
      layer: 'reservations',
      counts: { reservations: 1 },
    });
  }

  // ── Demand: buyers geocoded from profile zip (cache-first) ────
  const buyers = await sql`
    SELECT id, zip FROM users
    WHERE role = 'buyer' AND zip IS NOT NULL AND zip <> ''`;
  let freshLookups = 0;
  for (const b of buyers) {
    totals.buyers++;
    const zip = String(b.zip).trim().slice(0, 5);
    if (!/^\d{5}$/.test(zip)) continue;
    const cached = await sql`
      SELECT lat, lng FROM geocode_cache WHERE query_key = ${zip} LIMIT 1`;
    let g = cached[0] || null;
    if (!g && freshLookups < MAX_FRESH_GEOCODES) {
      freshLookups++;
      g = await geocode({ zip }).catch(() => null);
    }
    if (!g) continue;
    totals.buyers_geocoded++;
    demand.push({ lat: g.lat, lng: g.lng, weight: W_BUYER, label: null, state: null, layer: 'buyers', counts: { buyers: 1 } });
  }

  // ── Market data: county population + livestock ────────────────
  let countyRows = [];
  try {
    countyRows = await sql`
      SELECT fips, name, state, lat, lng, population, cattle, hogs, sheep, goats
      FROM county_stats WHERE lat IS NOT NULL AND lng IS NOT NULL`;
  } catch { /* table not created yet — platform-only scoring */ }
  for (const c of countyRows) {
    totals.counties++;
    const pop = c.population || 0;
    const head = (c.cattle || 0) + (c.hogs || 0) + (c.sheep || 0) + (c.goats || 0);
    totals.population += pop;
    totals.livestock_head += head;
    const label = c.name ? `${c.name} County, ${c.state}` : null;
    if (pop > 0) {
      demand.push({
        lat: c.lat, lng: c.lng,
        weight: Math.sqrt(pop) / POP_DIVISOR,
        label, state: c.state,
        layer: 'population',
        counts: { population: pop },
      });
    }
    if (head > 0) {
      supply.push({
        lat: c.lat, lng: c.lng,
        weight: Math.sqrt(head) / LIVESTOCK_DIVISOR,
        label, state: c.state,
        layer: 'livestock',
        counts: { livestock: head },
      });
    }
  }

  // ── Capacity: every geocoded processor ────────────────────────
  const processors = await sql`
    SELECT id, state, lat, lng, owner_id,
           (bio ILIKE 'Imported from assoc%') AS from_registry
    FROM processors`;
  for (const p of processors) {
    totals.processors++;
    if (p.lat == null || p.lng == null) continue;
    totals.processors_geocoded++;
    capacity.push({
      lat: p.lat, lng: p.lng, state: p.state || null,
      platform: p.owner_id != null,
      from_registry: Boolean(p.from_registry),
    });
  }

  try {
    const hw = await sql`SELECT COUNT(*)::int AS c FROM hardware_leads`;
    totals.hardware_leads = hw[0]?.c || 0;
  } catch { /* optional table */ }

  return { demand, supply, capacity, totals };
}

const EMPTY_METRICS = () => ({
  buyers: 0, reservations: 0, farms: 0, listings: 0, population: 0, livestock: 0,
});

function accumulate(metrics, counts) {
  for (const k in counts) metrics[k] += counts[k];
}

// score two sides into one raw value. When both demand and supply layers are
// selected, geometric mean (both required). When the lens is one-sided —
// e.g. pure population density or pure farm density — score on the sum so
// the map still ranks areas instead of zeroing out.
function rawScore(demandScore, supplyScore, requireBoth) {
  return requireBoth ? Math.sqrt(demandScore * supplyScore) : demandScore + supplyScore;
}

// Score one point against the full point sets within radius. Used for every
// grid candidate and for zip-centered focus analysis.
function scoreAt(lat, lng, radiusMiles, demand, supply, capacity) {
  const metrics = EMPTY_METRICS();
  let demandScore = 0, supplyScore = 0, capacityCount = 0;
  const labels = new Map();
  for (const p of demand) {
    if (distanceMi(lat, lng, p.lat, p.lng) <= radiusMiles) {
      demandScore += p.weight;
      accumulate(metrics, p.counts);
      if (p.label) labels.set(p.label, (labels.get(p.label) || 0) + p.weight);
    }
  }
  for (const p of supply) {
    if (distanceMi(lat, lng, p.lat, p.lng) <= radiusMiles) {
      supplyScore += p.weight;
      accumulate(metrics, p.counts);
      if (p.label) labels.set(p.label, (labels.get(p.label) || 0) + p.weight);
    }
  }
  let nearestProcessor = Infinity;
  for (const p of capacity) {
    const d = distanceMi(lat, lng, p.lat, p.lng);
    if (d <= radiusMiles) capacityCount++;
    if (d < nearestProcessor) nearestProcessor = d;
  }
  let label = null, best = 0;
  for (const [k, v] of labels) if (v > best) { best = v; label = k; }
  return {
    label,
    demand_score: Math.round(demandScore * 10) / 10,
    supply_score: Math.round(supplyScore * 10) / 10,
    capacity_count: capacityCount,
    nearest_processor_miles: nearestProcessor === Infinity ? null : Math.round(nearestProcessor),
    metrics,
    _demand: demandScore, _supply: supplyScore,
  };
}

// ── Radius-cluster hotspots ────────────────────────────────────
function computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots, requireBoth) {
  const activity = demand.concat(supply);
  if (!activity.length) return [];

  const cellDeg = Math.max(radiusMiles / 2, 10) / 69;
  const bins = new Map();
  for (const p of activity) {
    const key = `${Math.floor(p.lat / cellDeg)}:${Math.floor(p.lng / cellDeg)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(p);
  }
  const candidates = [];
  for (const pts of bins.values()) {
    const w = pts.reduce((s, p) => s + p.weight, 0);
    candidates.push({
      lat: pts.reduce((s, p) => s + p.lat * p.weight, 0) / w,
      lng: pts.reduce((s, p) => s + p.lng * p.weight, 0) / w,
    });
  }

  const scored = [];
  for (const c of candidates) {
    const s = scoreAt(c.lat, c.lng, radiusMiles, demand, supply, capacity);
    const raw = rawScore(s._demand, s._supply, requireBoth);
    if (raw <= 0) continue;
    scored.push({
      lat: Math.round(c.lat * 1e5) / 1e5,
      lng: Math.round(c.lng * 1e5) / 1e5,
      label: s.label,
      demand_score: s.demand_score,
      supply_score: s.supply_score,
      capacity_count: s.capacity_count,
      nearest_processor_miles: s.nearest_processor_miles,
      metrics: s.metrics,
      _score: raw / (1 + s.capacity_count),
    });
  }

  scored.sort((a, b) => b._score - a._score);
  const kept = [];
  for (const cand of scored) {
    if (kept.every(k => distanceMi(cand.lat, cand.lng, k.lat, k.lng) > radiusMiles)) {
      kept.push(cand);
    }
    if (kept.length >= maxHotspots) break;
  }
  return finalize(kept);
}

// ── Nationwide: rank whole states ──────────────────────────────
function computeStateRanking(demand, supply, capacity, maxHotspots, requireBoth) {
  const states = new Map(); // state → agg
  const get = (st) => {
    if (!states.has(st)) {
      states.set(st, {
        demand: 0, supply: 0, cap: 0, metrics: EMPTY_METRICS(),
        latW: 0, lngW: 0, w: 0,
      });
    }
    return states.get(st);
  };
  for (const p of demand) {
    if (!p.state) continue;
    const s = get(p.state);
    s.demand += p.weight; accumulate(s.metrics, p.counts);
    s.latW += p.lat * p.weight; s.lngW += p.lng * p.weight; s.w += p.weight;
  }
  for (const p of supply) {
    if (!p.state) continue;
    const s = get(p.state);
    s.supply += p.weight; accumulate(s.metrics, p.counts);
    s.latW += p.lat * p.weight; s.lngW += p.lng * p.weight; s.w += p.weight;
  }
  for (const p of capacity) {
    if (!p.state) continue;
    get(p.state).cap++;
  }

  const scored = [];
  for (const [st, s] of states) {
    const raw = rawScore(s.demand, s.supply, requireBoth);
    if (raw <= 0 || !s.w) continue;
    scored.push({
      lat: Math.round((s.latW / s.w) * 1e5) / 1e5,
      lng: Math.round((s.lngW / s.w) * 1e5) / 1e5,
      label: st,
      demand_score: Math.round(s.demand * 10) / 10,
      supply_score: Math.round(s.supply * 10) / 10,
      capacity_count: s.cap,
      nearest_processor_miles: null,
      metrics: s.metrics,
      _score: raw / (1 + s.cap),
    });
  }
  scored.sort((a, b) => b._score - a._score);
  return finalize(scored.slice(0, maxHotspots));
}

function finalize(kept) {
  const top = kept.length ? kept[0]._score : 0;
  kept.forEach((h, i) => {
    h.rank = i + 1;
    h.opportunity_score = Math.round((top ? 100 * h._score / top : 0) * 10) / 10;
    delete h._score;
  });
  return { hotspots: kept, top };
}

// ── Snap-style heat points ─────────────────────────────────────
function buildHeat(demand, supply, capacity, radiusMiles) {
  const pts = [];
  let max = 0;
  const push = (p, scale) => {
    let capNear = 0;
    for (const c of capacity) {
      if (distanceMi(p.lat, p.lng, c.lat, c.lng) <= radiusMiles) capNear++;
    }
    const intensity = (p.weight * scale) / (1 + capNear);
    if (intensity <= 0) return;
    if (intensity > max) max = intensity;
    pts.push([p.lat, p.lng, intensity]);
  };
  for (const p of demand) push(p, 1);
  for (const p of supply) push(p, 0.5);
  if (!max) return [];
  return pts
    .map(([lat, lng, i]) => [
      Math.round(lat * 1e5) / 1e5,
      Math.round(lng * 1e5) / 1e5,
      Math.round((i / max) * 1000) / 1000,
    ])
    .filter(p => p[2] > 0); // drop sub-0.001 points — invisible on the gradient anyway
}

async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const user = await currentUser(req).catch(() => null);
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'admin') return err(403, 'Admin only');

  const url = new URL(req.url, 'https://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const scope = url.searchParams.get('scope') === 'nationwide' ? 'nationwide' : 'radius';
  let radiusMiles = Number(url.searchParams.get('radius_miles')) || 50;
  if (!RADIUS_CHOICES.includes(radiusMiles)) {
    radiusMiles = Math.max(10, Math.min(radiusMiles, 500));
  }
  const maxHotspots = Math.max(1, Math.min(Number(url.searchParams.get('max_hotspots')) || 25, 100));

  // Layer + competition filters
  const ALL_LAYERS = ['population', 'livestock', 'farms', 'buyers', 'reservations'];
  const DEMAND_LAYERS = new Set(['population', 'buyers', 'reservations']);
  const SUPPLY_LAYERS = new Set(['livestock', 'farms']);
  const layersParam = (url.searchParams.get('layers') || '').split(',').map(s => s.trim()).filter(Boolean);
  const layers = new Set(layersParam.filter(l => ALL_LAYERS.includes(l)));
  if (!layers.size) ALL_LAYERS.forEach(l => layers.add(l));
  const capacityMode = ['all', 'platform', 'non_registry', 'none'].includes(url.searchParams.get('capacity'))
    ? url.searchParams.get('capacity') : 'all';

  try {
    const loaded = await loadPoints();
    const demand = loaded.demand.filter(p => layers.has(p.layer));
    const supply = loaded.supply.filter(p => layers.has(p.layer));
    let capacity = loaded.capacity;
    if (capacityMode === 'platform') capacity = capacity.filter(p => p.platform);
    else if (capacityMode === 'non_registry') capacity = capacity.filter(p => !p.from_registry);
    else if (capacityMode === 'none') capacity = [];
    const totals = { ...loaded.totals, processors_counted: capacity.length };

    // One-sided lenses (pure population / pure farm density) score on the
    // selected side alone instead of requiring both.
    const requireBoth = [...layers].some(l => DEMAND_LAYERS.has(l))
                     && [...layers].some(l => SUPPLY_LAYERS.has(l));

    const { hotspots, top } = scope === 'nationwide'
      ? computeStateRanking(demand, supply, capacity, Math.max(maxHotspots, 51), requireBoth)
      : computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots, requireBoth);

    // Zip-centered focus: score a market area centered exactly on the given
    // zip, comparable to the ranked list (normalized against the same top).
    let focus = null;
    const centerZip = (url.searchParams.get('center') || '').trim().slice(0, 5);
    if (/^\d{5}$/.test(centerZip)) {
      const g = await geocode({ zip: centerZip }).catch(() => null);
      if (g) {
        const fRadius = scope === 'nationwide' ? 100 : radiusMiles;
        const s = scoreAt(g.lat, g.lng, fRadius, demand, supply, capacity);
        const raw = rawScore(s._demand, s._supply, requireBoth);
        const fScore = raw / (1 + s.capacity_count);
        const denom = Math.max(top, fScore) || 1;
        focus = {
          zip: centerZip,
          lat: Math.round(g.lat * 1e5) / 1e5,
          lng: Math.round(g.lng * 1e5) / 1e5,
          radius_miles: fRadius,
          label: s.label,
          opportunity_score: Math.round((100 * fScore / denom) * 10) / 10,
          demand_score: s.demand_score,
          supply_score: s.supply_score,
          capacity_count: s.capacity_count,
          nearest_processor_miles: s.nearest_processor_miles,
          metrics: s.metrics,
        };
      } else {
        focus = { zip: centerZip, error: 'Could not locate that zip code' };
      }
    }

    // Heat damping radius: for nationwide use 100mi so the gradient still
    // reads locally rather than one state-sized blob.
    const heat = buildHeat(demand, supply, capacity, scope === 'nationwide' ? 100 : radiusMiles);
    return json({
      scope,
      radius_miles: scope === 'nationwide' ? null : radiusMiles,
      layers: [...layers],
      capacity_mode: capacityMode,
      focus,
      hotspots, heat, totals,
    });
  } catch (e) {
    return err(500, 'admin-hotspots failed: ' + (e.message || 'unknown').slice(0, 200));
  }
}

export default nodejsHandler(handler);
