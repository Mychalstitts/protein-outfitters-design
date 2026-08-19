// /api/listings
//   GET  ?species=&practice=&certs=&priceMax=&distance=&zip=&q= → array of listings (with farm info)
//   POST { ...listing } → create listing (auth + producer role required)
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { emitMilestone } from './_lib/social.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));

  if (req.method === 'GET') {
    // Non-active statuses (draft / withdrawn) are moderation views — admin only,
    // so unpublished or pulled listings aren't publicly enumerable.
    const st = url.searchParams.get('status');
    if (st && st !== 'active') {
      const user = await currentUser(req);
      if (!user || user.role !== 'admin') return err(403, 'Admin access required for non-active listings');
    }
    return await listListings(url);
  }
  if (req.method === 'POST') {
    return await createListing(req);
  }
  return err(405, 'Method not allowed');
}

async function listListings(url) {
  const species = url.searchParams.get('species');
  const status = url.searchParams.get('status') || 'active';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 300);

  let rows;
  if (species && species !== 'all') {
    rows = await sql`
      SELECT l.*, f.slug as farm_slug, f.name as farm_name, f.city as farm_city, f.state as farm_state, f.zip as farm_zip, f.lat as farm_lat, f.lng as farm_lng, f.identity as farm_identity,             ROUND(rs.avg_rating::numeric, 1) as farm_avg_rating, rs.review_count as farm_review_count
      FROM listings l
      JOIN farms f ON f.id = l.farm_id
      LEFT JOIN (
        SELECT subject_id, AVG(rating)::float AS avg_rating, COUNT(*)::int AS review_count
        FROM reviews
        WHERE subject_type = 'farm' AND rating IS NOT NULL
        GROUP BY subject_id
      ) rs ON rs.subject_id = f.id
      WHERE l.status = ${status} AND l.species = ${species}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT l.*, f.slug as farm_slug, f.name as farm_name, f.city as farm_city, f.state as farm_state, f.zip as farm_zip, f.lat as farm_lat, f.lng as farm_lng, f.identity as farm_identity,             ROUND(rs.avg_rating::numeric, 1) as farm_avg_rating, rs.review_count as farm_review_count
      FROM listings l
      JOIN farms f ON f.id = l.farm_id
      LEFT JOIN (
        SELECT subject_id, AVG(rating)::float AS avg_rating, COUNT(*)::int AS review_count
        FROM reviews
        WHERE subject_type = 'farm' AND rating IS NOT NULL
        GROUP BY subject_id
      ) rs ON rs.subject_id = f.id
      WHERE l.status = ${status}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `;
  }

  return json({ listings: rows });
}

const ALLOWED_SPECIES = new Set(['cattle', 'hog', 'lamb', 'sheep', 'poultry', 'bison', 'goat', 'venison']);
const ALLOWED_STATUS = new Set(['active', 'draft', 'withdrawn']);
const SHARE_KEYS = ['whole', 'half', 'quarter', 'eighth'];

function normalizeShares(raw, pricePerLb) {
  const base = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const defaults = {
    whole:   { available: 1, reserved: 0, price: pricePerLb },
    half:    { available: 2, reserved: 0, price: pricePerLb },
    quarter: { available: 4, reserved: 0, price: pricePerLb },
  };
  const out = {};
  for (const key of SHARE_KEYS) {
    const src = base[key] || defaults[key];
    if (!src) continue;
    const price = Number(src.price ?? pricePerLb ?? 0);
    const available = Math.max(0, Math.min(32, parseInt(src.available ?? defaults[key]?.available ?? 0, 10) || 0));
    const reserved = Math.max(0, parseInt(src.reserved ?? 0, 10) || 0);
    if (!Number.isFinite(price) || price < 0) continue;
    out[key] = { available, reserved, price: Math.round(price * 100) / 100 };
  }
  return out;
}

async function createListing(req) {
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'producer' && user.role !== 'admin') {
    return err(403, 'Only producers can create listings');
  }
  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  if (!body.farm_id) return err(400, 'farm_id required');
  if (!body.species) return err(400, 'species required');

  const species = String(body.species).toLowerCase().trim();
  if (!ALLOWED_SPECIES.has(species)) {
    return err(400, `species must be one of: ${[...ALLOWED_SPECIES].join(', ')}`);
  }

  // Verify farm ownership
  const farms = await sql`SELECT id FROM farms WHERE id = ${body.farm_id} AND owner_id = ${user.id} LIMIT 1`;
  if (!farms[0]) return err(403, 'You do not own that farm');

  const number = body.number ? String(body.number).slice(0, 64) : null;
  const breed = body.breed ? String(body.breed).slice(0, 120) : null;
  const sex = body.sex ? String(body.sex).toLowerCase().slice(0, 40) : null;
  const birth_date = body.birth_date || null;
  const expected_finish_date = body.expected_finish_date || null;
  const isoDate = (v) => {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const harvest_window_start = isoDate(body.harvest_window_start || body.expected_finish_date);
  const harvest_window_end = isoDate(body.harvest_window_end);
  const after_thirty_months = !!(body.after_thirty_months || body.past_30_months);
  const bone_in_allowed = body.bone_in_allowed === false ? false : (body.bone_in_allowed === true ? true : true);
  const otm_price_pending = !!body.otm_price_pending;
  const current_weight = body.current_weight != null ? Number(body.current_weight) : null;
  const estimated_finish_weight = body.estimated_finish_weight != null ? Number(body.estimated_finish_weight) : null;
  const estimated_hanging_weight = body.estimated_hanging_weight != null ? Number(body.estimated_hanging_weight) : null;
  const price_per_lb = body.price_per_lb != null ? Number(body.price_per_lb) : null;
  const description = body.description ? String(body.description).slice(0, 4000) : null;
  const practice = Array.isArray(body.practice) ? body.practice.map(String).slice(0, 20) : [];
  const certs = Array.isArray(body.certs) ? body.certs.map(String).slice(0, 20) : [];
  const photos = Array.isArray(body.photos) ? body.photos.map(String).filter(u => /^https?:\/\//i.test(u) || u.startsWith('/')).slice(0, 12) : [];
  let status = ALLOWED_STATUS.has(body.status) ? body.status : 'active';
  const listedNumber = number || '';
  const isStittyDraft = /^(#?123)\b/i.test(listedNumber) || /stitt/i.test(listedNumber);
  if (isStittyDraft || (otm_price_pending && !(Number.isFinite(price_per_lb) && price_per_lb > 0))) {
    status = 'draft';
  }
  const donate_to_foodbank = !!body.donate_to_foodbank;
  const donation_recipient_org = body.donation_recipient_org || null;

  // Active listings must be sellable: positive price + at least one share with inventory.
  if (status === 'active') {
    if (!Number.isFinite(price_per_lb) || price_per_lb <= 0) {
      return err(400, 'price_per_lb must be greater than 0 to publish');
    }
    if (price_per_lb > 200) {
      return err(400, 'price_per_lb looks unrealistic (max $200/lb)');
    }
  }

  const shares = normalizeShares(body.shares, price_per_lb || 0);
  if (status === 'active') {
    const hasInventory = SHARE_KEYS.some(k => shares[k] && shares[k].available > 0 && shares[k].price > 0);
    if (!hasInventory) {
      return err(400, 'At least one share size needs available inventory and a price > 0');
    }
  }

  if (estimated_hanging_weight != null && (!Number.isFinite(estimated_hanging_weight) || estimated_hanging_weight <= 0 || estimated_hanging_weight > 5000)) {
    return err(400, 'estimated_hanging_weight must be between 1 and 5000 lb');
  }

  const feed_type   = body.feed_type   || null;
  const finish_feed = body.finish_feed || null;
  const subbreed    = body.subbreed    || null;
  const sex_detail  = body.sex_detail  || null;
  const antibiotics = body.antibiotics || null;
  const hormones    = body.hormones    || null;

  const rows = await sql`
    INSERT INTO listings (farm_id, number, species, breed, sex, birth_date, expected_finish_date, harvest_window_start, harvest_window_end, after_thirty_months, bone_in_allowed, otm_price_pending, current_weight, estimated_finish_weight, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, photos, status, donate_to_foodbank, donation_recipient_org, feed_type, finish_feed, subbreed, sex_detail, antibiotics, hormones)
    VALUES (${body.farm_id}, ${number}, ${species}, ${breed}, ${sex}, ${birth_date}, ${expected_finish_date}, ${harvest_window_start}, ${harvest_window_end}, ${after_thirty_months}, ${bone_in_allowed}, ${otm_price_pending}, ${current_weight}, ${estimated_finish_weight}, ${estimated_hanging_weight}, ${price_per_lb}, ${description}, ${practice}, ${certs}, ${shares}, ${photos}, ${status}, ${donate_to_foodbank}, ${donation_recipient_org}, ${feed_type}, ${finish_feed}, ${subbreed}, ${sex_detail}, ${antibiotics}, ${hormones})
    RETURNING *
  `;
  const listing = rows[0];
  if (listing && listing.status === 'active') {
    const label = `${listing.number ? listing.number + ' · ' : ''}${listing.breed || listing.species || 'animal'}`;
    try {
      await emitMilestone({
        listing_id: listing.id,
        milestone: 'listed',
        author_id: user.id,
        ctx: { label },
      });
    } catch (_) { /* social best-effort */ }
  }
  return json({ listing });
}

export default nodejsHandler(handler);
