// Social layer helpers — milestones + safe best-effort emit.
// Never throw into the calling request path; lifecycle must stay intact.
import { sql } from './db.js';

export const MILESTONE_COPY = {
  listed: (ctx) => (ctx.label ? `${ctx.label} is now reserving.` : 'A new animal is reserving.'),
  first_share_sold: (ctx) => `First share reserved on ${ctx.label || 'this animal'}.`,
  fully_sold: (ctx) => `${ctx.label || 'This animal'} is fully sold — plant booking next.`,
  plant_booked: (ctx) => (ctx.plant
    ? `Drop-off booked at ${ctx.plant}${ctx.date ? ' · ' + ctx.date : ''}.`
    : `Plant drop-off booked${ctx.date ? ' · ' + ctx.date : ''}.`),
  checked_in: (ctx) => (ctx.plant
    ? `Arrived at ${ctx.plant} — processing underway.`
    : 'Animal checked in at the plant.'),
  ready: () => 'Cuts are ready for pickup.',
  picked_up: () => 'Share picked up — freezer full.',
  review_unlocked: () => 'Reviews unlocked — tell the story of this animal.',
};

/**
 * Emit a journey milestone post for a listing.
 * Idempotent per (listing_id, milestone) — second call is a no-op.
 */
export async function emitMilestone({
  listing_id,
  milestone,
  body = null,
  author_id = null,
  media_urls = [],
  visibility = 'public',
  ctx = {},
} = {}) {
  try {
    if (!listing_id || !milestone) return null;

    const existing = await sql`
      SELECT id FROM social_posts
      WHERE listing_id = ${listing_id} AND milestone = ${milestone}
      LIMIT 1`;
    if (existing[0]) return existing[0];

    const text = body || (MILESTONE_COPY[milestone]
      ? MILESTONE_COPY[milestone](ctx)
      : milestone.replace(/_/g, ' '));

    const rows = await sql`
      INSERT INTO social_posts (
        author_id, subject_type, subject_id, listing_id,
        kind, milestone, body, media_urls, visibility
      ) VALUES (
        ${author_id},
        'listing',
        ${listing_id},
        ${listing_id},
        'milestone',
        ${milestone},
        ${text},
        ${media_urls},
        ${visibility}
      )
      RETURNING id`;
    return rows[0] || null;
  } catch (e) {
    console.error('[social.emitMilestone]', milestone, e.message || e);
    return null;
  }
}

/** Auto-follow a farm when a buyer reserves (best-effort). */
export async function autoFollowFarm(user_id, farm_id) {
  try {
    if (!user_id || !farm_id) return;
    await sql`
      INSERT INTO farm_follows (user_id, farm_id)
      VALUES (${user_id}, ${farm_id})
      ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO entity_follows (user_id, subject_type, subject_id)
      VALUES (${user_id}, 'farm', ${farm_id})
      ON CONFLICT DO NOTHING`;
  } catch (e) {
    console.error('[social.autoFollowFarm]', e.message || e);
  }
}

/** Whether listing shares are fully sold (no remaining available). */
export function sharesFullySold(shares) {
  if (!shares || typeof shares !== 'object') return false;
  let total = 0;
  let available = 0;
  for (const key of ['whole', 'half', 'quarter', 'eighth']) {
    const s = shares[key];
    if (!s) continue;
    total += Number(s.available || 0) + Number(s.reserved || 0);
    available += Number(s.available || 0);
  }
  return total > 0 && available === 0;
}

/**
 * Email followers when a ranch/plant posts a public update.
 * Caps at 40 recipients per post; one email per follower (deduped).
 */
export async function notifyFollowersOfPost({ post, authorName } = {}) {
  try {
    if (!post || post.visibility !== 'public') return { sent: 0 };
    if (!['farm', 'processor'].includes(post.subject_type)) return { sent: 0 };
    if (!['update', 'photo'].includes(post.kind)) return { sent: 0 };

    let followers = [];
    let subjectName = 'a ranch you follow';
    let href = 'https://www.proteinoutfitters.com/community';

    if (post.subject_type === 'farm') {
      const farm = await sql`SELECT id, name, slug FROM farms WHERE id = ${post.subject_id} LIMIT 1`;
      if (!farm[0]) return { sent: 0 };
      subjectName = farm[0].name;
      href = `https://www.proteinoutfitters.com/farm/${farm[0].slug}#community`;
      followers = await sql`
        SELECT DISTINCT u.id, u.email, u.name
        FROM (
          SELECT user_id FROM farm_follows WHERE farm_id = ${post.subject_id}
          UNION
          SELECT user_id FROM entity_follows
          WHERE subject_type = 'farm' AND subject_id = ${post.subject_id}
        ) f
        JOIN users u ON u.id = f.user_id
        WHERE u.email IS NOT NULL AND u.id IS DISTINCT FROM ${post.author_id}
        LIMIT 40`;
    } else {
      const plant = await sql`SELECT id, name, slug FROM processors WHERE id = ${post.subject_id} LIMIT 1`;
      if (!plant[0]) return { sent: 0 };
      subjectName = plant[0].name;
      href = plant[0].slug
        ? `https://www.proteinoutfitters.com/p/${plant[0].slug}`
        : 'https://www.proteinoutfitters.com/community';
      followers = await sql`
        SELECT DISTINCT u.id, u.email, u.name
        FROM entity_follows ef
        JOIN users u ON u.id = ef.user_id
        WHERE ef.subject_type = 'processor' AND ef.subject_id = ${post.subject_id}
          AND u.email IS NOT NULL AND u.id IS DISTINCT FROM ${post.author_id}
        LIMIT 40`;
    }

    if (!followers.length) return { sent: 0 };

    const { sendLifecycleEmail } = await import('./email.js');
    const preview = (post.body || 'Shared a new photo update.').slice(0, 160);
    let sent = 0;
    for (const f of followers) {
      try {
        const out = await sendLifecycleEmail('S1.follower_post', {
          to: f.email,
          buyer_name: f.name,
          ranch_name: subjectName,
          author_name: authorName || 'Someone',
          post_preview: preview,
          post_url: href,
          farm_id: post.subject_type === 'farm' ? post.subject_id : null,
          processor_id: post.subject_type === 'processor' ? post.subject_id : null,
          dedupKey: `S1::${post.id}::${f.id}`,
        });
        if (out.sent || out.skipped === 'no_api_key') sent++;
      } catch (_) { /* keep going */ }
    }
    return { sent };
  } catch (e) {
    console.error('[social.notifyFollowersOfPost]', e.message || e);
    return { sent: 0 };
  }
}
