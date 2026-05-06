// /api/map-data — unified data source for the /map page
//
//   GET → {
//     farms: [{ id, slug, name, city, state, zip, lat, lng, listings_count, identity, certs }],
//     processors: [{ id, slug, name, city, state, lat, lng, capacity_per_week }],
//     demand: [{ state, zip, user_count, recent_reservations, lat, lng }],
//     opportunity: [{ zip, state, demand, nearest_processor_miles, hardware_target: bool }],
//   }
//
// Geocoding is cache-first via /api/_lib/geocode.js. If a row has no
// city/state we drop it from the result (can't plot it anyway). Demand is
// aggregated by zip from the users + reservations tables.
//
// Used by /map. Public read — no auth required for farms/processors;
// the demand + opportunity layers are returned to everyone but the UI
// only surfaces them to admins (so we don't leak strategic insight).

import { sql, currentUser, err, json } from './_lib/db.js';
import { geocode, MIDWEST_CENTROIDS } from './_lib/geocode.js';

export const config = { runtime: 'edge' };

// Haversine distance in miles between two lat/lng points
function distanceMi(a, b) {
  const R = 3959;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function loadFarms() {
  const rows = await sql`
    SELECT f.id, f.slug, f.name, f.city, f.state, f.zip, f.lat, f.lng,
           f.identity, f.certs, f.practices, f.avatar_url, f.cover_url,
           (SELECT COUNT(*)::int FROM listings l WHERE l.farm_id = f.id AND l.status = 'active') AS listings_count
    FROM farms f
    ORDER BY f.created_at DESC`;
  // Resolve any missing lat/lng on the fly. Edge runtime can do this in parallel
  // since geocode is cache-first.
  const out = [];
  for (const f of rows) {
    let { lat, lng } = f;
    if ((lat == null || lng == null) && f.city) {
      const g = await geocode({ city: f.city, state: f.state, zip: f.zip });
      if (g) { lat = g.lat; lng = g.lng;
        // Persist back for next time. Fire-and-forget.
        sql`UPDATE farms SET lat = ${g.lat}, lng = ${g.lng} WHERE id = ${f.id}`.catch(() => {});
      }
    }
    if (lat == null || lng == null) continue;
    out.push({
      id: f.id, slug: f.slug, name: f.name,
      city: f.city, state: f.state, zip: f.zip,
      lat, lng,
      listings_count: f.listings_count,
      identity: f.identity || [],
      certs: f.certs || [],
      practices: f.practices || [],
      avatar_url: f.avatar_url,
    });
  }
  return out;
}

async function loadProcessors() {
  const rows = await sql`
    SELECT p.id, p.slug, p.name, p.city, p.state, p.zip, p.lat, p.lng,
           p.bio, p.capacity_per_week, p.species, p.cover_url
    FROM processors p
    ORDER BY p.created_at DESC`;
  const out = [];
  for (const p of rows) {
    let { lat, lng } = p;
    if ((lat == null || lng == null) && p.city) {
      const g = await geocode({ city: p.city, state: p.state, zip: p.zip });
      if (g) { lat = g.lat; lng = g.lng;
        sql`UPDATE processors SET lat = ${g.lat}, lng = ${g.lng} WHERE id = ${p.id}`.catch(() => {});
      }
    }
    if (lat == null || lng == null) continue;
    out.push({
      id: p.id, slug: p.slug, name: p.name,
      city: p.city, state: p.state, zip: p.zip,
      lat, lng,
      capacity_per_week: p.capacity_per_week,
      species: p.species || [],
    });
  }
  return out;
}

async function loadDemand() {
  // Aggregate user signups + recent reservations by state+zip prefix.
  // We use ZIP-3 as the bucket so a single farm/buyer can't get pinpointed,
  // and so the heatmap renders as regional density rather than a noisy dot map.
  const rows = await sql`
    SELECT
      COALESCE(LEFT(u.zip, 3), '___') AS zip3,
      u.zip AS zip,
      COUNT(DISTINCT u.id)::int AS user_count,
      COUNT(DISTINCT r.id)::int AS reservation_count,
      MAX(u.zip) AS sample_zip
    FROM users u
    LEFT JOIN reservations r ON r.buyer_id = u.id AND r.created_at > NOW() - INTERVAL '90 days'
    WHERE u.role = 'buyer' AND u.zip IS NOT NULL
    GROUP BY zip3, u.zip
    ORDER BY user_count DESC
    LIMIT 500`;

  // Resolve each zip to a centroid via the geocode cache.
  const out = [];
  for (const r of rows) {
    if (!r.zip) continue;
    const g = await geocode({ zip: r.zip });
    if (!g) continue;
    out.push({
      zip: r.zip,
      zip3: r.zip3,
      user_count: r.user_count,
      reservation_count: r.reservation_count,
      lat: g.lat,
      lng: g.lng,
    });
  }
  return out;
}

async function buildOpportunity(processors, demand) {
  // Hardware sales targeting: zips with high demand but no processor within
  // 60 miles. These are the geographies where a new MHU / Friesla unit pays
  // back fastest because there's existing buyer demand and no infrastructure.
  const out = [];
  for (const d of demand) {
    let nearestMi = Infinity;
    for (const p of processors) {
      const m = distanceMi(d, p);
      if (m < nearestMi) nearestMi = m;
    }
    out.push({
      zip: d.zip,
      lat: d.lat,
      lng: d.lng,
      user_count: d.user_count,
      reservation_count: d.reservation_count,
      nearest_processor_miles: nearestMi === Infinity ? null : Math.round(nearestMi),
      hardware_target: nearestMi > 60 && d.user_count >= 1,
    });
  }
  // Sort by hardware-target potential first
  out.sort((a, b) => {
    if (a.hardware_target !== b.hardware_target) return a.hardware_target ? -1 : 1;
    return (b.user_count || 0) - (a.user_count || 0);
  });
  return out;
}

export default async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');

  // Demand + opportunity are admin-only (strategic data we don't surface
  // to the public). Farms + processors are public.
  const url = new URL(req.url);
  const layer = url.searchParams.get('layer'); // optional: 'farms', 'processors', 'demand', 'opportunity', or null=all

  const user = await currentUser(req).catch(() => null);
  const isAdmin = user?.role === 'admin';

  try {
    const farms = (layer === null || layer === 'farms' || !layer) ? await loadFarms() : [];
    const processors = (layer === null || layer === 'processors' || !layer || layer === 'opportunity') ? await loadProcessors() : [];
    let demand = [];
    let opportunity = [];
    if (isAdmin && (layer === null || layer === 'demand' || layer === 'opportunity' || !layer)) {
      demand = await loadDemand();
      if (layer === null || layer === 'opportunity' || !layer) {
        opportunity = await buildOpportunity(processors, demand);
      }
    }

    return json({
      farms,
      processors,
      demand: isAdmin ? demand : [],
      opportunity: isAdmin ? opportunity : [],
      counts: {
        farms: farms.length,
        processors: processors.length,
        demand_zips: demand.length,
        opportunity_targets: opportunity.filter(o => o.hardware_target).length,
      },
      is_admin: isAdmin,
    });
  } catch (e) {
    return err(500, 'map-data failed: ' + (e.message || 'unknown').slice(0, 200));
  }
}
