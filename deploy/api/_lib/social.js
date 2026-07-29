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
