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

  // Processor onboarding — demand or inventory without a partnered plant nearby.
  if (capacityCount === 0 && (res >= 1 || listings >= 1 || pop >= 40000) && (farms >= 1 || cattle >= 8000 || head >= 15000)) {
    plays.push({
      id: 'recruit_processors',
      label: 'Recruit processors',
      priority: 1,
      why: 'Demand or livestock here, no known plant in radius — onboard a butcher',
    });
  } else if (capacityCount <= 1 && nearestMi != null && nearestMi > 35 && (res >= 1 || listings >= 1 || buyers >= 8)) {
    plays.push({
      id: 'recruit_processors',
      label: 'Recruit processors',
      priority: 2,
      why: `Only ${capacityCount} plant${capacityCount === 1 ? '' : 's'}, nearest ~${nearestMi} mi — farms will haul too far`,
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
// Supply was so dim that cattle country (West/Midwest/South) barely painted.
// Still below demand so metros stay the peaks, but hinterland shows nationwide.
const HEAT_SUPPLY_SCALE = 0.45;
// Always paint the continental US even when data is sparse in a corner —
// otherwise the heat grid shrinks to the Northeast and the West looks "off".
const CONUS_BOX = { south: 24.3, north: 49.5, west: -125.0, east: -66.5 };
// Non-overlap uses half the market radius so adjacent metros (e.g. SF /
// Sacramento at 100mi) can both rank instead of collapsing to one blob.
const SEPARATION_FRACTION = 0.5;

const RADIUS_CHOICES = [25, 50, 100, 200, 500];

// ── Region (map view) ranking ──────────────────────────────────
// A view wider than this is just "the country" — rank nationally instead of
// pretending it's a region.
const NATIONAL_SPAN_MI = 2600;
// ...and a view tighter than this is smaller than the smallest market lens we
// sell against. Analyse a 25-mile box around it rather than dropping the region
// and silently snapping the list back to the whole country.
const MIN_REGION_SPAN_MI = 25;
// A region that yields fewer than this many places is a dead end for the user,
// so widen the analysis box until it has something to show.
const MIN_REGION_RESULTS = 5;
const MI_PER_DEG = 69;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

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
// When `region` is set, candidates are binned from inside that box only and the
// bin/separation sizes shrink to the view — so zooming into one metro ranks the
// places *within* it instead of re-listing the same national top 25.
function computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots, requireBoth, region) {
  // Prefer population / platform demand for pin placement; fall back to all demand, then supply.
  let centerSrc = demand.filter(p => p.layer === 'population' || p.layer === 'buyers' || p.layer === 'reservations');
  if (!centerSrc.length) centerSrc = demand.length ? demand : supply;
  if (!centerSrc.length) return [];

  // Region views get a finer grid: ~12 bins across the view, so a city-sized
  // box resolves neighbourhoods instead of returning one bin for the whole view.
  const cellMi = region
    ? clamp(region.span_miles / 12, 5, Math.max(radiusMiles / 2, 10))
    : Math.max(radiusMiles / 2, 10);
  const cellDeg = cellMi / MI_PER_DEG;
  const bins = new Map();
  for (const p of centerSrc) {
    if (region && (p.lat < region.south || p.lat > region.north ||
                   p.lng < region.west || p.lng > region.east)) continue;
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
  const minSep = region
    ? clamp(region.span_miles / 6, Math.min(12, radiusMiles * SEPARATION_FRACTION), radiusMiles * SEPARATION_FRACTION)
    : Math.max(radiusMiles * SEPARATION_FRACTION, 15);
  // Inside a region the 3° diversity cell is bigger than the whole view, which
  // would keep exactly one pin. Scale it to the view so the first pass still
  // spreads results out.
  const diversifyDeg = region ? Math.max(region.span_miles / 3 / MI_PER_DEG, 0.05) : 3;
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
  // Caller finalizes — it owns the score scale (national, not per-view).
  return kept;
}

// ── Nationwide: rank whole states ──────────────────────────────
// State pin = demand-weighted centroid (where people are), not a blend with
// cattle country that would park the marker in empty range.
function computeStateRanking(demand, supply, capacity, requireBoth) {
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
  // Every state, best first. Caller slices (and may filter to a region).
  return scored;
}

function inBox(h, box) {
  return h.lat >= box.south && h.lat <= box.north && h.lng >= box.west && h.lng <= box.east;
}

// `topScore` is the NATIONAL best. Passing it explicitly is what keeps a quiet
// region reading as quiet — re-normalizing to the visible list would paint the
// best place in an empty county as a 100.
function finalize(kept, topScore) {
  const top = topScore || (kept.length ? kept[0]._score : 0);
  kept.forEach((h, i) => {
    h.rank = i + 1;
    h.opportunity_score = Math.round((top ? 100 * h._score / top : 0) * 10) / 10;
    h.units = computeUnits(h.metrics, h.capacity_count);
    h.plays = computePlays(h.metrics, h.capacity_count, h.nearest_processor_miles, h.units);
    h.primary_play = h.plays[0] || null;
    delete h._score;
  });
  return kept;
}

// ── Continuous heat field (KDE grid) ───────────────────────────
// The old renderer shipped ~6k weighted points to leaflet.heat, which drew a
// pixel-constant blob per point: the map dimmed as you zoomed in, and the
// palette's mid-yellow was LIGHTER than the greens below it, so a busier market
// could read fainter than a dead one. This builds the density field on the
// server instead and ships a grid the client colours with a monotonic ramp —
// darker always means more, at every zoom.
const HEAT_MAX_CELLS = 100000;

// Percentile transfer curve. Max-normalizing against a single outlier county
// crushed most of the country into nearly-invisible paint. Stretch more of the
// mass into the light/mid radar bands so West/Midwest/South still show up.
function transferCurve(values) {
  const sorted = Float64Array.from(values);
  sorted.sort();
  const n = sorted.length;
  const q = (f) => sorted[clamp(Math.round(f * (n - 1)), 0, n - 1)];
  const raw = [
    [0, 0],
    // Visible floor: the bottom half of the country still tints light blue/green
    [q(0.12), 0.14], [q(0.30), 0.26], [q(0.50), 0.40], [q(0.68), 0.52],
    [q(0.80), 0.64], [q(0.90), 0.76], [q(0.96), 0.86], [q(0.99), 0.94], [q(0.998), 1.0],
  ];
  const xs = [], ys = [];
  for (const [x, y] of raw) {
    if (xs.length && x <= xs[xs.length - 1]) continue;
    xs.push(x); ys.push(y);
  }
  if (xs.length < 2) { xs.push(xs[0] + 1); ys.push(1); }
  const last = xs.length - 1;
  return (v) => {
    if (v <= xs[0]) return 0;
    if (v >= xs[last]) return 1;
    let i = 1;
    while (i < last && v > xs[i]) i++;
    const t = (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  };
}

function buildHeatField(demand, supply, capacity, radiusMiles, region) {
  // Demand (metros) drives the colour; the supply hinterland stays visible but
  // dim, so ranchland tints the map instead of competing with the cities it
  // feeds. Scoring still weights the two sides evenly — this is the picture.
  const pts = [];
  for (const p of demand) if (p.weight > 0) pts.push({ lat: p.lat, lng: p.lng, w: p.weight * HEAT_DEMAND_SCALE });
  for (const p of supply) if (p.weight > 0) pts.push({ lat: p.lat, lng: p.lng, w: p.weight * HEAT_SUPPLY_SCALE });
  if (!pts.length) return null;

  // Kernel width tracks the market radius: a 25-mile lens should show tight
  // local pockets, a 500-mile lens broad regional pressure. National view gets
  // a slightly wider kernel so sparse data still connects across states.
  const sigmaMi = clamp(radiusMiles * (region ? 0.45 : 0.55), region ? 12 : 22, 160);
  const capSigmaMi = Math.max(sigmaMi, radiusMiles * 0.55);

  // Points whose kernel can still reach into the box. Keeping the ones just
  // outside it matters: a city eight miles off-screen genuinely heats the edge.
  const near = (list, box, reachMi) => {
    const cosB = Math.max(0.2, Math.cos(((box.south + box.north) / 2) * Math.PI / 180));
    const dLatR = reachMi / MI_PER_DEG;
    const dLngR = reachMi / (MI_PER_DEG * cosB);
    return list.filter(p => p.lat >= box.south - dLatR && p.lat <= box.north + dLatR &&
                            p.lng >= box.west - dLngR && p.lng <= box.east + dLngR);
  };

  // Capacity-damped density over an arbitrary box. Cell size only controls
  // resolution — the Gaussian is normalized to K(0)=1, so the same place reads
  // the same value on a coarse grid or a fine one. That's what lets the zoomed
  // grid below reuse the national colour scale.
  const fieldOver = (box, targetCellMi) => {
    const minLat = box.south, minLng = box.west;
    const cosMid = Math.max(0.2, Math.cos(((box.south + box.north) / 2) * Math.PI / 180));
    let cellMi = Math.max(0.2, targetCellMi);
    let dLat, dLng, rows, cols;
    for (let guard = 0; guard < 60; guard++) {
      dLat = cellMi / MI_PER_DEG;
      dLng = cellMi / (MI_PER_DEG * cosMid);
      rows = Math.ceil((box.north - box.south) / dLat) + 1;
      cols = Math.ceil((box.east - box.west) / dLng) + 1;
      if (rows * cols <= HEAT_MAX_CELLS) break;
      cellMi *= 1.15;
    }
    if (!(rows > 1 && cols > 1)) return null;

    const field = new Float64Array(rows * cols);
    const capField = new Float64Array(rows * cols);
    const scatter = (target, list, sigma, weightOf) => {
      const reach = sigma * 2.5;
      const twoSigSq = 2 * sigma * sigma;
      const rLat = Math.ceil(reach / MI_PER_DEG / dLat);
      const rLng = Math.ceil(reach / (MI_PER_DEG * cosMid) / dLng);
      for (const p of list) {
        const w = weightOf(p);
        if (!(w > 0)) continue;
        const r0 = Math.round((p.lat - minLat) / dLat);
        const c0 = Math.round((p.lng - minLng) / dLng);
        for (let r = r0 - rLat; r <= r0 + rLat; r++) {
          if (r < 0 || r >= rows) continue;
          const cellLat = minLat + r * dLat;
          const dyMi = (cellLat - p.lat) * MI_PER_DEG;
          const cosRow = Math.max(0.2, Math.cos(cellLat * Math.PI / 180));
          for (let c = c0 - rLng; c <= c0 + rLng; c++) {
            if (c < 0 || c >= cols) continue;
            const dxMi = (minLng + c * dLng - p.lng) * MI_PER_DEG * cosRow;
            const k = Math.exp(-(dxMi * dxMi + dyMi * dyMi) / twoSigSq);
            if (k < 0.01) continue;
            target[r * cols + c] += w * k;
          }
        }
      }
    };

    scatter(field, near(pts, box, sigmaMi * 2.5), sigmaMi, (p) => p.w);
    if (capacity.length) scatter(capField, near(capacity, box, capSigmaMi * 2.5), capSigmaMi, () => 1);
    // Damp by capacity: activity with a plant on top of it isn't an opportunity.
    for (let i = 0; i < field.length; i++) field[i] = field[i] / (1 + capField[i]);
    return { field, dLat, dLng, rows, cols, minLat, minLng, cellMi };
  };

  // National extent: always cover CONUS so the heat field is a full-country
  // canvas. Expand only if data exists outside the lower 48 (e.g. AK/HI).
  let minLat = CONUS_BOX.south, maxLat = CONUS_BOX.north;
  let minLng = CONUS_BOX.west, maxLng = CONUS_BOX.east;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const cosNat = Math.max(0.2, Math.cos(((minLat + maxLat) / 2) * Math.PI / 180));
  const padLat = (sigmaMi * 2) / MI_PER_DEG;
  const padLng = (sigmaMi * 2) / (MI_PER_DEG * cosNat);
  const natBox = {
    south: Math.min(CONUS_BOX.south, minLat) - padLat,
    north: Math.max(CONUS_BOX.north, maxLat) + padLat,
    west: Math.min(CONUS_BOX.west, minLng) - padLng,
    east: Math.max(CONUS_BOX.east, maxLng) + padLng,
  };
  // Slightly finer national grid so West/Midwest cells aren't giant washes
  const nat = fieldOver(natBox, Math.max(5, sigmaMi / 1.4));
  if (!nat) return null;

  // The colour scale is ALWAYS derived nationally. Re-fitting it to whatever is
  // on screen would paint a quiet county red the moment you zoomed into it, and
  // the ranked list beside the map is on the national scale too.
  const values = [];
  for (const v of nat.field) if (v > 0) values.push(v);
  if (!values.length) return null;
  const curve = transferCurve(values);

  // Zoomed in, the national grid's ~18-mile cells put a whole screen inside one
  // or two samples and the map flattens into a wash. Re-grid just the view at a
  // resolution that actually resolves it: same kernel, same scale, real detail.
  let g = nat;
  if (region) {
    const padMi = Math.max(4, region.span_miles * 0.25);
    const cosR = Math.max(0.2, Math.cos(((region.south + region.north) / 2) * Math.PI / 180));
    const viewBox = {
      south: clamp(region.south - padMi / MI_PER_DEG, -85, 85),
      north: clamp(region.north + padMi / MI_PER_DEG, -85, 85),
      west: region.west - padMi / (MI_PER_DEG * cosR),
      east: region.east + padMi / (MI_PER_DEG * cosR),
    };
    if (spanMiles(viewBox) < nat.cellMi * 40) {
      const local = fieldOver(viewBox, spanMiles(viewBox) / 260);
      if (local && local.cellMi < nat.cellMi) g = local;
    }
  }

  const bytes = new Uint8Array(g.field.length);
  for (let i = 0; i < g.field.length; i++) {
    if (g.field[i] <= 0) continue;
    bytes[i] = Math.round(clamp(curve(g.field[i]), 0, 1) * 255);
  }

  return {
    lat_top: Math.round((g.minLat + (g.rows - 1) * g.dLat) * 1e6) / 1e6,
    lng_left: Math.round(g.minLng * 1e6) / 1e6,
    d_lat: g.dLat,
    d_lng: g.dLng,
    rows: g.rows,
    cols: g.cols,
    cell_miles: Math.round(g.cellMi * 100) / 100,
    sigma_miles: Math.round(sigmaMi * 10) / 10,
    scale: 'national',
    // Row 0 = TOP (north). Client reads it straight into image rows.
    b64: Buffer.from(flipRows(bytes, g.rows, g.cols)).toString('base64'),
  };
}

// Grid is built south-to-north; images draw north-to-south.
function flipRows(bytes, rows, cols) {
  const out = new Uint8Array(bytes.length);
  for (let r = 0; r < rows; r++) {
    out.set(bytes.subarray(r * cols, (r + 1) * cols), (rows - 1 - r) * cols);
  }
  return out;
}

// ── Region parsing ─────────────────────────────────────────────
function spanMiles(box) {
  const cosMid = Math.max(0.2, Math.cos(((box.north + box.south) / 2) * Math.PI / 180));
  return Math.round(Math.max(
    (box.north - box.south) * MI_PER_DEG,
    (box.east - box.west) * MI_PER_DEG * cosMid,
  ));
}

function parseBounds(raw) {
  if (!raw) return null;
  const m = String(raw).trim().split(',').map(Number);
  if (m.length !== 4 || m.some(v => !Number.isFinite(v))) return null;
  let south = clamp(Math.min(m[0], m[2]), -85, 85);
  let north = clamp(Math.max(m[0], m[2]), -85, 85);
  let west = Math.min(m[1], m[3]);
  let east = Math.max(m[1], m[3]);
  const midLat = (north + south) / 2;
  const midLng = (east + west) / 2;
  const cosMid = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
  const view_span_miles = spanMiles({ south, north, west, east });

  // A view tighter than the smallest lens we sell against still deserves a
  // regional answer. Grow the analysis box around the same center instead of
  // throwing the region away — dropping it silently snapped the list back to
  // the whole country while the user was staring at one town.
  const minLatDeg = MIN_REGION_SPAN_MI / MI_PER_DEG;
  const minLngDeg = MIN_REGION_SPAN_MI / (MI_PER_DEG * cosMid);
  if (north - south < minLatDeg) {
    south = clamp(midLat - minLatDeg / 2, -85, 85);
    north = clamp(midLat + minLatDeg / 2, -85, 85);
  }
  if (east - west < minLngDeg) {
    west = midLng - minLngDeg / 2;
    east = midLng + minLngDeg / 2;
  }
  const box = { south, west, north, east };
  return { ...box, span_miles: spanMiles(box), view_span_miles };
}

// Grow a region box about its center. Used when a view is too tight to hold
// enough places to rank — widening and saying so beats an empty list.
function expandRegion(box, factor) {
  const midLat = (box.north + box.south) / 2;
  const midLng = (box.east + box.west) / 2;
  const halfLat = ((box.north - box.south) / 2) * factor;
  const halfLng = ((box.east - box.west) / 2) * factor;
  const out = {
    south: clamp(midLat - halfLat, -85, 85),
    north: clamp(midLat + halfLat, -85, 85),
    west: midLng - halfLng,
    east: midLng + halfLng,
  };
  out.span_miles = spanMiles(out);
  return out;
}

// Run `produce` on the view. A view holding even one qualifying place has an
// honest answer — show exactly that, so the list keeps tracking the map. Only a
// dead-end empty view is worth stepping back from, and then we step back far
// enough to return a useful set instead of one lonely pin 300 miles out.
// Returns the box actually used so the client can say so out loud.
function withWidening(region, produce) {
  let box = region;
  let list = produce(box);
  if (list.length) return { list, box, widened: 0 };
  let widened = 0;
  while (list.length < MIN_REGION_RESULTS && box.span_miles < NATIONAL_SPAN_MI && widened < 8) {
    box = expandRegion(box, 2);
    widened++;
    list = produce(box);
  }
  return { list, box, widened };
}

// Name the view from the states carrying the most weight inside it.
function regionLabel(activity, region) {
  const byState = new Map();
  for (const p of activity) {
    if (!p.state) continue;
    if (p.lat < region.south || p.lat > region.north || p.lng < region.west || p.lng > region.east) continue;
    byState.set(p.state, (byState.get(p.state) || 0) + p.weight);
  }
  const top = [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  if (!top.length) return 'Selected area';
  return top.join(' · ');
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

  // The map's current view, as "south,west,north,east". A view wider than the
  // country isn't a region — rank nationally rather than pretend it is one.
  let region = parseBounds(url.searchParams.get('bounds'));
  if (region && region.span_miles >= NATIONAL_SPAN_MI) region = null;

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

    // Rank the whole country FIRST, always — even when a region is in play.
    // That national best is the yardstick every score is normalized against,
    // which is what keeps a quiet region reading as quiet instead of painting
    // its least-dead county a 100.
    const activity = demand.concat(supply);
    let hotspots = [], top = 0;
    let regionOut = { type: 'national', span_miles: null, label: 'Nationwide' };
    const viewRegion = (w) => ({
      type: 'view',
      label: regionLabel(activity, w.box),
      span_miles: w.box.span_miles,
      view_span_miles: region.view_span_miles,
      widened: w.widened,
      bounds: {
        south: w.box.south, west: w.box.west,
        north: w.box.north, east: w.box.east,
      },
    });

    if (scope === 'nationwide') {
      const ranked = computeStateRanking(demand, supply, capacity, requireBoth);
      top = ranked.length ? ranked[0]._score : 0;
      let list = ranked.slice(0, Math.max(maxHotspots, 51));
      if (region) {
        const w = withWidening(region, (box) => ranked.filter(h => inBox(h, box)).slice(0, maxHotspots));
        if (w.list.length) { list = w.list; regionOut = viewRegion(w); }
        else region = null;   // nothing in view — fall back to the national list
      }
      // Everything we aren't returning still carries the private score field.
      for (const s of ranked) if (!list.includes(s)) delete s._score;
      hotspots = finalize(list, top);
    } else {
      const national = computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots, requireBoth, null);
      top = national.length ? national[0]._score : 0;
      let list = national;
      if (region) {
        const w = withWidening(region, (box) =>
          computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots, requireBoth, box));
        if (w.list.length) {
          for (const h of national) delete h._score;   // discarded set
          list = w.list;
          regionOut = viewRegion(w);
        } else region = null;
      }
      // A region can out-score the national pass when its finer grid resolves a
      // peak the coarse pass averaged away; take the higher of the two so no
      // score exceeds 100.
      hotspots = finalize(list, Math.max(top, list.length ? list[0]._score : 0));
    }

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
    const heat_grid = buildHeatField(
      demand, supply, capacity,
      scope === 'nationwide' ? 100 : radiusMiles,
      region,
    );
    return json({
      scope,
      model: 'metro_first_v3',
      radius_miles: scope === 'nationwide' ? null : radiusMiles,
      layers: [...layers],
      capacity_mode: capacityMode,
      region: regionOut,
      focus,
      hotspots, heat_grid, totals,
      // Retired point-cloud field. Kept as an empty array so a browser holding
      // the previous HTML during the ~50s deploy window renders no heat instead
      // of throwing on undefined.
      heat: [],
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
