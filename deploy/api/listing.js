// /api/listing?id=UUID
//   GET   → single listing with farm details
//   PATCH → update (auth + ownership)
//   DELETE → withdraw (sets status='withdrawn')
import { sql, rawQuery, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return err(400, 'id required');
  // UUID v4-ish guard so a bad ?id= doesn't blow up the SQL cast
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return err(404, 'Listing not found');
  }

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT l.*, f.slug as farm_slug, f.name as farm_name, f.bio as farm_bio,
             f.city as farm_city, f.state as farm_state, f.zip as farm_zip,
             f.identity as farm_identity, f.practices as farm_practices,
             f.cover_url as farm_cover, f.avatar_url as farm_avatar
      FROM listings l
      JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${id}
      LIMIT 1
    `;
    if (!rows[0]) return err(404, 'Listing not found');
    // Increment view count fire-and-forget
    sql`UPDATE listings SET view_count = view_count + 1 WHERE id = ${id}`.catch(() => {});
    return json({ listing: rows[0] });
  }

  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const owns = await sql`
      SELECT l.id FROM listings l JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${id} AND f.owner_id = ${user.id} LIMIT 1
    `;
    if (!owns[0] && user.role !== 'admin') return err(403, 'Not your listing');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const allowed = ['number','breed','sex','expected_finish_date','estimated_hanging_weight','price_per_lb','description','practice','certs','shares','photos','status','donate_to_foodbank','donation_recipient_org','instant_reserve'];
    const set = {};
    for (const k of allowed) if (k in body) set[k] = body[k];
    if (!Object.keys(set).length) return err(400, 'Nothing to update');
    // Build dynamic update — limited keys, safe (column names whitelisted above)
    for (const [k, v] of Object.entries(set)) {
      await rawQuery(`UPDATE listings SET ${k} = $1, updated_at = NOW() WHERE id = $2`, [v, id]);
    }
    const updated = await sql`SELECT * FROM listings WHERE id = ${id}`;
    return json({ listing: updated[0] });
  }

  if (req.method === 'DELETE') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const owns = await sql`
      SELECT l.id FROM listings l JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${id} AND f.owner_id = ${user.id} LIMIT 1
    `;
    if (!owns[0] && user.role !== 'admin') return err(403, 'Not your listing');
    await sql`UPDATE listings SET status = 'withdrawn', updated_at = NOW() WHERE id = ${id}`;
    return json({ ok: true });
  }

  return err(405, 'Method not allowed');
}
