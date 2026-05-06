// /api/bookings — explicit farmer×processor×date booking rows
//
//   POST  body: { listing_id, processor_id, drop_off_date, drop_off_window? }
//     - Verifies caller owns the listing's farm.
//     - Creates a booking row + farmer_deposits hold + 6-digit checkin code.
//     - Returns { booking, deposit, code }.
//   GET   ?listing_id=...   list bookings for a listing  (farm owner or admin)
//   GET   ?processor_slug=  list bookings for a processor (processor owner or admin)
//   GET   ?id=...           single booking detail (any party can read)
//
// Deposit policy (Trello "For Myke" decision pending — using sensible defaults):
//   $100 flat OR 10% of estimated processing, whichever is greater, capped $300.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

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

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    const listingId = url.searchParams.get('listing_id');
    const processorSlug = url.searchParams.get('processor_slug');
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

  return err(405, 'Method not allowed');
}
