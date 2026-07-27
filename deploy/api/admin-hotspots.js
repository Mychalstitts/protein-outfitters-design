// /api/admin-hotspots — hardware + marketplace opportunity map (admin only).
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
// Product model: cattle (and other livestock) serving metro demand.
// City people don't organize farm-direct meat themselves — PO simplifies that.
// A hotspot is a DEMAND CENTER (metro / buyer cluster) whose haul-radius
// catchment has animal supply but thin processing. Pins sit on the city;
// ranchland raises the score without pulling the pin out of the metro.
// Same map later supports commercial demand (Whole Foods, Costco, etc.) as
// an additional demand layer — not scored yet.
//
// Scoring blends live platform activity with county-level market data
// (imported via /api/admin-county-stats):
//   demand  = buyers ×1 + reservations ×3            (at BUYER zip, not farm)
//           + √(county population within area)/100    (metro market potential)
//   supply  = farms ×2 + active listings ×1           (platform)
//           + √(county livestock head within area)/100 (cattle etc. that can
//             feed the metro — USDA NASS: cattle + hogs + sheep + goats)
//   score   = √(demand × supply) / (1 + processors within area)
// The geometric mean means a market needs BOTH people to sell to and animals
// within haul range. Capacity counts every geocoded processor in the DB.
//
// Candidates and heat are demand-centered so "sell here" means the metro
// (or the plant site that unlocks that metro), not a weight-average out in
// pasture between the city and the herd.

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { geocode } from './_lib/geocode.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

// ── PO Hardware unit economics ────────────────────────────────
// PS1: 15 head per 7-hour shift, 5 shifts/week, 52 weeks → 3,900 head/yr.
// One fed steer yields ~440 lb boneless beef (SDSU Extension); Americans eat
// ~59 lb retail beef/person/yr (USDA ERS). So one PS1's annual output covers
// the beef demand of ~29,000 people. Supply side: local cattle inventory ×
// ~38% annual marketing rate = head available to process per year.
// PS2/PS3 multiples are PLACEHOLDERS (2×/3× PS1) until real specs land.
const PS1_HEAD_PER_SHIFT = 15;
const SHIFTS_PER_WEEK = 5;
const WEEKS_PER_YEAR = 52;
const PS1_HEAD_PER_YEAR = PS1_HEAD_PER_SHIFT * SHIFTS_PER_WEEK * WEEKS_PER_YEAR; // 3,900
const BONELESS_LB_PER_HEAD = 440;
const PER_CAPITA_BEEF_LB = 59;
const PEOPLE_PER_PS1 = Math.round(PS1_HEAD_PER_YEAR * BONELESS_LB_PER_HEAD / PER_CAPITA_BEEF_LB); // ~29,085
const CATTLE_MARKETING_RATE = 0.38;   // share of standing inventory marketed per year
const EXISTING_PLANT_PS1_EQUIV = 1;   // assume each existing processor ≈ one PS1 until real throughput data exists
const PS2_MULTIPLE = 2;               // placeholder
const PS3_MULTIPLE = 3;               // placeholder

// Translate an area's population + cattle into PO hardware units.
function computeUnits(metrics, capacityCount) {
  const byPopulation = (metrics.population || 0) / PEOPLE_PER_PS1;
  const byCattle = ((metrics.cattle || 0) * CATTLE_MARKETING_RATE) / PS1_HEAD_PER_YEAR;
  const supported = Math.min(byPopulation, byCattle);
  const net = Math.max(0, supported - capacityCount * EXISTING_PLANT_PS1_EQUIV);
  const n = Math.round(net);
  let config;
  if (n <= 0) config = supported >= 1 ? 'Covered — add-on / kill-floor upgrade play' : 'Below one-unit demand';
  else {
    const parts = [];
    let left = n;
    const ps3 = Math.floor(left / PS3_MULTIPLE); if (ps3) { parts.push(`${ps3}× PS3`); left -= ps3 * PS3_MULTIPLE; }
    const ps2 = Math.floor(left / PS2_MULTIPLE); if (ps2) { parts.push(`${ps2}× PS2`); left -= ps2 * PS2_MULTIPLE; }
    if (left > 0) parts.push(`${left}× PS1`);
    config = parts.join(' + ');
  }
  return {
    ps1_by_population: Math.round(byPopulation * 10) / 10,
    ps1_by_cattle: Math.round(byCattle * 10) / 10,
    ps1_supported: Math.round(supported * 10) / 10,
    net_ps1: Math.round(net * 10) / 10,
    limited_by: byPopulation <= byCattle ? 'population' : 'cattle supply',
    suggested_config: config,
  };
}

// Admin action tags — what the team should do in this market, not just a score.
// Ordered by priority (lower = more urgent for GTM).
function computePlays(metrics, capacityCount, nearestMi, units) {
  const m = metrics || {};
  const pop = m.population || 0;
  const head = m.livestock || 0;
  const cattle = m.cattle || 0;
  const buyers = m.buyers || 0;
  const farms = m.farms || 0;
  const listings = m.listings || 0;
  const res = m.reservations || 0;
  const plays = [];

  // Hardware: room for PS units after existing plants, or zero plants + both sides.
  if (units && units.net_ps1 >= 0.5) {
    plays.push({
      id: 'hardware',
      label: 'Sell hardware',
      priority: 1,
      why: `Market supports ~${units.suggested_config} (net ${units.net_ps1} PS1 after plants; limited by ${units.limited_by})`,
    });
  } else if (capacityCount === 0 && pop >= 40000 && (cattle >= 8000 || head >= 15000)) {
    plays.push({
      id: 'hardware',
      label: 'Sell hardware',
      priority: 1,
      why: 'No processors in radius, with people + livestock to feed a plant',
    });
  } else if (units && units.ps1_supported >= 1 && units.net_ps1 < 0.5) {
    plays.push({
      id: 'hardware_addon',
      label: 'Hardware add-on',
      priority: 3,
      why: 'Area is roughly covered — kill-floor upgrade / cut trailer / overflow play',
    });
  }

  // Capacity gap even when some plants exist.
  if (nearestMi != null && nearestMi > 45 && pop >= 50000 && head >= 10000) {
    plays.push({
      id: 'capacity_gap',
      label: 'Capacity gap',
      priority: 1,
      why: `Nearest known plant ~${nearestMi} mi — haul is painful for farms serving this metro`,
    });
  }

  // Buyer acquisition: big metro, thin platform demand.
  if (pop >= 100000 && buyers < 15) {
    plays.push({
      id: 'recruit_buyers',
      label: 'Recruit buyers',
      priority: 2,
      why: `${Math.round(pop / 1000)}k people, only ${buyers} geocoded buyer${buyers === 1 ? '' : 's'} on PO`,
    });
  } else if (pop >= 50000 && buyers + res === 0) {
    plays.push({
      id: 'recruit_buyers',
      label: 'Recruit buyers',
      priority: 2,
      why: 'Population present but zero platform buyers/reservations in this zone',
    });
  }

  // Farm / livestock acquisition.
  if (head >= 40000 && farms < 5) {
    plays.push({
      id: 'recruit_farms',
      label: 'Recruit farms',
      priority: 2,
      why: `${Math.round(head).toLocaleString()} livestock head, only ${farms} farm${farms === 1 ? '' : 's'} on platform`,
    });
  } else if (cattle >= 20000 && farms === 0) {
    plays.push({
      id: 'recruit_farms',
      label: 'Recruit farms',
      priority: 2,
      why: 'Strong cattle inventory, no PO farms mapped here yet',
    });
  }

  // Activate inventory.
  if (farms >= 2 && listings === 0) {
    plays.push({
      id: 'activate_listings',
      label: 'Activate listings',
      priority: 3,
      why: `${farms} farms on platform, 0 active listings — get animals up for sale`,
    });
  }

  // Future commercial / retail channel.
  if (pop >= 500000) {
    plays.push({
      id: 'retail',
      label: 'Retail prospect',
      priority: 4,
      why: 'Large metro — Whole Foods / Costco / multi-store demand layer later',
    });
  }

  plays.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return plays;
}

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
// Heat: demand (metros) dominates; supply hinterland is visible but dim.
const HEAT_DEMAND_SCALE = 1;
const HEAT_SUPPLY_SCALE = 0.2;
// Non-overlap uses half the market radius so adjacent metros (e.g. SF /
// Sacramento at 100mi) can both rank instead of collapsing to one blob.
const SEPARATION_FRACTION = 0.5;

const RADIUS_CHOICES = [25, 50, 100, 200, 500];

function distanceMi(aLat, aLng, bLat, bLng) {
  const R = 3959;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const la1 = aLat * Math.PI / 180, la2 = bLat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Batch zip → lat/lng. ONE cache query for all zips (was N+1 and hung the map).
// At most MAX_FRESH_GEOCODES live Nominatim lookups for cache misses.
async function resolveZips(zipList) {
  const map = new Map(); // zip → {lat,lng}
  const unique = [];
  const seen = new Set();
  for (const raw of zipList) {
    const zip = String(raw || '').trim().slice(0, 5);
    if (!/^\d{5}$/.test(zip) || seen.has(zip)) continue;
    seen.add(zip);
    unique.push(zip);
  }
  if (!unique.length) return map;

  try {
    const rows = await sql`
      SELECT query_key, lat, lng FROM geocode_cache
      WHERE query_key = ANY(${unique})`;
    for (const r of rows) {
      if (r.lat != null && r.lng != null) map.set(r.query_key, { lat: r.lat, lng: r.lng });
    }
  } catch { /* geocode_cache may not exist yet */ }

  let fresh = 0;
  for (const zip of unique) {
    if (map.has(zip) || fresh >= MAX_FRESH_GEOCODES) continue;
    fresh++;
    const g = await geocode({ zip }).catch(() => null);
    if (g) map.set(zip, { lat: g.lat, lng: g.lng });
  }
  return map;
}

async function loadPoints() {
  const totals = {
    buyers: 0, buyers_geocoded: 0, reservations: 0, reservations_geocoded: 0,
    farms: 0, farms_geocoded: 0, listings: 0,
    processors: 0, processors_geocoded: 0, hardware_leads: 0,
    counties: 0, population: 0, livestock_head: 0,
  };
  const demand = [];   // { lat, lng, weight, label, state, counts, layer }
  const supply = [];
  const capacity = []; // { lat, lng, state }

  // Parallel base loads — no sequential N+1.
  const [farms, reservations, buyers, processors] = await Promise.all([
    sql`
      SELECT f.id, f.name, f.city, f.state, f.lat, f.lng,
             (SELECT COUNT(*)::int FROM listings l WHERE l.farm_id = f.id AND l.status = 'active') AS listings_count
      FROM farms f`,
    sql`
      SELECT r.id, u.zip AS buyer_zip
      FROM reservations r
      LEFT JOIN users u ON u.id = r.buyer_id
      WHERE r.status NOT IN ('cancelled','refunded')`,
    sql`
      SELECT id, zip FROM users
      WHERE role = 'buyer' AND zip IS NOT NULL AND zip <> ''`,
    sql`
      SELECT id, state, lat, lng, owner_id,
             (bio ILIKE 'Imported from assoc%') AS from_registry
      FROM processors`,
  ]);

  let countyRows = [];
  try {
    countyRows = await sql`
      SELECT fips, name, state, lat, lng, population, cattle, hogs, sheep, goats
      FROM county_stats WHERE lat IS NOT NULL AND lng IS NOT NULL`;
  } catch { /* table not created yet — platform-only scoring */ }

  // ── Supply: farms weighted by active listings ────────────────
  for (const f of farms) {
    totals.farms++;
    totals.listings += f.listings_count;
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

  // ── Zip batch resolve for buyers + reservation buyers ────────
  const zipKeys = [];
  for (const r of reservations) zipKeys.push(r.buyer_zip);
  for (const b of buyers) zipKeys.push(b.zip);
  const zipMap = await resolveZips(zipKeys);

  for (const r of reservations) {
    totals.reservations++;
    const zip = String(r.buyer_zip || '').trim().slice(0, 5);
    const g = zipMap.get(zip);
    if (!g) continue;
    totals.reservations_geocoded++;
    demand.push({
      lat: g.lat, lng: g.lng,
      weight: W_RESERVATION,
      label: null, state: null,
      layer: 'reservations',
      counts: { reservations: 1 },
    });
  }

  for (const b of buyers) {
    totals.buyers++;
    const zip = String(b.zip || '').trim().slice(0, 5);
    const g = zipMap.get(zip);
    if (!g) continue;
    totals.buyers_geocoded++;
    demand.push({
      lat: g.lat, lng: g.lng,
      weight: W_BUYER,
      label: null, state: null,
      layer: 'buyers',
      counts: { buyers: 1 },
    });
  }

  // ── Market data: county population (demand) + livestock (supply) ─
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
        counts: { livestock: head, cattle: c.cattle || 0 },
      });
    }
  }

  // ── Capacity: every geocoded processor ────────────────────────
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
  buyers: 0, reservations: 0, farms: 0, listings: 0, population: 0, livestock: 0, cattle: 0,
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

// Spatial index — score/heat stay O(nearby) instead of O(all points × candidates).
function buildIndex(points, cellDeg) {
  const grid = new Map();
  for (const p of points) {
    const key = `${Math.floor(p.lat / cellDeg)}:${Math.floor(p.lng / cellDeg)}`;
    let arr = grid.get(key);
    if (!arr) { arr = []; grid.set(key, arr); }
    arr.push(p);
  }
  return { grid, cellDeg };
}

function forEachNear(index, lat, lng, radiusMiles, fn) {
  if (!index) return;
  const { grid, cellDeg } = index;
  // ~55 mi per degree of longitude at mid-latitudes — slightly conservative.
  const rCells = Math.ceil(radiusMiles / Math.max(cellDeg * 55, 1)) + 1;
  const i0 = Math.floor(lat / cellDeg);
  const j0 = Math.floor(lng / cellDeg);
  for (let di = -rCells; di <= rCells; di++) {
    for (let dj = -rCells; dj <= rCells; dj++) {
      const pts = grid.get(`${i0 + di}:${j0 + dj}`);
      if (!pts) continue;
      for (const p of pts) {
        if (distanceMi(lat, lng, p.lat, p.lng) <= radiusMiles) fn(p);
      }
    }
  }
}

// Score one point against the full point sets within radius. Used for every
// grid candidate and for zip-centered focus analysis.
// Labels prefer the largest population county in the circle (the metro name
// people recognize), then any demand label, then supply — never a pure
// livestock county just because the herd is big.
// Optional spatial indexes make full-county scoring finish in seconds.
function scoreAt(lat, lng, radiusMiles, demand, supply, capacity, indexes) {
  const metrics = EMPTY_METRICS();
  let demandScore = 0, supplyScore = 0, capacityCount = 0;
  let bestPopLabel = null, bestPop = 0;
  let bestDemandLabel = null, bestDemandW = 0;
  let bestSupplyLabel = null, bestSupplyW = 0;

  const visitDemand = (p) => {
    demandScore += p.weight;
    accumulate(metrics, p.counts);
    const pop = p.counts?.population || 0;
    if (pop > bestPop && p.label) { bestPop = pop; bestPopLabel = p.label; }
    if (p.label && p.weight > bestDemandW) { bestDemandW = p.weight; bestDemandLabel = p.label; }
  };
  const visitSupply = (p) => {
    supplyScore += p.weight;
    accumulate(metrics, p.counts);
    if (p.label && p.weight > bestSupplyW) { bestSupplyW = p.weight; bestSupplyLabel = p.label; }
  };

  if (indexes) {
    forEachNear(indexes.demand, lat, lng, radiusMiles, visitDemand);
    forEachNear(indexes.supply, lat, lng, radiusMiles, visitSupply);
  } else {
    for (const p of demand) {
      if (distanceMi(lat, lng, p.lat, p.lng) <= radiusMiles) visitDemand(p);
    }
    for (const p of supply) {
      if (distanceMi(lat, lng, p.lat, p.lng) <= radiusMiles) visitSupply(p);
    }
  }

  let nearestProcessor = Infinity;
  if (indexes?.capacity) {
    forEachNear(indexes.capacity, lat, lng, radiusMiles, (p) => {
      capacityCount++;
      const d = distanceMi(lat, lng, p.lat, p.lng);
      if (d < nearestProcessor) nearestProcessor = d;
    });
    // Nearest may be outside the market radius — scan a wider ring cheaply.
    if (nearestProcessor === Infinity && capacity.length) {
      for (const p of capacity) {
        const d = distanceMi(lat, lng, p.lat, p.lng);
        if (d < nearestProcessor) nearestProcessor = d;
      }
    }
  } else {
    for (const p of capacity) {
      const d = distanceMi(lat, lng, p.lat, p.lng);
      if (d <= radiusMiles) capacityCount++;
      if (d < nearestProcessor) nearestProcessor = d;
    }
  }

  return {
    label: bestPopLabel || bestDemandLabel || bestSupplyLabel,
    demand_score: Math.round(demandScore * 10) / 10,
    supply_score: Math.round(supplyScore * 10) / 10,
    capacity_count: capacityCount,
    nearest_processor_miles: nearestProcessor === Infinity ? null : Math.round(nearestProcessor),
    metrics,
    _demand: demandScore, _supply: supplyScore,
  };
}

// Cap candidate evaluation so we never thrash on ~3k county bins.
const MAX_CANDIDATES = 220;

// ── Radius-cluster hotspots (metro-first) ──────────────────────
// Candidates are binned from DEMAND only so pins land on cities / buyer
// clusters. Cattle and farms inside the haul radius still raise the score;
// they just don't drag the pin into pasture between the metro and the herd.
// One-sided farm-density lenses fall back to supply centers.
function computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots, requireBoth) {
  // Prefer population / platform demand for pin placement; fall back to all demand, then supply.
  let centerSrc = demand.filter(p => p.layer === 'population' || p.layer === 'buyers' || p.layer === 'reservations');
  if (!centerSrc.length) centerSrc = demand.length ? demand : supply;
  if (!centerSrc.length) return finalize([]);

  const cellDeg = Math.max(radiusMiles / 2, 10) / 69;
  const bins = new Map();
  for (const p of centerSrc) {
    const key = `${Math.floor(p.lat / cellDeg)}:${Math.floor(p.lng / cellDeg)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(p);
  }
  let candidates = [];
  for (const pts of bins.values()) {
    const w = pts.reduce((s, p) => s + p.weight, 0);
    if (w <= 0) continue;
    candidates.push({
      lat: pts.reduce((s, p) => s + p.lat * p.weight, 0) / w,
      lng: pts.reduce((s, p) => s + p.lng * p.weight, 0) / w,
      _w: w,
    });
  }
  // Keep densest bins only — scoring all US counties times all plants was the hang.
  if (candidates.length > MAX_CANDIDATES) {
    candidates.sort((a, b) => b._w - a._w);
    candidates = candidates.slice(0, MAX_CANDIDATES);
  }

  const idxCell = Math.max(radiusMiles / 3, 12) / 69;
  const indexes = {
    demand: buildIndex(demand, idxCell),
    supply: buildIndex(supply, idxCell),
    capacity: buildIndex(capacity, idxCell),
  };

  const scored = [];
  for (const c of candidates) {
    const s = scoreAt(c.lat, c.lng, radiusMiles, demand, supply, capacity, indexes);
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
  // Geographic diversity: don't let the top-25 collapse into only the Northeast.
  // First pass: at most one winner per ~3° cell; second pass fills remaining slots.
  const minSep = Math.max(radiusMiles * SEPARATION_FRACTION, 15);
  const diversifyDeg = 3;
  const cellTaken = new Set();
  const kept = [];
  const tryKeep = (cand, enforceCell) => {
    if (kept.some(k => distanceMi(cand.lat, cand.lng, k.lat, k.lng) <= minSep)) return false;
    const ck = `${Math.floor(cand.lat / diversifyDeg)}:${Math.floor(cand.lng / diversifyDeg)}`;
    if (enforceCell && cellTaken.has(ck)) return false;
    cellTaken.add(ck);
    kept.push(cand);
    return true;
  };
  for (const cand of scored) {
    if (kept.length >= maxHotspots) break;
    tryKeep(cand, true);
  }
  for (const cand of scored) {
    if (kept.length >= maxHotspots) break;
    if (kept.includes(cand)) continue;
    tryKeep(cand, false);
  }
  return finalize(kept);
}

// ── Nationwide: rank whole states ──────────────────────────────
// State pin = demand-weighted centroid (where people are), not a blend with
// cattle country that would park the marker in empty range.
function computeStateRanking(demand, supply, capacity, maxHotspots, requireBoth) {
  const states = new Map(); // state → agg
  const get = (st) => {
    if (!states.has(st)) {
      states.set(st, {
        demand: 0, supply: 0, cap: 0, metrics: EMPTY_METRICS(),
        dLatW: 0, dLngW: 0, dW: 0,
        sLatW: 0, sLngW: 0, sW: 0,
      });
    }
    return states.get(st);
  };
  for (const p of demand) {
    if (!p.state) continue;
    const s = get(p.state);
    s.demand += p.weight; accumulate(s.metrics, p.counts);
    s.dLatW += p.lat * p.weight; s.dLngW += p.lng * p.weight; s.dW += p.weight;
  }
  for (const p of supply) {
    if (!p.state) continue;
    const s = get(p.state);
    s.supply += p.weight; accumulate(s.metrics, p.counts);
    s.sLatW += p.lat * p.weight; s.sLngW += p.lng * p.weight; s.sW += p.weight;
  }
  for (const p of capacity) {
    if (!p.state) continue;
    get(p.state).cap++;
  }

  const scored = [];
  for (const [st, s] of states) {
    const raw = rawScore(s.demand, s.supply, requireBoth);
    const cW = s.dW || s.sW;
    if (raw <= 0 || !cW) continue;
    const lat = s.dW ? s.dLatW / s.dW : s.sLatW / s.sW;
    const lng = s.dW ? s.dLngW / s.dW : s.sLngW / s.sW;
    scored.push({
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
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
    h.units = computeUnits(h.metrics, h.capacity_count);
    h.plays = computePlays(h.metrics, h.capacity_count, h.nearest_processor_miles, h.units);
    h.primary_play = h.plays[0] || null;
    delete h._score;
  });
  return { hotspots: kept, top };
}

// ── Snap-style heat points ─────────────────────────────────────
// Continuous green→yellow→orange→red field (not discrete market bubbles).
// Capacity damps intensity. Supply is hinterland (dimmer) so demand/metros
// still read as peaks.
//
// IMPORTANT: never keep only the global top-N by intensity — that wiped the
// West / Midwest / South when Northeast metros dominated. We stratify by
// geography so every region of the US contributes heat points.
const HEAT_MAX_POINTS = 6000;
const HEAT_PER_REGION = 8;          // strongest points per ~1.5° cell
const HEAT_REGION_DEG = 1.5;

function buildHeat(demand, supply, capacity, radiusMiles) {
  const cellDeg = Math.max(radiusMiles / 2.5, 12) / 69;
  const capGrid = new Map();
  for (const c of capacity) {
    const key = `${Math.floor(c.lat / cellDeg)}:${Math.floor(c.lng / cellDeg)}`;
    capGrid.set(key, (capGrid.get(key) || 0) + 1);
  }
  const nearCap = (lat, lng) => {
    const i0 = Math.floor(lat / cellDeg);
    const j0 = Math.floor(lng / cellDeg);
    let n = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        n += capGrid.get(`${i0 + di}:${j0 + dj}`) || 0;
      }
    }
    return n;
  };

  const pts = [];
  let globalMax = 0;
  const push = (p, scale) => {
    const intensity = (p.weight * scale) / (1 + nearCap(p.lat, p.lng));
    if (intensity <= 0) return;
    if (intensity > globalMax) globalMax = intensity;
    pts.push([p.lat, p.lng, intensity]);
  };
  for (const p of demand) push(p, HEAT_DEMAND_SCALE);
  for (const p of supply) push(p, HEAT_SUPPLY_SCALE);
  if (!globalMax || !pts.length) return [];

  // Regional max — blend with global so CA/TX/Midwest show local heat even when
  // absolute intensity is below Northeast metros.
  const regionMax = new Map();
  for (const [lat, lng, i] of pts) {
    const rk = `${Math.floor(lat / HEAT_REGION_DEG)}:${Math.floor(lng / HEAT_REGION_DEG)}`;
    regionMax.set(rk, Math.max(regionMax.get(rk) || 0, i));
  }

  // Stratified keep: top HEAT_PER_REGION per region, then fill by intensity.
  const byRegion = new Map();
  for (const pt of pts) {
    const rk = `${Math.floor(pt[0] / HEAT_REGION_DEG)}:${Math.floor(pt[1] / HEAT_REGION_DEG)}`;
    if (!byRegion.has(rk)) byRegion.set(rk, []);
    byRegion.get(rk).push(pt);
  }
  const kept = [];
  for (const arr of byRegion.values()) {
    arr.sort((a, b) => b[2] - a[2]);
    for (let i = 0; i < Math.min(HEAT_PER_REGION, arr.length); i++) kept.push(arr[i]);
  }
  if (kept.length < HEAT_MAX_POINTS) {
    const seen = new Set(kept.map(p => `${p[0]}:${p[1]}`));
    const rest = pts.filter(p => !seen.has(`${p[0]}:${p[1]}`)).sort((a, b) => b[2] - a[2]);
    for (const p of rest) {
      if (kept.length >= HEAT_MAX_POINTS) break;
      kept.push(p);
    }
  } else if (kept.length > HEAT_MAX_POINTS) {
    // Prefer geographic coverage: already stratified — trim weakest globally.
    kept.sort((a, b) => b[2] - a[2]);
    kept.length = HEAT_MAX_POINTS;
  }

  // Display intensity: 55% global rank + 45% regional rank → Snap-like melt
  // across the whole country, not one glowing Northeast blob.
  return kept
    .map(([lat, lng, i]) => {
      const rk = `${Math.floor(lat / HEAT_REGION_DEG)}:${Math.floor(lng / HEAT_REGION_DEG)}`;
      const rMax = regionMax.get(rk) || globalMax;
      const g = i / globalMax;
      const r = rMax > 0 ? i / rMax : 0;
      const blended = 0.55 * g + 0.45 * r;
      // Floor so cool regions still tint green instead of vanishing
      const intensity = Math.max(0.06, Math.min(1, blended));
      return [
        Math.round(lat * 1e5) / 1e5,
        Math.round(lng * 1e5) / 1e5,
        Math.round(intensity * 1000) / 1000,
      ];
    })
    .filter(p => p[2] > 0);
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

    // Shared spatial indexes for focus scoring (same grid as ranking).
    const idxCell = Math.max((scope === 'nationwide' ? 100 : radiusMiles) / 3, 12) / 69;
    const indexes = {
      demand: buildIndex(demand, idxCell),
      supply: buildIndex(supply, idxCell),
      capacity: buildIndex(capacity, idxCell),
    };

    // Focus analysis: score a market area centered on a zip OR an arbitrary
    // clicked map point ("lat,lng"), comparable to the ranked list. The list
    // only shows the top non-overlapping areas — focus lets any spot on the
    // map be interrogated. focus_radius expands/shrinks the zone from that
    // center independently of the main market-area selector.
    let focus = null;
    const centerRaw = (url.searchParams.get('center') || '').trim().slice(0, 40);
    const centerZip = /^\d{5}$/.test(centerRaw) ? centerRaw : null;
    let centerPoint = null;
    const ptMatch = centerRaw.match(/^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
    if (ptMatch) {
      const la = parseFloat(ptMatch[1]), ln = parseFloat(ptMatch[2]);
      if (la >= -90 && la <= 90 && ln >= -180 && ln <= 180) centerPoint = { lat: la, lng: ln };
    }
    if (centerZip || centerPoint) {
      const g = centerPoint || await geocode({ zip: centerZip }).catch(() => null);
      if (g) {
        let fRadius = Number(url.searchParams.get('focus_radius')) || (scope === 'nationwide' ? 100 : radiusMiles);
        fRadius = Math.max(10, Math.min(fRadius, 500));
        const s = scoreAt(g.lat, g.lng, fRadius, demand, supply, capacity, indexes);
        const raw = rawScore(s._demand, s._supply, requireBoth);
        const fScore = raw / (1 + s.capacity_count);
        const denom = Math.max(top, fScore) || 1;
        const units = computeUnits(s.metrics, s.capacity_count);
        const plays = computePlays(s.metrics, s.capacity_count, s.nearest_processor_miles, units);
        focus = {
          zip: centerZip,
          center_type: centerZip ? 'zip' : 'point',
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
          units,
          plays,
          primary_play: plays[0] || null,
        };
      } else {
        focus = { zip: centerZip, center_type: 'zip', error: 'Could not locate that zip code' };
      }
    }

    // Heat damping radius: for nationwide use 100mi so the gradient still
    // reads locally rather than one state-sized blob.
    const heat = buildHeat(demand, supply, capacity, scope === 'nationwide' ? 100 : radiusMiles);
    return json({
      scope,
      model: 'metro_first_v2',
      radius_miles: scope === 'nationwide' ? null : radiusMiles,
      layers: [...layers],
      capacity_mode: capacityMode,
      focus,
      hotspots, heat, totals,
      unit_economics: {
        ps1_head_per_shift: PS1_HEAD_PER_SHIFT,
        shifts_per_week: SHIFTS_PER_WEEK,
        ps1_head_per_year: PS1_HEAD_PER_YEAR,
        boneless_lb_per_head: BONELESS_LB_PER_HEAD,
        per_capita_beef_lb: PER_CAPITA_BEEF_LB,
        people_per_ps1: PEOPLE_PER_PS1,
        cattle_marketing_rate: CATTLE_MARKETING_RATE,
        existing_plant_ps1_equiv: EXISTING_PLANT_PS1_EQUIV,
        ps2_multiple_placeholder: PS2_MULTIPLE,
        ps3_multiple_placeholder: PS3_MULTIPLE,
      },
    });
  } catch (e) {
    return err(500, 'admin-hotspots failed: ' + (e.message || 'unknown').slice(0, 200));
  }
}

export default nodejsHandler(handler);
