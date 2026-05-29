// /api/farm-follow
//   POST   { farm_id }       → follow this farm   (idempotent: re-following is a no-op)
//   DELETE ?farm_id=UUID     → unfollow this farm
//   GET    ?farm_id=UUID     → { following: bool, count: int }  — is the signed-in user
//                              currently following this farm + total followers
//
// Sign-in required for POST/DELETE. GET works anonymously and returns
// { following: false, count } so unauthenticated visitors still see the
// total follower count on the farm profile page.
import { sql, currentUser, json, err, isUuid, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));

  // ── GET: is-following + total count ────────────────────
  if (req.method === 'GET') {
    const farm_id = url.searchParams.get('farm_id');
    if (!farm_id || !isUuid(farm_id)) return err(400, 'farm_id (UUID) required');

    const countRow = await sql`SELECT COUNT(*)::int AS n FROM farm_follows WHERE farm_id = ${farm_id}`;
    const count = countRow[0]?.n || 0;

    const user = await currentUser(req);
    let following = false;
    if (user) {
      const row = await sql`SELECT 1 FROM farm_follows WHERE user_id = ${user.id} AND farm_id = ${farm_id} LIMIT 1`;
      following = !!row[0];
    }
    return json({ following, count });
  }

  // ── POST: follow ──────────────────────────────────────
  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const farm_id = body.farm_id;
    if (!farm_id || !isUuid(farm_id)) return err(400, 'farm_id (UUID) required');

    const farmExists = await sql`SELECT id FROM farms WHERE id = ${farm_id} LIMIT 1`;
    if (!farmExists[0]) return err(404, 'Farm not found');

    // ON CONFLICT DO NOTHING — following twice is a no-op success.
    await sql`
      INSERT INTO farm_follows (user_id, farm_id)
      VALUES (${user.id}, ${farm_id})
      ON CONFLICT (user_id, farm_id) DO NOTHING
    `;
    const countRow = await sql`SELECT COUNT(*)::int AS n FROM farm_follows WHERE farm_id = ${farm_id}`;
    return json({ following: true, count: countRow[0]?.n || 0 });
  }

  // ── DELETE: unfollow ──────────────────────────────────
  if (req.method === 'DELETE') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const farm_id = url.searchParams.get('farm_id');
    if (!farm_id || !isUuid(farm_id)) return err(400, 'farm_id (UUID) required');

    await sql`DELETE FROM farm_follows WHERE user_id = ${user.id} AND farm_id = ${farm_id}`;
    const countRow = await sql`SELECT COUNT(*)::int AS n FROM farm_follows WHERE farm_id = ${farm_id}`;
    return json({ following: false, count: countRow[0]?.n || 0 });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
