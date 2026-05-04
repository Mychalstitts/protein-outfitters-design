// /api/listings
//   GET  ?species=&practice=&certs=&priceMax=&distance=&zip=&q= → array of listings (with farm info)
//   POST { ...listing } → create listing (auth + producer role required)
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
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
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '60'), 200);

  let rows;
  if (species && species !== 'all') {
    rows = await sql`
      SELECT l.*, f.slug as farm_slug, f.name as farm_name, f.city as farm_city, f.state as farm_state, f.zip as farm_zip, f.identity as farm_identity
      FROM listings l
      JOIN farms f ON f.id = l.farm_id
      WHERE l.status = ${status} AND l.species = ${species}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT l.*, f.slug as farm_slug, f.name as farm_name, f.city as farm_city, f.state as farm_state, f.zip as farm_zip, f.identity as farm_identity
      FROM listings l
      JOIN farms f ON f.id = l.farm_id
      WHERE l.status = ${status}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `;
  }

  return json({ listings: rows });
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

  // Verify farm ownership
  const farms = await sql`SELECT id FROM farms WHERE id = ${body.farm_id} AND owner_id = ${user.id} LIMIT 1`;
  if (!farms[0]) return err(403, 'You do not own that farm');

  const number = body.number || null;
  const breed = body.breed || null;
  const sex = body.sex || null;
  const birth_date = body.birth_date || null;
  const expected_finish_date = body.expected_finish_date || null;
  const current_weight = body.current_weight || null;
  const estimated_finish_weight = body.estimated_finish_weight || null;
  const estimated_hanging_weight = body.estimated_hanging_weight || null;
  const price_per_lb = body.price_per_lb || null;
  const description = body.description || null;
  const practice = body.practice || [];
  const certs = body.certs || [];
  const shares = body.shares || {};
  const photos = body.photos || [];
  const status = body.status || 'active';
  const donate_to_foodbank = !!body.donate_to_foodbank;
  const donation_recipient_org = body.donation_recipient_org || null;

  const rows = await sql`
    INSERT INTO listings (farm_id, number, species, breed, sex, birth_date, expected_finish_date, current_weight, estimated_finish_weight, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, photos, status, donate_to_foodbank, donation_recipient_org)
    VALUES (${body.farm_id}, ${number}, ${body.species}, ${breed}, ${sex}, ${birth_date}, ${expected_finish_date}, ${current_weight}, ${estimated_finish_weight}, ${estimated_hanging_weight}, ${price_per_lb}, ${description}, ${practice}, ${certs}, ${shares}, ${photos}, ${status}, ${donate_to_foodbank}, ${donation_recipient_org})
    RETURNING *
  `;
  return json({ listing: rows[0] });
}
