// /api/social-feed — GET ?mode=following|network
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { ensureSocialSchema } from './_lib/social.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  if (req.method !== 'GET') return err(405, 'GET only');
  try { await ensureSocialSchema(); } catch (e) {
    return err(500, 'Social schema unavailable: ' + String(e.message || e).slice(0, 120));
  }
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const mode = url.searchParams.get('mode') || 'following';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10), 60);
  const user = await currentUser(req);

  let rows;
  if (mode === 'following') {
    if (!user) return err(401, 'Sign in required');
    rows = await sql`
      SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
             CASE
               WHEN p.subject_type = 'farm' THEN (SELECT name FROM farms WHERE id = p.subject_id)
               WHEN p.subject_type = 'processor' THEN (SELECT name FROM processors WHERE id = p.subject_id)
               WHEN p.subject_type = 'listing' THEN (
                 SELECT COALESCE(l.number || ' · ', '') || COALESCE(l.breed, l.species, 'animal')
                 FROM listings l WHERE l.id = p.subject_id
               )
               ELSE NULL
             END AS subject_name
      FROM social_posts p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE p.visibility = 'public'
        AND (
          (p.subject_type = 'farm' AND (
            p.subject_id IN (SELECT farm_id FROM farm_follows WHERE user_id = ${user.id})
            OR p.subject_id IN (SELECT subject_id FROM entity_follows WHERE user_id = ${user.id} AND subject_type = 'farm')
          ))
          OR (p.subject_type = 'processor' AND p.subject_id IN (
            SELECT subject_id FROM entity_follows WHERE user_id = ${user.id} AND subject_type = 'processor'
          ))
          OR (p.listing_id IN (
            SELECT listing_id FROM reservations
            WHERE buyer_id = ${user.id} AND status NOT IN ('cancelled','refunded')
          ))
        )
      ORDER BY p.created_at DESC
      LIMIT ${limit}`;
  } else {
    rows = await sql`
      SELECT p.*, u.name AS author_name, u.avatar_url AS author_avatar,
             CASE
               WHEN p.subject_type = 'farm' THEN (SELECT name FROM farms WHERE id = p.subject_id)
               WHEN p.subject_type = 'processor' THEN (SELECT name FROM processors WHERE id = p.subject_id)
               WHEN p.subject_type = 'listing' THEN (
                 SELECT COALESCE(l.number || ' · ', '') || COALESCE(l.breed, l.species, 'animal')
                 FROM listings l WHERE l.id = p.subject_id
               )
               ELSE NULL
             END AS subject_name
      FROM social_posts p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE p.visibility = 'public'
      ORDER BY p.created_at DESC
      LIMIT ${limit}`;
  }

  const ids = rows.map(r => r.id);
  const reactMap = {};
  const myMap = {};
  const cMap = {};
  if (ids.length) {
    const reactions = await sql`
      SELECT post_id, emoji, COUNT(*)::int AS n FROM social_reactions
      WHERE post_id = ANY(${ids}) GROUP BY post_id, emoji`;
    for (const r of reactions) {
      if (!reactMap[r.post_id]) reactMap[r.post_id] = {};
      reactMap[r.post_id][r.emoji] = r.n;
    }
    if (user) {
      const mine = await sql`
        SELECT post_id, emoji FROM social_reactions
        WHERE post_id = ANY(${ids}) AND user_id = ${user.id}`;
      for (const r of mine) {
        if (!myMap[r.post_id]) myMap[r.post_id] = [];
        myMap[r.post_id].push(r.emoji);
      }
    }
    const comments = await sql`
      SELECT post_id, COUNT(*)::int AS n FROM social_comments
      WHERE post_id = ANY(${ids}) GROUP BY post_id`;
    for (const c of comments) cMap[c.post_id] = c.n;
  }

  return json({
    posts: rows.map(p => ({
      id: p.id,
      author_id: p.author_id,
      author_name: p.author_name || (p.kind === 'milestone' ? 'Protein Outfitters' : 'Member'),
      author_avatar: p.author_avatar,
      subject_type: p.subject_type,
      subject_id: p.subject_id,
      subject_name: p.subject_name,
      listing_id: p.listing_id,
      kind: p.kind,
      milestone: p.milestone,
      body: p.body,
      media_urls: p.media_urls || [],
      created_at: p.created_at,
      reaction_counts: reactMap[p.id] || {},
      my_reactions: myMap[p.id] || [],
      comment_count: cMap[p.id] || 0,
      can_delete: !!(user && (user.id === p.author_id || user.role === 'admin') && p.kind !== 'milestone'),
    })),
  });
}

export default nodejsHandler(handler);
