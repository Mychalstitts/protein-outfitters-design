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

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { geocodeSync, MIDWEST_CENTROIDS } from './_lib/geocode.js';

export const config = { runtime: 'nodejs' };

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
  // Use stored lat/lng if present; fall back to synchronous Midwest/state
  // centroid lookup. We never block the request on Nominatim — the admin
  // backfill job handles precise geocoding offline.
  const out = [];
  for (const f of rows) {
    let { lat, lng } = f;
    if ((lat == null || lng == null) && (f.city || f.state)) {
      const g = geocodeSync({ city: f.city, state: f.state });
      if (g) { lat = g.lat; lng = g.lng; }
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
           p.bio, p.inspection, p.capabilities, p.cover_url, p.owner_id
    FROM processors p
    ORDER BY p.created_at DESC`;
  const out = [];
  for (const p of rows) {
    let { lat, lng } = p;
    if ((lat == null || lng == null) && (p.city || p.state)) {
      const g = geocodeSync({ city: p.city, state: p.state });
      if (g) { lat = g.lat; lng = g.lng; }
    }
    if (lat == null || lng == null) continue;
    // Pull species from the capabilities JSONB blob if present
    const species = Array.isArray(p.capabilities?.species) ? p.capabilities.species : [];
    out.push({
      id: p.id, slug: p.slug, name: p.name,
      city: p.city, state: p.state, zip: p.zip,
      lat, lng,
      inspection: p.inspection,
      species,
      claimable: !p.owner_id,
    });
  }
  return out;
}

async function loadDemand() {
  // Aggregate buyer signups + recent reservations clustered at the state level
  // (since we only have ZIP, not city, on user rows). When buyer profiles
  // start carrying city, we can switch to per-city or per-zip-prefix clustering.
  const rows = await sql`
    SELECT
      COALESCE(LOWER(LEFT(u.zip, 1)), '_') AS zip_region,
      u.zip AS zip,
      COUNT(DISTINCT u.id)::int AS user_count,
      COUNT(DISTINCT r.id)::int AS reservation_count
    FROM users u
    LEFT JOIN reservations r ON r.buyer_id = u.id AND r.created_at > NOW() - INTERVAL '90 days'
    WHERE u.role = 'buyer' AND u.zip IS NOT NULL
    GROUP BY u.zip
    ORDER BY user_count DESC
    LIMIT 500`;

  // Map US ZIP first-digit → state-region centroid. Crude but useful as a
  // signal-not-noise visualization. Buyers in 5xxxx → MN/WI/MI region;
  // 6xxxx → IA/NE/IL/MO; etc. When user profiles get city/state we'll
  // switch to per-city.
  const REGION_BY_ZIP_FIRST = {
    '0': 'ma', '1': 'pa', '2': 'va', '3': 'fl', '4': 'mi',
    '5': 'mn', '6': 'ia', '7': 'tx', '8': 'co', '9': 'ca',
  };
  const byRegion = {};
  for (const r of rows) {
    if (!r.zip) continue;
    const firstDigit = String(r.zip).charAt(0);
    const region = REGION_BY_ZIP_FIRST[firstDigit] || 'mn';
    if (!byRegion[region]) byRegion[region] = { user_count: 0, reservation_count: 0, zips: [], region };
    byRegion[region].user_count += r.user_count;
    byRegion[region].reservation_count += r.reservation_count;
    byRegion[region].zips.push(r.zip);
  }
  const out = [];
  for (const [region, agg] of Object.entries(byRegion)) {
    const g = geocodeSync({ state: region });
    if (!g) continue;
    out.push({
      zip: agg.zips[0] || region.toUpperCase(),
      zip3: '',
      user_count: agg.user_count,
      reservation_count: agg.reservation_count,
      lat: g.lat,
      lng: g.lng,
    });
  }
  return out;
}

// Discovered prospects — farms / processors found in public datasets
// (USDA FSIS, AAMP, EatWild, Google Places) but not yet signed up. This
// is the recruiting funnel.
async function loadProspects() {
  const rows = await sql`
    SELECT id, kind, name, city, state, zip, lat, lng,
           phone, email, website, source, invite_status
    FROM discovered_partners
    WHERE invite_status NOT IN ('dnc', 'signed_up', 'declined')
    ORDER BY
      CASE invite_status WHEN 'new' THEN 0 WHEN 'queued' THEN 1 WHEN 'sent' THEN 2 WHEN 'clicked' THEN 3 ELSE 4 END
    LIMIT 1000`;
  const out = [];
  for (const r of rows) {
    let { lat, lng } = r;
    if ((lat == null || lng == null) && (r.city || r.state)) {
      const g = geocodeSync({ city: r.city, state: r.state });
      if (g) { lat = g.lat; lng = g.lng; }
    }
    if (lat == null || lng == null) continue;
    out.push({
      id: r.id,
      kind: r.kind,
      name: r.name,
      city: r.city, state: r.state, zip: r.zip,
      lat, lng,
      phone: r.phone, email: r.email, website: r.website,
      source: r.source,
      invite_status: r.invite_status,
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

// Tier model — admin gets everything; everyone else is gated.
//   free      → farms + processors only
//   pro       → + demand heatmap + activity pulses
//   hardware  → + opportunity zones + recruiting prospects
function tierForUser(user) {
  if (!user) return 'free';
  if (user.role === 'admin') return 'hardware';
  const t = (user.map_tier || 'free').toString().toLowerCase();
  if (t === 'hardware' || t === 'pro' || t === 'free') return t;
  return 'free';
}

function canSee(tier, layer) {
  if (layer === 'farms' || layer === 'processors') return true;
  if (layer === 'demand') return tier === 'pro' || tier === 'hardware';
  if (layer === 'opportunity' || layer === 'prospects') return tier === 'hardware';
  return false;
}

async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');

  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const layer = url.searchParams.get('layer');

  const user = await currentUser(req).catch(() => null);
  const tier = tierForUser(user);
  const isAdmin = user?.role === 'admin';

  try {
    const farms = (layer === null || layer === 'farms' || !layer) ? await loadFarms() : [];
    // Need processors for opportunity computation even if user can't view processors layer.
    const needProcessors = layer === null || layer === 'processors' || !layer || layer === 'opportunity';
    const processors = needProcessors ? await loadProcessors() : [];

    let demand = [];
    let opportunity = [];
    let prospects = [];
    if (canSee(tier, 'demand') && (layer === null || layer === 'demand' || layer === 'opportunity' || !layer)) {
      demand = await loadDemand();
    }
    if (canSee(tier, 'opportunity') && (layer === null || layer === 'opportunity' || !layer)) {
      if (!demand.length) demand = await loadDemand();
      opportunity = await buildOpportunity(processors, demand);
    }
    if (canSee(tier, 'prospects') && (layer === null || layer === 'prospects' || !layer)) {
      prospects = await loadProspects();
    }

    return json({
      farms,
      processors,
      demand: canSee(tier, 'demand') ? demand : [],
      opportunity: canSee(tier, 'opportunity') ? opportunity : [],
      prospects: canSee(tier, 'prospects') ? prospects : [],
      counts: {
        farms: farms.length,
        processors: processors.length,
        demand_zips: demand.length,
        opportunity_targets: opportunity.filter(o => o.hardware_target).length,
        prospects_new: prospects.filter(p => p.invite_status === 'new').length,
      },
      tier,
      is_admin: isAdmin,
      locked: {
        demand: !canSee(tier, 'demand'),
        opportunity: !canSee(tier, 'opportunity'),
        prospects: !canSee(tier, 'prospects'),
      },
    });
  } catch (e) {
    return err(500, 'map-data failed: ' + (e.message || 'unknown').slice(0, 200));
  }
}

export default nodejsHandler(handler);
