// /api/admin-sweep-pending-reservations — clean up "leaked" reservations.
//
// A reservation can get stuck in `pending` with the share inventory already
// decremented if /api/checkout 500s after the UPDATE listings + INSERT
// reservations writes but before the Stripe Checkout Session completes.
// (The defensive fix in checkout.js now rolls back inline on Stripe error,
// but historical leaks need a one-shot cleaner — this is it.)
//
// POST  ?older_than_minutes=5  (default 5) — delete `pending` reservations
//   with no stripe_payment_intent that are older than the threshold, and
//   re-increment listings.shares.{share_size}.{available,reserved} for each.
//
// GET   — preview only: returns the rows that WOULD be swept, no writes.
//
// Admin only.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);

  // Auth: either an admin browser session OR ?secret=$MIGRATE_SECRET (lets
  // an operator run this from a script without holding an admin cookie).
  const secret = url.searchParams.get('secret');
  const secretOk = !!(process.env.MIGRATE_SECRET && secret && secret === process.env.MIGRATE_SECRET);
  if (!secretOk) {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin or ?secret=$MIGRATE_SECRET required');
  }

  const olderMin = Math.max(1, parseInt(url.searchParams.get('older_than_minutes') || '5', 10));

  // Find leaked rows: pending status, no Stripe PI, older than cutoff.
  const leaked = await sql`
    SELECT r.id, r.listing_id, r.share_size, r.created_at,
           l.shares AS current_shares, l.number AS listing_number, l.breed
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

  // For each leaked row: DELETE the reservation, restore share inventory.
  // Done per-row instead of bulk so a single failure doesn't poison the rest.
  const swept = [];
  const failed = [];
  for (const row of leaked) {
    try {
      const shares = row.current_shares || {};
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
