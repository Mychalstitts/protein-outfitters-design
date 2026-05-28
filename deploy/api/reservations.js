// /api/reservations
//   GET   → reservations for current user (auth required)
//   POST  → create reservation (auth optional — uses email)
//   PATCH ?id=… → status transition (processor/admin/buyer scoped)
//                 fires the appropriate lifecycle email per transition.
import { sql, currentUser, err, json } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'nodejs' };

const TERMINAL = new Set(['picked-up', 'cancelled', 'refunded']);
const ALLOWED_STATUSES = ['pending','deposit-paid','paid','processing','ready','picked-up','cancelled','refunded'];

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
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

  // ─── PATCH: status transition + lifecycle email triggers ──
  if (req.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return err(400, 'id query param required');
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const newStatus = body.status;
    const cutSheetUpdate = body.cut_sheet;

    // Allow PATCH for cut sheet updates without a status flip (buyers submit a cut sheet at any time).
    if (cutSheetUpdate && !newStatus) {
      // Verify caller is the buyer
      const r0 = await sql`
        SELECT r.*, l.species, l.breed, l.number, f.name AS farm_name,
               p.id AS proc_id, p.owner_id AS proc_owner, p.name AS processor_name
        FROM reservations r
        JOIN listings l ON l.id = r.listing_id
        JOIN farms f ON f.id = l.farm_id
        LEFT JOIN processors p ON p.id = r.processor_id
        WHERE r.id = ${id} LIMIT 1`;
      const me = r0[0];
      if (!me) return err(404, 'Reservation not found');
      const isBuyer = me.buyer_id === user.id || me.buyer_email === user.email;
      if (!isBuyer && user.role !== 'admin') return err(403, 'Not your reservation');

      await sql`UPDATE reservations SET cut_sheet = ${JSON.stringify(cutSheetUpdate)}, updated_at = NOW() WHERE id = ${id}`;

      // P2 — cut sheet finalized — fire to processor if one is on file.
      if (me.proc_id) {
        try {
          const procOwner = await sql`SELECT email, name FROM users WHERE id = ${me.proc_owner} LIMIT 1`;
          if (procOwner[0]?.email) {
            const animalLabelShort = `${me.number ? me.number + ' · ' : ''}${me.breed || me.species || 'animal'}`;
            await sendLifecycleEmail('P2.cut_sheet_finalized', {
              to: procOwner[0].email,
              processor_contact: procOwner[0].name,
              farm_name: me.farm_name,
              animal_label: animalLabelShort,
              buyer_first: (me.buyer_name || me.buyer_email).split(/\s|@/)[0] || 'A buyer',
              dedupKey: `P2::${id}`,
            });
          }
        } catch (e) { /* best-effort */ }
      }
      return json({ reservation: { id, cut_sheet_updated: true } });
    }

    if (!newStatus || !ALLOWED_STATUSES.includes(newStatus)) {
      return err(400, `Invalid status: ${newStatus}`);
    }

    // Pull reservation + linked listing/farm/processor for auth + email context
    const rows = await sql`
      SELECT r.*, l.species, l.breed, l.number, l.expected_finish_date, l.estimated_hanging_weight,
             f.id AS farm_id, f.owner_id AS farm_owner_id, f.name AS farm_name,
             p.id AS processor_id_resolved, p.owner_id AS processor_owner_id, p.name AS processor_name
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
      JOIN farms f ON f.id = l.farm_id
      LEFT JOIN processors p ON p.id = r.processor_id
      WHERE r.id = ${id} LIMIT 1`;
    const r = rows[0];
    if (!r) return err(404, 'Reservation not found');
    if (TERMINAL.has(r.status) && newStatus !== r.status) {
      return err(409, `Reservation is ${r.status}; cannot transition to ${newStatus}`);
    }

    // Authorize the transition based on who's allowed to flip it.
    const isAdmin = user.role === 'admin';
    const isProcessorOwner = r.processor_owner_id === user.id;
    const isFarmer = r.farm_owner_id === user.id;
    const isBuyer = r.buyer_id === user.id || r.buyer_email === user.email;

    const matrix = {
      // status → who can set it
      'processing':  ['admin','processor'], // typically auto-flipped on QR check-in
      'ready':       ['admin','processor'],
      'picked-up':   ['admin','processor','buyer'],
      'cancelled':   ['admin','buyer'],
      'refunded':    ['admin'],
      'paid':        ['admin','processor'],
      'deposit-paid':['admin'],
      'pending':     ['admin'],
    };
    const allowed = matrix[newStatus] || [];
    const ok = (isAdmin && allowed.includes('admin'))
      || (isProcessorOwner && allowed.includes('processor'))
      || (isBuyer && allowed.includes('buyer'))
      || (isFarmer && allowed.includes('farmer'));
    if (!ok) return err(403, `Not authorized to set status='${newStatus}'`);

    // Optional payload fields the processor can attach with the transition
    const finalHwLbs = Number(body.final_hanging_weight) || null;
    const finalCutsLbs = finalHwLbs ? Math.round(finalHwLbs * 0.65) : null;
    const finalBalanceCharged = Number(body.final_balance_charged) || null;

    // Persist
    await sql`UPDATE reservations SET status = ${newStatus}, updated_at = NOW() WHERE id = ${id}`;

    // ─── Fire the right email per transition ─────────────
    try {
      const buyerCtx = {
        to: r.buyer_email,
        reservation_id: r.id,
        buyer_name: r.buyer_name,
        animal_label: `${r.number ? r.number + ' · ' : ''}${r.breed || r.species || 'animal'}`,
        farm_name: r.farm_name,
        processor_name: r.processor_name,
      };

      if (newStatus === 'ready') {
        await sendLifecycleEmail('C18.ready_for_pickup', {
          ...buyerCtx,
          processor_address: body.processor_address || null,
          pickup_window: body.pickup_window || null,
          final_hw_lbs: finalHwLbs || r.estimated_hanging_weight,
          final_cuts_lbs: finalCutsLbs,
          final_balance_charged: finalBalanceCharged,
          cooler_size_rec: r.share_size === 'whole' ? '120-quart' : r.share_size === 'half' ? '85-quart' : '48-quart',
          dedupKey: `C18::${r.id}`,
        });
      }

      if (newStatus === 'picked-up') {
        await sendLifecycleEmail('C19.delivered_complaint_window', {
          ...buyerCtx,
          dedupKey: `C19::${r.id}`,
        });
      }

      if (newStatus === 'cancelled' && body.reason === 'condemnation') {
        await sendLifecycleEmail('C11.animal_condemned_refund', {
          ...buyerCtx,
          condemnation_stage: body.condemnation_stage || 'post_mortem',
          refund_amount: Number(r.deposit_amount || 0),
          species: r.species,
          dedupKey: `C11::${r.id}`,
        });
      }

      // F6 — hanging weight reported (fires when processor sets paid status with HW)
      if (newStatus === 'paid' && finalHwLbs) {
        const farmerRow = await sql`SELECT email, name FROM users WHERE id = ${r.farm_owner_id} LIMIT 1`;
        if (farmerRow[0]?.email) {
          // F6 isn't yet in the templates registry — we'll log + fire P6 instead for processor.
          await sendLifecycleEmail('P6.processing_complete' /* falls through if missing */, {
            to: farmerRow[0].email,
            farmer_name: farmerRow[0].name,
            animal_label: buyerCtx.animal_label,
            final_hw_lbs: finalHwLbs,
            dedupKey: `F6::${r.id}`,
          });
        }
      }
    } catch (emailErr) {
      console.error('Status-flip email error (non-fatal):', emailErr.message);
    }

    return json({ reservation: { id, status: newStatus, updated_at: new Date().toISOString() } });
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

  return err(405, 'Method not allowed');
}
