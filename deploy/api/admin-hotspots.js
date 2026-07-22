// /api/admin-hotspots — hardware opportunity hotspot map data (admin only).
//
//   GET ?radius_miles=50&max_hotspots=25 → {
//     radius_miles,
//     hotspots: [{ rank, lat, lng, label, opportunity_score, demand_score,
//                  supply_score, capacity_count, nearest_processor_miles,
//                  metrics: { buyers, reservations, farms, listings, processors } }],
//     totals: { buyers, buyers_geocoded, reservations, farms, farms_geocoded,
//               listings, processors, processors_geocoded, hardware_leads },
//   }
//
// A hotspot is a market area (default 50-mile radius) where customer demand
// AND farmer supply are both present but processing capacity is thin. These
// are the prime target markets for PO hardware: a processor who buys hardware
// in a hotspot inherits built-in demand from day one.
//
// Scoring per candidate area:
//   demand  = buyers-in-area ×1 + active reservations ×3   (reservations are
//             located at the farm of the reserved listing — proven demand at
//             that geography; buyers are geocoded from their profile zip)
//   supply  = farms ×2 + active listings ×1
//   score   = sqrt(demand × supply) / (1 + processors within radius)
// The geometric mean means an area needs BOTH demand and supply to rank.
// Candidates come from grid-binning activity; greedy non-max suppression
// keeps returned hotspots non-overlapping; scores are normalized 0–100.
//
// Geocoding is cache-first (geocode_cache); at most a handful of fresh
// Nominatim lookups happen per request (new buyer zips only).

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { geocode } from './_lib/geocode.js';

export const config = { runtime: 'nodejs' };

// Scoring weights — tune as the marketplace matures.
const W_BUYER = 1;
const W_RESERVATION = 3;
const W_FARM = 2;
const W_LISTING = 1;
const MAX_FRESH_GEOCODES = 8; // cap fresh Nominatim lookups per request

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
  };
  const demand = [];   // { lat, lng, weight, label, counts }
  const supply = [];
  const capacity = [];

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
    // Cache-first; allow only a few fresh Nominatim lookups per request.
    const cached = await sql`
      SELECT lat, lng FROM geocode_cache WHERE query_key = ${zip} LIMIT 1`;
    let g = cached[0] || null;
    if (!g && freshLookups < MAX_FRESH_GEOCODES) {
      freshLookups++;
      g = await geocode({ zip }).catch(() => null);
    }
    if (!g) continue;
    totals.buyers_geocoded++;
    demand.push({
      lat: g.lat, lng: g.lng,
      weight: W_BUYER,
      label: null,
      counts: { buyers: 1 },
    });
  }

  // ── Capacity: every known processor ───────────────────────────
  const processors = await sql`SELECT id, name, city, state, lat, lng FROM processors`;
  for (const p of processors) {
    totals.processors++;
    if (p.lat == null || p.lng == null) continue;
    totals.processors_geocoded++;
    capacity.push({ lat: p.lat, lng: p.lng, counts: { processors: 1 } });
  }

  // ── Hardware leads (no geo yet — reported in totals only) ─────
  try {
    const hw = await sql`SELECT COUNT(*)::int AS c FROM hardware_leads`;
    totals.hardware_leads = hw[0]?.c || 0;
  } catch { /* table may not exist in fresh envs */ }

  return { demand, supply, capacity, totals };
}

function computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots) {
  const activity = demand.concat(supply);
  if (!activity.length) return [];

  // 1) Candidate centers: coarse grid bins (~half the market radius).
  const cellDeg = Math.max(radiusMiles / 2, 10) / 69; // ~69 miles per degree latitude
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

  // 2) Score every candidate against the full point sets within radius.
  const scored = [];
  for (const c of candidates) {
    const metrics = { buyers: 0, reservations: 0, farms: 0, listings: 0 };
    let demandScore = 0, supplyScore = 0, capacityCount = 0;
    const labels = new Map();
    for (const p of demand) {
      if (distanceMi(c.lat, c.lng, p.lat, p.lng) <= radiusMiles) {
        demandScore += p.weight;
        for (const k in p.counts) metrics[k] += p.counts[k];
        if (p.label) labels.set(p.label, (labels.get(p.label) || 0) + p.weight);
      }
    }
    for (const p of supply) {
      if (distanceMi(c.lat, c.lng, p.lat, p.lng) <= radiusMiles) {
        supplyScore += p.weight;
        for (const k in p.counts) metrics[k] += p.counts[k];
        if (p.label) labels.set(p.label, (labels.get(p.label) || 0) + p.weight);
      }
    }
    let nearestProcessor = Infinity;
    for (const p of capacity) {
      const d = distanceMi(c.lat, c.lng, p.lat, p.lng);
      if (d <= radiusMiles) capacityCount++;
      if (d < nearestProcessor) nearestProcessor = d;
    }

    // Geometric mean: a true hardware opportunity needs BOTH demand and supply.
    const raw = Math.sqrt(demandScore * supplyScore);
    if (raw <= 0) continue;
    let label = null, best = 0;
    for (const [k, v] of labels) if (v > best) { best = v; label = k; }
    scored.push({
      lat: Math.round(c.lat * 1e5) / 1e5,
      lng: Math.round(c.lng * 1e5) / 1e5,
      label,
      demand_score: Math.round(demandScore * 10) / 10,
      supply_score: Math.round(supplyScore * 10) / 10,
      capacity_count: capacityCount,
      nearest_processor_miles: nearestProcessor === Infinity ? null : Math.round(nearestProcessor),
      metrics,
      _score: raw / (1 + capacityCount),
    });
  }

  // 3) Greedy non-max suppression: keep the best, drop overlapping candidates.
  scored.sort((a, b) => b._score - a._score);
  const kept = [];
  for (const cand of scored) {
    if (kept.every(k => distanceMi(cand.lat, cand.lng, k.lat, k.lng) > radiusMiles)) {
      kept.push(cand);
    }
    if (kept.length >= maxHotspots) break;
  }

  // 4) Normalize scores to 0–100 for display.
  const top = kept.length ? kept[0]._score : 1;
  kept.forEach((h, i) => {
    h.rank = i + 1;
    h.opportunity_score = Math.round((top ? 100 * h._score / top : 0) * 10) / 10;
    delete h._score;
  });
  return kept;
}

async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const user = await currentUser(req).catch(() => null);
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'admin') return err(403, 'Admin only');

  const url = new URL(req.url, 'https://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const radiusMiles = Math.max(10, Math.min(Number(url.searchParams.get('radius_miles')) || 50, 250));
  const maxHotspots = Math.max(1, Math.min(Number(url.searchParams.get('max_hotspots')) || 25, 100));

  try {
    const { demand, supply, capacity, totals } = await loadPoints();
    const hotspots = computeHotspots(demand, supply, capacity, radiusMiles, maxHotspots);
    return json({ radius_miles: radiusMiles, hotspots, totals });
  } catch (e) {
    return err(500, 'admin-hotspots failed: ' + (e.message || 'unknown').slice(0, 200));
  }
}

export default nodejsHandler(handler);
