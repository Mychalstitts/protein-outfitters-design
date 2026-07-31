// /api/social-comments
//   GET  ?post_id=
//   POST { post_id, body }
//   DELETE ?id=
import { sql, currentUser, err, json, isUuid, nodejsHandler } from './_lib/db.js';
import { ensureSocialSchema } from './_lib/social.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  try { await ensureSocialSchema(); } catch (e) {
    return err(500, 'Social schema unavailable: ' + String(e.message || e).slice(0, 120));
  }
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));

  if (req.method === 'GET') {
    const post_id = url.searchParams.get('post_id');
    if (!post_id || !isUuid(post_id)) return err(400, 'post_id required');
    const rows = await sql`
      SELECT c.id, c.body, c.created_at, c.author_id, u.name AS author_name, u.avatar_url AS author_avatar
      FROM social_comments c
      LEFT JOIN users u ON u.id = c.author_id
      WHERE c.post_id = ${post_id}
      ORDER BY c.created_at ASC
      LIMIT 100`;
    return json({
      comments: rows.map(c => ({
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        author_id: c.author_id,
        author_name: c.author_name || 'Member',
        author_avatar: c.author_avatar,
      })),
    });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const post_id = body.post_id;
    const text = (body.body || '').trim();
    if (!post_id || !isUuid(post_id)) return err(400, 'post_id required');
    if (!text || text.length > 1000) return err(400, 'body required (max 1000)');

    const post = await sql`SELECT id FROM social_posts WHERE id = ${post_id} LIMIT 1`;
    if (!post[0]) return err(404, 'Post not found');

    const rows = await sql`
      INSERT INTO social_comments (post_id, author_id, body)
      VALUES (${post_id}, ${user.id}, ${text})
      RETURNING id, body, created_at, author_id`;
    return json({
      comment: {
        ...rows[0],
        author_name: user.name || user.email?.split('@')[0] || 'You',
        author_avatar: user.avatar_url || null,
      },
    });
  }

  if (req.method === 'DELETE') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const id = url.searchParams.get('id');
    if (!id || !isUuid(id)) return err(400, 'id required');
    const rows = await sql`SELECT * FROM social_comments WHERE id = ${id} LIMIT 1`;
    if (!rows[0]) return err(404, 'Not found');
    if (rows[0].author_id !== user.id && user.role !== 'admin') return err(403, 'Not your comment');
    await sql`DELETE FROM social_comments WHERE id = ${id}`;
    return json({ ok: true });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
