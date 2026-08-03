// /api/cron-sweep-pending — release abandoned checkout inventory on a schedule.
//
// Vercel Cron hits this path with Authorization: Bearer $CRON_SECRET.
// Finds `pending` reservations with no stripe_payment_intent older than
// older_than_minutes (default 30), restores listing share inventory, and
// cancels those holds so buyers can still reserve after abandoned Stripe sessions.
//
// Also accepts ?secret=$MIGRATE_SECRET or $CRON_SECRET for manual ops runs.
// GET = preview counts. POST (or cron GET with auth) = execute.

import { sql, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

function authorized(req, url) {
  // Vercel Cron sets x-vercel-cron (stripped from external requests).
  const isVercelCron = !!(req.headers.get && req.headers.get('x-vercel-cron'));
  if (isVercelCron) return true;
  const secret = url.searchParams.get('secret') || '';
  const migrate = process.env.MIGRATE_SECRET || '';
  const cron = process.env.CRON_SECRET || '';
  if (migrate && secret === migrate) return true;
  if (cron && secret === cron) return true;
  const auth = req.headers.get('authorization') || '';
  if (cron && auth === `Bearer ${cron}`) return true;
  return false;
}

async function sweep(olderMin) {
  const leaked = await sql`
    SELECT r.id, r.listing_id, r.share_size, r.created_at
      FROM reservations r
     WHERE r.status = 'pending'
       AND r.stripe_payment_intent IS NULL
       AND r.created_at < NOW() - (${olderMin}::int * INTERVAL '1 minute')
     ORDER BY r.created_at ASC
     LIMIT 200`;

  const swept = [];
  const failed = [];
  for (const row of leaked) {
    try {
      const fresh = await sql`SELECT shares FROM listings WHERE id = ${row.listing_id} LIMIT 1`;
      const shares = fresh[0]?.shares || {};
      const s = shares[row.share_size] || { available: 0, reserved: 0 };
      const newShares = JSON.parse(JSON.stringify(shares));
      newShares[row.share_size] = {
        ...s,
        available: (s.available || 0) + 1,
        reserved: Math.max(0, (s.reserved || 0) - 1),
      };
      await sql`UPDATE listings SET shares = ${newShares}, updated_at = NOW() WHERE id = ${row.listing_id}`;
      await sql`
        UPDATE reservations
           SET status = 'cancelled', updated_at = NOW()
         WHERE id = ${row.id} AND status = 'pending'`;
      swept.push({
        reservation_id: row.id,
        listing_id: row.listing_id,
        share_size: row.share_size,
      });
    } catch (e) {
      failed.push({ reservation_id: row.id, error: String(e.message || e).slice(0, 160) });
    }
  }
  return { found: leaked.length, swept_count: swept.length, failed_count: failed.length, swept, failed };
}

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  if (!authorized(req, url)) return err(403, 'Cron secret required');

  const olderMin = Math.max(5, parseInt(url.searchParams.get('older_than_minutes') || '30', 10) || 30);
  const preview = url.searchParams.get('preview') === '1' || req.method === 'GET' && url.searchParams.get('execute') !== '1';

  // Vercel Cron is always GET — execute unless ?preview=1
  const isCron = !!(req.headers.get('x-vercel-cron') || (req.headers.get('authorization') || '').startsWith('Bearer '));
  const shouldExecute = req.method === 'POST' || (isCron && !preview) || url.searchParams.get('execute') === '1';

  if (!shouldExecute) {
    const leaked = await sql`
      SELECT COUNT(*)::int AS n
        FROM reservations
       WHERE status = 'pending'
         AND stripe_payment_intent IS NULL
         AND created_at < NOW() - (${olderMin}::int * INTERVAL '1 minute')`;
    return json({ preview: true, older_than_minutes: olderMin, would_sweep: leaked[0]?.n || 0 });
  }

  const result = await sweep(olderMin);
  return json({ ok: true, older_than_minutes: olderMin, ...result, ran_at: new Date().toISOString() });
}

export default nodejsHandler(handler);
