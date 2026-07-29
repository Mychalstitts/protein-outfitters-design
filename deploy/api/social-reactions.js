// /api/social-reactions — POST toggle heart; DELETE remove
import { sql, currentUser, err, json, isUuid, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOWED = new Set(['heart', 'fire', 'clap', 'pray']);

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const post_id = body.post_id;
    const emoji = ALLOWED.has(body.emoji) ? body.emoji : 'heart';
    if (!post_id || !isUuid(post_id)) return err(400, 'post_id required');

    const post = await sql`SELECT id FROM social_posts WHERE id = ${post_id} LIMIT 1`;
    if (!post[0]) return err(404, 'Post not found');

    const existing = await sql`
      SELECT 1 FROM social_reactions WHERE post_id = ${post_id} AND user_id = ${user.id} AND emoji = ${emoji}`;
    if (existing[0]) {
      await sql`DELETE FROM social_reactions WHERE post_id = ${post_id} AND user_id = ${user.id} AND emoji = ${emoji}`;
      const count = await sql`SELECT COUNT(*)::int AS n FROM social_reactions WHERE post_id = ${post_id} AND emoji = ${emoji}`;
      return json({ reacted: false, emoji, count: count[0]?.n || 0 });
    }
    await sql`
      INSERT INTO social_reactions (post_id, user_id, emoji)
      VALUES (${post_id}, ${user.id}, ${emoji})
      ON CONFLICT DO NOTHING`;
    const count = await sql`SELECT COUNT(*)::int AS n FROM social_reactions WHERE post_id = ${post_id} AND emoji = ${emoji}`;
    return json({ reacted: true, emoji, count: count[0]?.n || 0 });
  }

  if (req.method === 'DELETE') {
    const post_id = url.searchParams.get('post_id');
    const emoji = ALLOWED.has(url.searchParams.get('emoji')) ? url.searchParams.get('emoji') : 'heart';
    if (!post_id || !isUuid(post_id)) return err(400, 'post_id required');
    await sql`DELETE FROM social_reactions WHERE post_id = ${post_id} AND user_id = ${user.id} AND emoji = ${emoji}`;
    const count = await sql`SELECT COUNT(*)::int AS n FROM social_reactions WHERE post_id = ${post_id} AND emoji = ${emoji}`;
    return json({ reacted: false, emoji, count: count[0]?.n || 0 });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
