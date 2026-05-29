// /api/admin-sweep-pending-reservations — reservation/inventory hygiene tools.
//
// MODES (set via ?action=):
//
//   action=sweep (default)
//     Delete `pending` reservations with no stripe_payment_intent that are
//     older than ?older_than_minutes=N (default 5) and re-increment
//     listings.shares.{share_size}.{available,reserved} for each.
//     GET = preview only (no writes). POST = execute.
//
//   action=reconcile&listing_id=UUID
//     Recompute listings.shares from the ground truth in the reservations
//     table. Sets shares.{size}.reserved = count of non-(cancelled|refunded)
//     reservations for that size on this listing; sets
//     shares.{size}.available = TOTAL_CAPACITY[size] - reserved. Use this
//     when a prior bug left shares out of sync with actual reservations.
//     GET = preview. POST = execute.
//
//   action=set&listing_id=UUID  (POST body: { shares: {...} })
//     Last-resort manual override. Replaces shares for a listing with the
//     posted JSON. Useful for emergencies; reconcile is safer day-to-day.
//
// Auth: admin session OR ?secret=$MIGRATE_SECRET.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };
// Physics-fixed capacity per share_size — one animal = 1 whole = 2 halves
// = 4 quarters = 8 eighths. Used by `reconcile` to derive available from
// reserved without trusting the existing JSON.
const SHARE_CAPACITY = { whole: 1, half: 2, quarter: 4, eighth: 8 };

// Statuses that DO count against inventory (they hold a share).
const ACTIVE_STATUSES = ['pending', 'deposit-paid', 'paid', 'processing', 'ready', 'picked-up'];

export default async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));

  // Auth: admin session OR ?secret=$MIGRATE_SECRET.
  const secret = url.searchParams.get('secret');
  const secretOk = !!(process.env.MIGRATE_SECRET && secret && secret === process.env.MIGRATE_SECRET);
  if (!secretOk) {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin or ?secret=$MIGRATE_SECRET required');
  }

  const action = (url.searchParams.get('action') || 'sweep').toLowerCase();

  // ────────── reconcile ──────────
  if (action === 'reconcile') {
    const listing_id = url.searchParams.get('listing_id');
    if (!listing_id) return err(400, 'listing_id required for reconcile');

    const lrows = await sql`SELECT id, shares, number, breed FROM listings WHERE id = ${listing_id} LIMIT 1`;
    if (!lrows[0]) return err(404, 'Listing not found');
    const listing = lrows[0];
    const currentShares = listing.shares || {};

    // Count active reservations per share_size for this listing.
    const counts = await sql`
      SELECT share_size, COUNT(*)::int AS n
        FROM reservations
       WHERE listing_id = ${listing_id}
         AND status = ANY(${ACTIVE_STATUSES})
       GROUP BY share_size`;
    const reservedBySize = {};
    for (const c of counts) reservedBySize[c.share_size] = c.n;

    // Build new shares: preserve prices, reset reserved/available based on counts.
    const newShares = {};
    for (const size of Object.keys(currentShares)) {
      const existing = currentShares[size] || {};
      const capacity = SHARE_CAPACITY[size] ?? ((existing.available || 0) + (existing.reserved || 0));
      const reserved = reservedBySize[size] || 0;
      const available = Math.max(0, capacity - reserved);
      newShares[size] = { ...existing, available, reserved };
    }

    if (req.method === 'GET') {
      return json({ preview: true, listing_id, listing_label: `${listing.number || ''} ${listing.breed || ''}`.trim(),
                    before: currentShares, after: newShares, active_reservation_counts: reservedBySize });
    }
    if (req.method !== 'POST') return err(405, 'Method not allowed');

    await sql`UPDATE listings SET shares = ${newShares}, updated_at = NOW() WHERE id = ${listing_id}`;
    return json({ ok: true, action: 'reconcile', listing_id, before: currentShares, after: newShares,
                  active_reservation_counts: reservedBySize });
  }

  // ────────── set (manual override) ──────────
  if (action === 'set') {
    if (req.method !== 'POST') return err(405, 'POST required for set');
    const listing_id = url.searchParams.get('listing_id');
    if (!listing_id) return err(400, 'listing_id required for set');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body.shares || typeof body.shares !== 'object') return err(400, 'body.shares (object) required');

    const lrows = await sql`SELECT id, shares FROM listings WHERE id = ${listing_id} LIMIT 1`;
    if (!lrows[0]) return err(404, 'Listing not found');
    const before = lrows[0].shares || {};

    await sql`UPDATE listings SET shares = ${body.shares}, updated_at = NOW() WHERE id = ${listing_id}`;
    return json({ ok: true, action: 'set', listing_id, before, after: body.shares });
  }

  // ────────── sweep (default) ──────────
  const olderMin = Math.max(1, parseInt(url.searchParams.get('older_than_minutes') || '5', 10));

  // Find leaked rows: pending status, no Stripe PI, older than cutoff.
  // Note: we deliberately do NOT join shares here — read them fresh per
  // iteration so multiple sweeps on the same listing accumulate correctly
  // (an earlier bug used the SELECT-time snapshot and lost increments).
  const leaked = await sql`
    SELECT r.id, r.listing_id, r.share_size, r.created_at,
           l.number AS listing_number, l.breed
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
     WHERE r.status = 'pending'
       AND r.stripe_payment_intent IS NULL
       AND r.created_at < NOW() - (${olderMin}::int * INTERVAL '1 minute')
     ORDER BY r.created_at ASC`;

  if (req.method === 'GET') {
    return json({ preview: true, would_sweep: leaked.length, leaked });
  }
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const swept = [];
  const failed = [];
  for (const row of leaked) {
    try {
      // Re-read shares LIVE each iteration — multiple leaks on the same
      // listing must each see the prior increment.
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
      await sql`DELETE FROM reservations WHERE id = ${row.id}`;
      swept.push({
        reservation_id: row.id,
        listing_id: row.listing_id,
        listing_label: `${row.listing_number || ''} ${row.breed || ''}`.trim(),
        share_size: row.share_size,
        created_at: row.created_at,
        restored: { available: newShares[row.share_size].available, reserved: newShares[row.share_size].reserved },
      });
    } catch (e) {
      failed.push({ reservation_id: row.id, error: String(e.message || e).slice(0, 200) });
    }
  }

  return json({ swept_count: swept.length, failed_count: failed.length, swept, failed });
}
