// /api/entity-follow — follow farm or processor; dual-writes farm_follows
import { sql, currentUser, err, json, isUuid, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));

  if (req.method === 'GET') {
    const subject_type = url.searchParams.get('subject_type');
    const subject_id = url.searchParams.get('subject_id');
    if (!['farm', 'processor'].includes(subject_type) || !subject_id || !isUuid(subject_id)) {
      return err(400, 'subject_type and subject_id required');
    }
    let count = 0;
    if (subject_type === 'farm') {
      const legacy = await sql`SELECT COUNT(*)::int AS n FROM farm_follows WHERE farm_id = ${subject_id}`;
      const entity = await sql`
        SELECT COUNT(*)::int AS n FROM entity_follows
        WHERE subject_type = 'farm' AND subject_id = ${subject_id}`;
      count = Math.max(legacy[0]?.n || 0, entity[0]?.n || 0);
    } else {
      const entity = await sql`
        SELECT COUNT(*)::int AS n FROM entity_follows
        WHERE subject_type = ${subject_type} AND subject_id = ${subject_id}`;
      count = entity[0]?.n || 0;
    }
    const user = await currentUser(req);
    let following = false;
    if (user) {
      const row = await sql`
        SELECT 1 FROM entity_follows
        WHERE user_id = ${user.id} AND subject_type = ${subject_type} AND subject_id = ${subject_id}
        LIMIT 1`;
      following = !!row[0];
      if (!following && subject_type === 'farm') {
        const leg = await sql`SELECT 1 FROM farm_follows WHERE user_id = ${user.id} AND farm_id = ${subject_id} LIMIT 1`;
        following = !!leg[0];
      }
    }
    return json({ following, count });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const subject_type = body.subject_type;
    const subject_id = body.subject_id;
    if (!['farm', 'processor'].includes(subject_type) || !subject_id || !isUuid(subject_id)) {
      return err(400, 'subject_type and subject_id required');
    }
    if (subject_type === 'farm') {
      const f = await sql`SELECT id FROM farms WHERE id = ${subject_id} LIMIT 1`;
      if (!f[0]) return err(404, 'Farm not found');
      await sql`INSERT INTO farm_follows (user_id, farm_id) VALUES (${user.id}, ${subject_id}) ON CONFLICT DO NOTHING`;
    } else {
      const p = await sql`SELECT id FROM processors WHERE id = ${subject_id} LIMIT 1`;
      if (!p[0]) return err(404, 'Processor not found');
    }
    await sql`
      INSERT INTO entity_follows (user_id, subject_type, subject_id)
      VALUES (${user.id}, ${subject_type}, ${subject_id})
      ON CONFLICT DO NOTHING`;
    const countRow = await sql`
      SELECT COUNT(*)::int AS n FROM entity_follows
      WHERE subject_type = ${subject_type} AND subject_id = ${subject_id}`;
    return json({ following: true, count: countRow[0]?.n || 0 });
  }

  if (req.method === 'DELETE') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const subject_type = url.searchParams.get('subject_type');
    const subject_id = url.searchParams.get('subject_id');
    if (!['farm', 'processor'].includes(subject_type) || !subject_id || !isUuid(subject_id)) {
      return err(400, 'subject_type and subject_id required');
    }
    await sql`
      DELETE FROM entity_follows
      WHERE user_id = ${user.id} AND subject_type = ${subject_type} AND subject_id = ${subject_id}`;
    if (subject_type === 'farm') {
      await sql`DELETE FROM farm_follows WHERE user_id = ${user.id} AND farm_id = ${subject_id}`;
    }
    const countRow = await sql`
      SELECT COUNT(*)::int AS n FROM entity_follows
      WHERE subject_type = ${subject_type} AND subject_id = ${subject_id}`;
    return json({ following: false, count: countRow[0]?.n || 0 });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
