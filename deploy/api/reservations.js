// /api/reservations
//   GET    → reservations for current user (auth required)
//   POST   → create reservation (auth optional — uses email)
//   PATCH  → transition reservation status (auth required)
//              ?id=<reservation_uuid>
//              body: { status: 'ready' | 'picked-up',
//                      final_hanging_weight?, pickup_window? }
//
//   Authorization:
//     - 'ready'      → processor that owns reservations.processor_id (or admin)
//     - 'picked-up'  → buyer (reservations.buyer_id or buyer_email match) (or admin)
//
//   Side effects:
//     - 'ready'      fires C18.ready_for_pickup to buyer (dedupKey C18::<reservation_id>)
//     - 'picked-up'  fires C19.delivered_complaint_window to buyer (dedupKey C19::<reservation_id>)
//     - Both are idempotent on the email side via email_log.dedup_key.
import { sql, currentUser, err, json, isUuid } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'edge' };

// Idempotent column bootstrap. ADD COLUMN IF NOT EXISTS is supported since
// Postgres 9.6 and this is wrapped in a try/catch so a fresh DB or a drifted
// migration doesn't break the handler.
let _colsEnsured = false;
async function ensureReservationColumns() {
  if (_colsEnsured) return;
  try {
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS final_hanging_weight NUMERIC(8,2)`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pickup_window TEXT`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ`;
    _colsEnsured = true;
  } catch (_e) {
    // Non-fatal — keep handler available even if the ALTER fails (e.g. RBAC).
  }
}

function animalLabelFrom(row) {
  if (row.breed) return row.animal_number ? `${row.breed} #${row.animal_number}` : row.breed;
  if (row.species) return row.animal_number ? `${row.species} #${row.animal_number}` : row.species;
  return 'Your share';
}

function processorAddressFrom(row) {
  const parts = [row.processor_city, row.processor_state, row.processor_zip].filter(Boolean);
  return parts.length ? parts.join(', ').replace(/, ([A-Z]{2}), /, ', $1 ') : null;
}

export default async function handler(req) {
  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    // GET-by-id: /confirmed and /account hydrate from this. Scoped to the
    // signed-in user (or admin) — never expose another buyer's reservation.
    const url = new URL(req.url, 'https://www.proteinoutfitters.com');
    const id = url.searchParams.get('id');
    if (id) {
      if (!isUuid(id)) return err(400, 'id must be a UUID');
      const r = await sql`
        SELECT r.*, l.species, l.breed, l.number, l.photos, l.expected_finish_date,
               f.slug as farm_slug, f.name as farm_name, f.city as farm_city, f.state as farm_state,
               p.slug as processor_slug, p.name as processor_name, p.city as processor_city, p.state as processor_state
        FROM reservations r
        JOIN listings l ON l.id = r.listing_id
        JOIN farms f ON f.id = l.farm_id
        LEFT JOIN processors p ON p.id = r.processor_id
        WHERE r.id = ${id} LIMIT 1`;
      if (!r[0]) return err(404, 'Reservation not found');
      const row = r[0];
      const owns = row.buyer_id === user.id || (row.buyer_email && row.buyer_email === user.email);
      if (!owns && user.role !== 'admin') return err(403, 'Not yours');
      return json({ reservation: row });
    }
    const rows = await sql`
      SELECT r.*, l.species, l.breed, l.number, l.photos, l.expected_finish_date,
             f.slug as farm_slug, f.name as farm_name, f.city as farm_city, f.state as farm_state
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
      JOIN farms f ON f.id = l.farm_id
      WHERE r.buyer_id = ${user.id} OR r.buyer_email = ${user.email}
      ORDER BY r.created_at DESC
    `;
    return json({ reservations: rows });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body.listing_id) return err(400, 'listing_id required');
    if (!body.share_size) return err(400, 'share_size required');
    if (!body.buyer_email) return err(400, 'buyer_email required');

    const user = await currentUser(req);
    const buyerId = user?.id || null;

    // Verify listing exists & has share available
    const lrows = await sql`SELECT shares, status FROM listings WHERE id = ${body.listing_id} LIMIT 1`;
    if (!lrows[0]) return err(404, 'Listing not found');
    if (lrows[0].status !== 'active') return err(409, 'Listing is no longer available');
    const shares = lrows[0].shares || {};
    const share = shares[body.share_size];
    if (!share || (share.available || 0) <= 0) {
      return err(409, `No ${body.share_size} share available`);
    }

    // Decrement available, increment reserved on listing
    const newShares = JSON.parse(JSON.stringify(shares));
    newShares[body.share_size].available -= 1;
    newShares[body.share_size].reserved = (newShares[body.share_size].reserved || 0) + 1;

    await sql`UPDATE listings SET shares = ${newShares}, updated_at = NOW() WHERE id = ${body.listing_id}`;

    const rows = await sql`
      INSERT INTO reservations (listing_id, buyer_id, buyer_email, buyer_phone, buyer_name, share_size, cut_sheet, processor_id, total_estimate, deposit_amount, notes)
      VALUES (${body.listing_id}, ${buyerId}, ${body.buyer_email.toLowerCase()}, ${body.buyer_phone || null}, ${body.buyer_name || null}, ${body.share_size}, ${body.cut_sheet || null}, ${body.processor_id || null}, ${body.total_estimate || null}, ${body.deposit_amount || null}, ${body.notes || null})
      RETURNING *
    `;
    return json({ reservation: rows[0] });
  }

  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return err(400, 'id query param required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const target = String(body.status || '').trim();
    if (!['ready', 'picked-up'].includes(target)) {
      return err(400, `status must be one of: ready, picked-up`);
    }

    await ensureReservationColumns();

    // Single fetch loads everything the auth gates + email templates need.
    const rows = await sql`
      SELECT r.id, r.status, r.buyer_id, r.buyer_email, r.buyer_name,
             r.share_size, r.processor_id,
             l.breed, l.species, l.number AS animal_number,
             f.name AS farm_name,
             p.name  AS processor_name,
             p.city  AS processor_city,
             p.state AS processor_state,
             p.zip   AS processor_zip,
             p.owner_id AS processor_owner_id
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
      JOIN farms f ON f.id = l.farm_id
      LEFT JOIN processors p ON p.id = r.processor_id
      WHERE r.id = ${id} LIMIT 1`;
    const r = rows[0];
    if (!r) return err(404, 'Reservation not found');

    const isAdmin = user.role === 'admin';

    if (target === 'ready') {
      const isProcessor = r.processor_owner_id && r.processor_owner_id === user.id;
      if (!isProcessor && !isAdmin) return err(403, 'Only the processor or an admin can mark ready');
      if (!['deposit-paid', 'paid', 'processing'].includes(r.status)) {
        return err(409, `Cannot mark ready from status '${r.status}'`);
      }
      const finalHw = body.final_hanging_weight != null && body.final_hanging_weight !== ''
        ? Number(body.final_hanging_weight) : null;
      const pickupWindow = body.pickup_window ? String(body.pickup_window).slice(0, 200) : null;

      await sql`
        UPDATE reservations
        SET status = 'ready',
            final_hanging_weight = COALESCE(${finalHw}, final_hanging_weight),
            pickup_window        = COALESCE(${pickupWindow}, pickup_window),
            ready_at             = COALESCE(ready_at, NOW()),
            updated_at           = NOW()
        WHERE id = ${id}`;

      try {
        await sendLifecycleEmail('C18.ready_for_pickup', {
          to: r.buyer_email,
          reservation_id: r.id,
          buyer_name: r.buyer_name,
          buyer_email: r.buyer_email,
          animal_label: animalLabelFrom(r),
          farm_name: r.farm_name,
          processor_name: r.processor_name,
          processor_address: processorAddressFrom(r),
          processor_id: r.processor_id,
          final_hw_lbs: finalHw,
          pickup_window: pickupWindow,
          final_balance_charged: null,
          dedupKey: `C18::${r.id}`,
        });
      } catch (_e) {
        // Email failures must not block the status flip — they're observable in email_log.
      }

      return json({ ok: true, reservation: { id, status: 'ready' } });
    }

    if (target === 'picked-up') {
      const isBuyer = (r.buyer_id && r.buyer_id === user.id)
        || (r.buyer_email && user.email && r.buyer_email.toLowerCase() === user.email.toLowerCase());
      if (!isBuyer && !isAdmin) return err(403, 'Only the buyer or an admin can mark picked up');
      if (!['ready', 'processing', 'deposit-paid', 'paid'].includes(r.status)) {
        return err(409, `Cannot mark picked-up from status '${r.status}'`);
      }

      await sql`
        UPDATE reservations
        SET status       = 'picked-up',
            picked_up_at = COALESCE(picked_up_at, NOW()),
            updated_at   = NOW()
        WHERE id = ${id}`;

      try {
        await sendLifecycleEmail('C19.delivered_complaint_window', {
          to: r.buyer_email,
          reservation_id: r.id,
          buyer_name: r.buyer_name,
          buyer_email: r.buyer_email,
          animal_label: animalLabelFrom(r),
          processor_id: r.processor_id,
          dedupKey: `C19::${r.id}`,
        });
      } catch (_e) {
        // non-fatal
      }

      return json({ ok: true, reservation: { id, status: 'picked-up' } });
    }
  }

  return err(405, 'Method not allowed');
}
