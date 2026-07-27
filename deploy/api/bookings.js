// /api/bookings — explicit farmer×processor×date booking rows
//
//   POST  body: { listing_id, processor_id, drop_off_date, drop_off_window? }
//     - Verifies caller owns the listing's farm.
//     - Creates a booking row + farmer_deposits hold + 6-digit checkin code.
//     - Returns { booking, deposit, code }.
//   GET   ?listing_id=...   list bookings for a listing  (farm owner or admin)
//   GET   ?processor_slug=  list bookings for a processor (processor owner or admin)
//   GET   ?id=...           single booking detail (any party can read)
//   PATCH ?id=...           advance the animal through the plant (processor owner or admin)
//     body: { status?, hanging_weight_lbs?, pickup_window?, processor_address? }
//     status machine: scheduled → checked-in → fabricating → ready → picked-up
//     (scheduled/checked-in/fabricating may also go to cancelled; scheduled → no-show)
//     Each transition stamps its own timestamp column, drags the listing's
//     reservations along with it, and fires the matching buyer email. Setting the
//     status it already has is a no-op that returns 200 — the ops buttons are
//     double-tapped on phones in cold rooms.
//
// Deposit policy (Trello "For Myke" decision pending — using sensible defaults):
//   $100 flat OR 10% of estimated processing, whichever is greater, capped $300.

import { sql, currentUser, err, json, isUuid, nodejsHandler } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'nodejs' };

// Generate a 6-digit zero-padded code that's not already in use.
async function newCheckinCode() {
  for (let i = 0; i < 50; i++) {
    const n = Math.floor(Math.random() * 1000000);
    const code = String(n).padStart(6, '0');
    const taken = await sql`SELECT 1 FROM checkin_codes WHERE code = ${code} LIMIT 1`;
    if (!taken[0]) return code;
  }
  throw new Error('Could not allocate a unique check-in code');
}

function calcDeposit(estimatedHangingWeight, processorPerLb) {
  const proc = (processorPerLb || 1.25);
  const hw = (estimatedHangingWeight || 700);
  const tenPctOfProcessing = Math.round(hw * proc * 0.10);
  const flat = 100;
  const cap = 300;
  return Math.min(cap, Math.max(flat, tenPctOfProcessing));
}

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    const listingId = url.searchParams.get('listing_id');
    const processorSlug = url.searchParams.get('processor_slug');
    if (id && !isUuid(id)) return err(400, 'Invalid booking id');
    if (listingId && !isUuid(listingId)) return err(400, 'Invalid listing_id');
    const user = await currentUser(req);

    if (id) {
      const rows = await sql`
        SELECT b.*, l.number AS animal_number, l.breed, l.species,
               f.name AS farm_name, p.name AS processor_name, p.slug AS processor_slug,
               d.amount AS deposit_amount, d.status AS deposit_status,
               c.code AS checkin_code
        FROM bookings b
        JOIN listings l ON l.id = b.listing_id
        JOIN farms f ON f.id = b.farm_id
        JOIN processors p ON p.id = b.processor_id
        LEFT JOIN farmer_deposits d ON d.booking_id = b.id
        LEFT JOIN checkin_codes c ON c.booking_id = b.id AND c.consumed_at IS NULL
        WHERE b.id = ${id} LIMIT 1`;
      if (!rows[0]) return err(404, 'Booking not found');
      return json({ booking: rows[0] });
    }

    if (listingId) {
      // Farm owner or admin only
      if (!user) return err(401, 'Sign in required');
      const owns = await sql`SELECT 1 FROM farms f JOIN listings l ON l.farm_id = f.id WHERE l.id = ${listingId} AND f.owner_id = ${user.id} LIMIT 1`;
      if (!owns[0] && user.role !== 'admin') return err(403, 'Not your listing');
      const rows = await sql`
        SELECT b.*, p.name AS processor_name, p.slug AS processor_slug,
               d.amount AS deposit_amount, d.status AS deposit_status
        FROM bookings b
        JOIN processors p ON p.id = b.processor_id
        LEFT JOIN farmer_deposits d ON d.booking_id = b.id
        WHERE b.listing_id = ${listingId}
        ORDER BY b.drop_off_date DESC LIMIT 50`;
      return json({ bookings: rows });
    }

    if (processorSlug) {
      if (!user) return err(401, 'Sign in required');
      const procRow = await sql`SELECT id, owner_id FROM processors WHERE slug = ${processorSlug} LIMIT 1`;
      if (!procRow[0]) return err(404, 'Processor not found');
      if (procRow[0].owner_id !== user.id && user.role !== 'admin') return err(403, 'Not your processor');
      const rows = await sql`
        SELECT b.*, l.number AS animal_number, l.breed, l.species,
               f.name AS farm_name, f.city AS farm_city,
               d.amount AS deposit_amount, d.status AS deposit_status
        FROM bookings b
        JOIN listings l ON l.id = b.listing_id
        JOIN farms f ON f.id = b.farm_id
        LEFT JOIN farmer_deposits d ON d.booking_id = b.id
        WHERE b.processor_id = ${procRow[0].id}
        ORDER BY b.drop_off_date ASC LIMIT 200`;
      return json({ bookings: rows });
    }

    return err(400, 'Pass id, listing_id, or processor_slug');
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { listing_id, processor_id, drop_off_date, drop_off_window } = body;
    if (!listing_id || !processor_id || !drop_off_date) {
      return err(400, 'listing_id, processor_id, drop_off_date all required');
    }

    // Verify caller owns the listing's farm
    const lrows = await sql`
      SELECT l.id, l.estimated_hanging_weight, f.id AS farm_id, f.owner_id
      FROM listings l JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${listing_id} LIMIT 1`;
    const l = lrows[0];
    if (!l) return err(404, 'Listing not found');
    if (l.owner_id !== user.id && user.role !== 'admin') return err(403, 'Not your listing');

    // Pull processor's per-lb fee for deposit math
    const procRows = await sql`SELECT per_lb_fees FROM processors WHERE id = ${processor_id} LIMIT 1`;
    if (!procRows[0]) return err(404, 'Processor not found');
    const procPerLb = Number(procRows[0].per_lb_fees?.processing) || 1.25;

    // Reuse an existing scheduled booking instead of creating duplicates
    const existing = await sql`
      SELECT id FROM bookings
      WHERE listing_id = ${listing_id} AND processor_id = ${processor_id}
        AND status NOT IN ('cancelled','rejected')
      LIMIT 1`;
    if (existing[0]) return err(409, 'Booking already exists for this listing × processor');

    // ── Conflict guard: processor capacity per day ──
    // Read processor.capabilities.daily_capacity (default 1 animal/day until set).
    // If at-or-over capacity, suggest the nearest available date.
    const capRows = await sql`SELECT capabilities FROM processors WHERE id = ${processor_id} LIMIT 1`;
    const dailyCap = Number(capRows[0]?.capabilities?.daily_capacity) || 1;
    const sameDay = await sql`
      SELECT COUNT(*)::int AS c FROM bookings
      WHERE processor_id = ${processor_id}
        AND drop_off_date = ${drop_off_date}
        AND status NOT IN ('cancelled','rejected')`;
    if (Number(sameDay[0]?.c || 0) >= dailyCap) {
      // Find next free date within 14 days
      const nextFree = await sql`
        WITH days AS (
          SELECT generate_series(${drop_off_date}::date + 1, ${drop_off_date}::date + 14, INTERVAL '1 day')::date AS d
        ), filled AS (
          SELECT drop_off_date::date AS d, COUNT(*) AS n FROM bookings
          WHERE processor_id = ${processor_id} AND status NOT IN ('cancelled','rejected')
          GROUP BY drop_off_date
        )
        SELECT days.d FROM days
        LEFT JOIN filled ON filled.d = days.d
        WHERE COALESCE(filled.n, 0) < ${dailyCap}
        ORDER BY days.d ASC
        LIMIT 1`;
      const suggestion = nextFree[0]?.d;
      return err(409, `Processor is at capacity (${dailyCap}/day) on ${drop_off_date}.${suggestion ? ` Next open day: ${new Date(suggestion).toISOString().slice(0,10)}.` : ''}`, {
        suggested_date: suggestion ? new Date(suggestion).toISOString().slice(0,10) : null,
        daily_capacity: dailyCap,
      });
    }

    const depositAmount = calcDeposit(l.estimated_hanging_weight, procPerLb);

    const bRows = await sql`
      INSERT INTO bookings (listing_id, farm_id, processor_id, drop_off_date, drop_off_window)
      VALUES (${listing_id}, ${l.farm_id}, ${processor_id}, ${drop_off_date}, ${drop_off_window || null})
      RETURNING *`;
    const booking = bRows[0];

    const dRows = await sql`
      INSERT INTO farmer_deposits (booking_id, farm_id, amount, status)
      VALUES (${booking.id}, ${l.farm_id}, ${depositAmount}, 'held')
      RETURNING *`;
    const deposit = dRows[0];

    const code = await newCheckinCode();
    await sql`INSERT INTO checkin_codes (code, booking_id) VALUES (${code}, ${booking.id})`;

    return json({ booking, deposit, code });
  }


  if (req.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id || !isUuid(id)) return err(400, 'Valid booking id required');
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const rows = await sql`
      SELECT b.*,
             p.owner_id AS processor_owner_id, p.name AS processor_name,
             p.address AS processor_address,
             l.number AS animal_number, l.breed, l.species,
             l.estimated_hanging_weight,
             f.name AS farm_name,
             fu.email AS farmer_email, fu.name AS farmer_name,
             d.amount AS deposit_amount
      FROM bookings b
      JOIN processors p ON p.id = b.processor_id
      JOIN listings l ON l.id = b.listing_id
      JOIN farms f ON f.id = b.farm_id
      LEFT JOIN users fu ON fu.id = f.owner_id
      LEFT JOIN farmer_deposits d ON d.booking_id = b.id
      WHERE b.id = ${id} LIMIT 1`;
    const b = rows[0];
    if (!b) return err(404, 'Booking not found');

    // Only the plant holding the animal can move it through the plant.
    const isAdmin = user.role === 'admin';
    if (b.processor_owner_id !== user.id && !isAdmin) {
      return err(403, 'Only the processor handling this animal can update the booking');
    }

    // ── Validate the weight before writing anything ──
    let weight = null;
    if (body.hanging_weight_lbs !== undefined && body.hanging_weight_lbs !== null && body.hanging_weight_lbs !== '') {
      weight = Number(body.hanging_weight_lbs);
      if (!isFinite(weight) || weight <= 0 || weight > 5000) {
        return err(400, 'hanging_weight_lbs must be a number between 1 and 5000');
      }
    }

    const newStatus = body.status ? String(body.status).trim() : null;
    if (!newStatus && weight === null) return err(400, 'Pass status and/or hanging_weight_lbs');

    // Validate the transition BEFORE any write, so a rejected request never
    // leaves a partial one behind.
    const TRANSITIONS = {
      'scheduled':   ['checked-in', 'no-show', 'cancelled'],
      'checked-in':  ['fabricating', 'cancelled'],
      'fabricating': ['ready', 'cancelled'],
      'ready':       ['picked-up'],
      'picked-up':   [],
      'no-show':     [],
      'cancelled':   [],
      'rejected':    [],
    };
    const sameStatus = newStatus && newStatus === b.status;
    if (newStatus && !sameStatus) {
      const legal = TRANSITIONS[b.status] || [];
      if (!legal.includes(newStatus)) {
        return err(409, legal.length
          ? `Booking is '${b.status}' — it can only move to ${legal.map(x => `'${x}'`).join(' or ')}`
          : `Booking is '${b.status}', which is final`);
      }
    }

    // Weight is safe to write now: either there is no transition, or the
    // transition is legal.
    if (weight !== null) {
      await sql`UPDATE bookings SET hanging_weight_lbs = ${weight}, updated_at = NOW() WHERE id = ${id}`;
    }

    // Weight-only, or the status it already has: nothing further to do.
    if (!newStatus || sameStatus) {
      const fresh0 = await sql`SELECT * FROM bookings WHERE id = ${id} LIMIT 1`;
      return json({ booking: fresh0[0], unchanged: !!sameStatus });
    }

    // Every status write below is conditional on the status we read. Two
    // operators tapping the same button at once (or one double-tapping a
    // phone in a cold room) means the second UPDATE matches zero rows, and we
    // return the current state instead of firing a second round of emails.
    async function advance(setClause) {
      const res = await setClause();
      return res.count > 0;
    }
    const stillOurs = { value: true };

    const animalLabel = `${b.animal_number ? b.animal_number + ' · ' : ''}${b.breed || b.species || 'animal'}`;
    const hwLbs = weight !== null ? weight : (b.hanging_weight_lbs || null);
    let buyersNotified = 0;

    // ── checked-in ──────────────────────────────────────────────
    // Mirrors /api/check-in (the code-entry path). Same dedup keys, so an animal
    // checked in here and there never double-emails a buyer.
    if (newStatus === 'checked-in') {
      stillOurs.value = await advance(() => sql`
        UPDATE bookings
        SET status = 'checked-in', checked_in_at = NOW(), checked_in_by = ${user.id}, updated_at = NOW()
        WHERE id = ${id} AND status = ${b.status}`);
      if (stillOurs.value) {
        await sql`UPDATE checkin_codes SET consumed_at = NOW(), consumed_by = ${user.id}
                  WHERE booking_id = ${id} AND consumed_at IS NULL`;
        await sql`UPDATE farmer_deposits SET status = 'released', released_at = NOW(), updated_at = NOW()
                  WHERE booking_id = ${id} AND status = 'held'`;
        // Scoped to THIS plant: one listing can carry bookings at two
        // processors, and plant B must not move plant A's buyers.
        await sql`
          UPDATE reservations SET status = 'processing', updated_at = NOW()
          WHERE listing_id = ${b.listing_id} AND status IN ('deposit-paid','paid')
            AND (processor_id = ${b.processor_id} OR processor_id IS NULL)`;

        const buyers = await sql`
          SELECT id, buyer_email, buyer_name FROM reservations
          WHERE listing_id = ${b.listing_id} AND status = 'processing'
            AND (processor_id = ${b.processor_id} OR processor_id IS NULL)`;
        for (const r of buyers) {
          if (!r.buyer_email) continue;
          try {
            const out = await sendLifecycleEmail('C16.animal_arrived', {
              to: r.buyer_email,
              reservation_id: r.id,
              buyer_name: r.buyer_name,
              animal_label: animalLabel,
              farm_name: b.farm_name,
              processor_name: b.processor_name,
              estimated_ready_days: 18,
              dedupKey: `C16::${r.id}::${id}`,
            });
            if (out.sent) buyersNotified++;
          } catch (e) { /* one bad address must not stall the line */ }
        }
      }
    }

    // ── fabricating ─────────────────────────────────────────────
    if (newStatus === 'fabricating') {
      stillOurs.value = await advance(() => sql`
        UPDATE bookings
        SET status = 'fabricating', fabrication_started_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND status = ${b.status}`);
    }

    // ── ready ───────────────────────────────────────────────────
    if (newStatus === 'ready') {
      stillOurs.value = await advance(() => sql`
        UPDATE bookings SET status = 'ready', ready_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND status = ${b.status}`);
      if (stillOurs.value) {
        // Includes buyers who reserved AFTER the animal was checked in — they
        // never passed through 'processing' and would otherwise never be told.
        await sql`
          UPDATE reservations SET status = 'ready', updated_at = NOW()
          WHERE listing_id = ${b.listing_id} AND status IN ('processing','deposit-paid','paid')
            AND (processor_id = ${b.processor_id} OR processor_id IS NULL)`;

        const buyers = await sql`
          SELECT id, buyer_email, buyer_name, share_size FROM reservations
          WHERE listing_id = ${b.listing_id} AND status = 'ready'
            AND (processor_id = ${b.processor_id} OR processor_id IS NULL)`;
        for (const r of buyers) {
          if (!r.buyer_email) continue;
          try {
            const out = await sendLifecycleEmail('C18.ready_for_pickup', {
              to: r.buyer_email,
              reservation_id: r.id,
              buyer_name: r.buyer_name,
              animal_label: animalLabel,
              farm_name: b.farm_name,
              processor_name: b.processor_name,
              processor_address: body.processor_address || b.processor_address || null,
              pickup_window: body.pickup_window || b.drop_off_window || null,
              final_hw_lbs: hwLbs || b.estimated_hanging_weight,
              final_cuts_lbs: hwLbs ? Math.round(hwLbs * 0.65) : null,
              cooler_size_rec: r.share_size === 'whole' ? '120-quart'
                              : r.share_size === 'half' ? '85-quart' : '48-quart',
              // Same key /api/reservations uses, so whichever path marks it ready
              // first wins and the buyer is told exactly once.
              dedupKey: `C18::${r.id}`,
            });
            if (out.sent) buyersNotified++;
          } catch (e) { /* keep going */ }
        }
      }
    }

    // ── picked-up ───────────────────────────────────────────────
    // Closes out the BOOKING only. Buyers collect their shares individually —
    // one buyer walking out with a quarter does not mean the other three did,
    // and 'picked-up' is terminal on a reservation. Each share is closed from
    // /api/reservations, which also fires that buyer's C19 complaint-window
    // email at the right moment.
    let openShares = [];
    if (newStatus === 'picked-up') {
      stillOurs.value = await advance(() => sql`
        UPDATE bookings SET status = 'picked-up', picked_up_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND status = ${b.status}`);
      // Report the shares still sitting at 'ready' so the operator can close
      // them out one buyer at a time through /api/reservations, which fires
      // each buyer's own C19 complaint-window email at the right moment.
      openShares = await sql`
        SELECT id, buyer_name, buyer_email, share_size FROM reservations
        WHERE listing_id = ${b.listing_id} AND status = 'ready'
          AND (processor_id = ${b.processor_id} OR processor_id IS NULL)`;
    }

    // ── no-show ─────────────────────────────────────────────────
    // Matches what the nightly sweep in /api/email-tick does when it finds a
    // drop-off date in the past: forfeit the deposit AND tell the farmer why.
    // Marking it here takes the booking out of that sweep's reach, so if this
    // path stayed silent the farmer would simply never hear about it.
    if (newStatus === 'no-show') {
      stillOurs.value = await advance(() => sql`
        UPDATE bookings SET status = 'no-show', no_show_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND status = ${b.status}`);
      if (stillOurs.value) {
        await sql`UPDATE farmer_deposits SET status = 'forfeit', forfeit_at = NOW(), updated_at = NOW()
                  WHERE booking_id = ${id} AND status = 'held'`;
        if (b.farmer_email) {
          try {
            await sendLifecycleEmail('F11.no_show_flag', {
              to: b.farmer_email,
              farm_id: b.farm_id,
              farmer_name: b.farmer_name,
              animal_label: animalLabel,
              drop_off_date: b.drop_off_date,
              processor_name: b.processor_name,
              deposit_amount: b.deposit_amount,
              dedupKey: `F11::${id}`,
            });
          } catch (e) { /* the flag stands even if the email bounces */ }
        }
      }
    }

    // ── cancelled ───────────────────────────────────────────────
    // A cancelled drop-off is a scheduling event between farm and plant. It
    // deliberately does NOT cancel or refund the buyers' paid shares — that is
    // a money decision, and it belongs to /api/reservations.
    if (newStatus === 'cancelled') {
      stillOurs.value = await advance(() => sql`
        UPDATE bookings SET status = 'cancelled', updated_at = NOW()
        WHERE id = ${id} AND status = ${b.status}`);
      if (stillOurs.value) {
        await sql`UPDATE farmer_deposits SET status = 'refunded', updated_at = NOW()
                  WHERE booking_id = ${id} AND status = 'held'`;
      }
    }

    const fresh = await sql`SELECT * FROM bookings WHERE id = ${id} LIMIT 1`;
    return json({ booking: fresh[0], buyers_notified: buyersNotified, unchanged: !stillOurs.value, open_shares: openShares });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
