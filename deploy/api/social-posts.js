// /api/social-posts
//   GET  ?subject_type=&subject_id= | ?listing_id= | ?feed=following
//   POST { subject_type, subject_id, body, media_urls?, listing_id?, kind?, visibility? }
//   DELETE ?id=
import { sql, currentUser, err, json, isUuid, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function canPostOn(user, subject_type, subject_id) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (subject_type === 'farm') {
    const r = await sql`SELECT 1 FROM farms WHERE id = ${subject_id} AND owner_id = ${user.id} LIMIT 1`;
    return !!r[0];
  }
  if (subject_type === 'processor') {
    const r = await sql`SELECT 1 FROM processors WHERE id = ${subject_id} AND owner_id = ${user.id} LIMIT 1`;
    return !!r[0];
  }
  if (subject_type === 'listing') {
    const r = await sql`
      SELECT 1 FROM listings l JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${subject_id} AND f.owner_id = ${user.id} LIMIT 1`;
    return !!r[0];
  }
  if (subject_type === 'user') return subject_id === user.id;
  return false;
}

async function canSeePost(user, post) {
  if (post.visibility === 'public') return true;
  if (!user) return false;
  if (post.author_id === user.id || user.role === 'admin') return true;
  if (post.visibility === 'followers') {
    if (post.subject_type === 'farm') {
      const r = await sql`SELECT 1 FROM farm_follows WHERE user_id = ${user.id} AND farm_id = ${post.subject_id} LIMIT 1`;
      if (r[0]) return true;
    }
    const r = await sql`
      SELECT 1 FROM entity_follows
      WHERE user_id = ${user.id} AND subject_type = ${post.subject_type} AND subject_id = ${post.subject_id}
      LIMIT 1`;
    return !!r[0];
  }
  if (post.visibility === 'participants' && post.listing_id) {
    const r = await sql`
      SELECT 1 FROM reservations WHERE listing_id = ${post.listing_id} AND buyer_id = ${user.id}
        AND status NOT IN ('cancelled','refunded') LIMIT 1`;
    if (r[0]) return true;
    return await canPostOn(user, 'listing', post.listing_id);
  }
  return false;
}

async function enrichPosts(rows, user) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const reactions = await sql`
    SELECT post_id, emoji, COUNT(*)::int AS n
    FROM social_reactions WHERE post_id = ANY(${ids})
    GROUP BY post_id, emoji`;
  const myReact = user
    ? await sql`SELECT post_id, emoji FROM social_reactions WHERE post_id = ANY(${ids}) AND user_id = ${user.id}`
    : [];
  const comments = await sql`
    SELECT post_id, COUNT(*)::int AS n FROM social_comments WHERE post_id = ANY(${ids}) GROUP BY post_id`;

  const reactMap = {};
  for (const r of reactions) {
    if (!reactMap[r.post_id]) reactMap[r.post_id] = {};
    reactMap[r.post_id][r.emoji] = r.n;
  }
  const myMap = {};
  for (const r of myReact) {
    if (!myMap[r.post_id]) myMap[r.post_id] = [];
    myMap[r.post_id].push(r.emoji);
  }
  const cMap = {};
  for (const c of comments) cMap[c.post_id] = c.n;

  return rows.map(p => ({
    id: p.id,
    author_id: p.author_id,
    author_name: p.author_name || (p.kind === 'milestone' ? 'Protein Outfitters' : 'Member'),
    author_avatar: p.author_avatar || null,
    subject_type: p.subject_type,
    subject_id: p.subject_id,
    listing_id: p.listing_id,
    kind: p.kind,
    milestone: p.milestone,
    body: p.body,
    media_urls: p.media_urls || [],
    visibility: p.visibility,
    created_at: p.created_at,
    reaction_counts: reactMap[p.id] || {},
    my_reactions: myMap[p.id] || [],
    comment_count: cMap[p.id] || 0,
  }));
}

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const user = await currentUser(req);

  if (req.method === 'GET') {
    const listing_id = url.searchParams.get('listing_id');
    const subject_type = url.searchParams.get('subject_type');
    const subject_id = url.searchParams.get('subject_id');
    const feed = url.searchParams.get('feed');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 50);

    let rows = [];
    if (listing_id) {
      if (!isUuid(listing_id)) return err(400, 'Invalid listing_id');
      rows = await sql`
        SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar
        FROM social_posts p
        LEFT JOIN users u ON u.id = p.author_id
        WHERE p.listing_id = ${listing_id}
        ORDER BY p.created_at ASC
        LIMIT ${limit}`;
    } else if (feed === 'following') {
      if (!user) return err(401, 'Sign in required');
      rows = await sql`
        SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar
        FROM social_posts p
        LEFT JOIN users u ON u.id = p.author_id
        WHERE p.visibility = 'public'
          AND (
            (p.subject_type = 'farm' AND p.subject_id IN (SELECT farm_id FROM farm_follows WHERE user_id = ${user.id}))
            OR (p.subject_type = 'farm' AND p.subject_id IN (SELECT subject_id FROM entity_follows WHERE user_id = ${user.id} AND subject_type = 'farm'))
            OR (p.subject_type = 'processor' AND p.subject_id IN (SELECT subject_id FROM entity_follows WHERE user_id = ${user.id} AND subject_type = 'processor'))
            OR (p.listing_id IN (
              SELECT listing_id FROM reservations
              WHERE buyer_id = ${user.id} AND status NOT IN ('cancelled','refunded')
            ))
          )
        ORDER BY p.created_at DESC
        LIMIT ${limit}`;
    } else if (subject_type && subject_id) {
      if (!isUuid(subject_id)) return err(400, 'Invalid subject_id');
      rows = await sql`
        SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar
        FROM social_posts p
        LEFT JOIN users u ON u.id = p.author_id
        WHERE p.subject_type = ${subject_type} AND p.subject_id = ${subject_id}
        ORDER BY p.created_at DESC
        LIMIT ${limit}`;
    } else {
      rows = await sql`
        SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar
        FROM social_posts p
        LEFT JOIN users u ON u.id = p.author_id
        WHERE p.visibility = 'public'
        ORDER BY p.created_at DESC
        LIMIT ${limit}`;
    }

    const visible = [];
    for (const p of rows) {
      if (await canSeePost(user, p)) visible.push(p);
    }
    const posts = await enrichPosts(visible, user);
    return json({ posts });
  }

  if (req.method === 'POST') {
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const subject_type = body.subject_type;
    const subject_id = body.subject_id;
    const kind = body.kind || (body.media_urls?.length ? 'photo' : 'update');
    if (!['farm', 'processor', 'listing', 'user'].includes(subject_type)) {
      return err(400, 'Invalid subject_type');
    }
    if (!subject_id || !isUuid(subject_id)) return err(400, 'subject_id UUID required');
    if (kind === 'milestone') return err(403, 'Milestones are system-generated');
    if (!['update', 'photo', 'thanks'].includes(kind)) return err(400, 'Invalid kind');

    if (kind === 'thanks') {
      if (subject_type !== 'listing') return err(400, 'thanks must target a listing');
      const r = await sql`
        SELECT 1 FROM reservations WHERE listing_id = ${subject_id} AND buyer_id = ${user.id}
          AND status NOT IN ('cancelled','refunded') LIMIT 1`;
      if (!r[0] && user.role !== 'admin') return err(403, 'Reserve this animal before thanking');
    } else {
      const ok = await canPostOn(user, subject_type, subject_id);
      if (!ok) return err(403, 'You can only post on profiles you own');
    }

    const text = (body.body || '').trim();
    if (!text && !(body.media_urls && body.media_urls.length)) {
      return err(400, 'body or media_urls required');
    }
    if (text.length > 2000) return err(400, 'body too long (max 2000)');

    const media = Array.isArray(body.media_urls)
      ? body.media_urls.filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 6)
      : [];
    const visibility = ['public', 'followers', 'participants'].includes(body.visibility)
      ? body.visibility : 'public';
    const listing_id = body.listing_id && isUuid(body.listing_id)
      ? body.listing_id
      : (subject_type === 'listing' ? subject_id : null);

    const recent = await sql`
      SELECT COUNT(*)::int AS n FROM social_posts
      WHERE author_id = ${user.id} AND created_at > NOW() - INTERVAL '1 hour'`;
    if ((recent[0]?.n || 0) >= 20) return err(429, 'Post limit reached — try again later');

    const rows = await sql`
      INSERT INTO social_posts (
        author_id, subject_type, subject_id, listing_id, kind, body, media_urls, visibility
      ) VALUES (
        ${user.id}, ${subject_type}, ${subject_id}, ${listing_id},
        ${kind}, ${text || null}, ${media}, ${visibility}
      ) RETURNING *`;

    const enriched = await enrichPosts([{
      ...rows[0],
      author_name: user.name || user.email?.split('@')[0] || 'You',
      author_avatar: user.avatar_url || null,
    }], user);
    return json({ post: enriched[0] });
  }

  if (req.method === 'DELETE') {
    if (!user) return err(401, 'Sign in required');
    const id = url.searchParams.get('id');
    if (!id || !isUuid(id)) return err(400, 'id required');
    const rows = await sql`SELECT * FROM social_posts WHERE id = ${id} LIMIT 1`;
    if (!rows[0]) return err(404, 'Not found');
    if (rows[0].author_id !== user.id && user.role !== 'admin') {
      return err(403, 'Not your post');
    }
    if (rows[0].kind === 'milestone' && user.role !== 'admin') {
      return err(403, 'Cannot delete system milestones');
    }
    await sql`DELETE FROM social_posts WHERE id = ${id}`;
    return json({ ok: true });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
