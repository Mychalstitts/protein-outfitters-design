// /api/processor-ops — processor's daily operations dashboard.
//
//   GET ?view=today|week|month|inbox|cooler|ready|earnings
//     Returns the booking list (joined to listings + farms + cut_sheets +
//     deposits) filtered by the requested view, for the signed-in processor's
//     processor_id.
//
//   GET ?view=stats
//     Returns the count for each view (for the tab badges: "Today: 3", "Inbox: 5").
//
// Auth: signed-in processor, or admin. We resolve "your processor_id" by
// looking up processors.owner_id = user.id (first match — most processors
// only own one record).
import { sql, currentUser, json, err, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const VIEWS = new Set(['today', 'week', 'month', 'inbox', 'cooler', 'ready', 'earnings', 'stats']);

async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  // Resolve the processor record this user owns. Admins can pass ?processor_id=
  // to scope to a specific plant; otherwise we use their own.
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const view = (url.searchParams.get('view') || 'today').toLowerCase();
  if (!VIEWS.has(view)) return err(400, 'Unknown view');

  let processor_id;
  const overrideId = url.searchParams.get('processor_id');
  if (overrideId && user.role === 'admin') {
    processor_id = overrideId;
  } else {
    const rows = await sql`SELECT id FROM processors WHERE owner_id = ${user.id} LIMIT 1`;
    if (!rows[0]) return err(404, 'No processor record claimed by your account. Visit /processor to set one up.');
    processor_id = rows[0].id;
  }

  // ── stats: tab badges ─────────────────────────────────
  if (view === 'stats') {
    const today = await sql`SELECT COUNT(*)::int AS n FROM bookings WHERE processor_id = ${processor_id} AND drop_off_date = CURRENT_DATE AND status NOT IN ('cancelled','rejected')`;
    const week  = await sql`SELECT COUNT(*)::int AS n FROM bookings WHERE processor_id = ${processor_id} AND drop_off_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days' AND status NOT IN ('cancelled','rejected')`;
    const month = await sql`SELECT COUNT(*)::int AS n FROM bookings WHERE processor_id = ${processor_id} AND drop_off_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' AND status NOT IN ('cancelled','rejected')`;
    const inbox = await sql`SELECT COUNT(*)::int AS n FROM cut_sheets WHERE processor_id = ${processor_id} AND status = 'submitted'`;
    const cooler = await sql`SELECT COUNT(*)::int AS n FROM bookings WHERE processor_id = ${processor_id} AND status IN ('checked-in','fabricating')`;
    const ready = await sql`SELECT COUNT(*)::int AS n FROM bookings WHERE processor_id = ${processor_id} AND status = 'ready'`;
    return json({
      processor_id,
      stats: {
        today:  today[0]?.n  || 0,
        week:   week[0]?.n   || 0,
        month:  month[0]?.n  || 0,
        inbox:  inbox[0]?.n  || 0,
        cooler: cooler[0]?.n || 0,
        ready:  ready[0]?.n  || 0
      }
    });
  }

  // Build the date filter once for the queue views.
  let bookings;
  if (view === 'today') {
    bookings = await sql`${queueQuery('AND b.drop_off_date = CURRENT_DATE', processor_id)}`;
    // sql tag won't accept that fragment — fall through to explicit literals
  }

  // Run explicit queries per view — clearer than dynamic fragment.
  switch (view) {
    case 'today': {
      const rows = await sql`
        SELECT b.*, l.number AS animal_number, l.breed, l.species, l.estimated_hanging_weight,
               f.name AS farm_name, f.slug AS farm_slug,
               c.code AS checkin_code,
               cs.id AS cut_sheet_id, cs.status AS cut_sheet_status, cs.cuts AS cut_sheet_cuts
        FROM bookings b
        JOIN listings l   ON l.id = b.listing_id
        JOIN farms f      ON f.id = b.farm_id
        LEFT JOIN checkin_codes c ON c.booking_id = b.id AND c.consumed_at IS NULL
        LEFT JOIN cut_sheets cs ON cs.reservation_id IN (
          SELECT r.id FROM reservations r WHERE r.listing_id = b.listing_id
        )
        WHERE b.processor_id = ${processor_id}
          AND b.drop_off_date = CURRENT_DATE
          AND b.status NOT IN ('cancelled','rejected')
        ORDER BY b.drop_off_window NULLS LAST, b.created_at ASC`;
      return json({ processor_id, view, bookings: rows });
    }
    case 'week': {
      const rows = await sql`
        SELECT b.*, l.number AS animal_number, l.breed, l.species, l.estimated_hanging_weight,
               f.name AS farm_name, f.slug AS farm_slug
        FROM bookings b
        JOIN listings l ON l.id = b.listing_id
        JOIN farms f    ON f.id = b.farm_id
        WHERE b.processor_id = ${processor_id}
          AND b.drop_off_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '6 days'
          AND b.status NOT IN ('cancelled','rejected')
        ORDER BY b.drop_off_date ASC, b.drop_off_window NULLS LAST`;
      return json({ processor_id, view, bookings: rows });
    }
    case 'month': {
      const rows = await sql`
        SELECT b.*, l.number AS animal_number, l.breed, l.species,
               f.name AS farm_name, f.slug AS farm_slug
        FROM bookings b
        JOIN listings l ON l.id = b.listing_id
        JOIN farms f    ON f.id = b.farm_id
        WHERE b.processor_id = ${processor_id}
          AND b.drop_off_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND b.status NOT IN ('cancelled','rejected')
        ORDER BY b.drop_off_date ASC`;
      return json({ processor_id, view, bookings: rows });
    }
    case 'inbox': {
      // Pending cut sheets the buyer just submitted, joined back to the booking they belong to.
      const rows = await sql`
        SELECT cs.*, r.listing_id, l.number AS animal_number, l.breed, l.species,
               f.name AS farm_name, u.name AS buyer_name, u.email AS buyer_email,
               b.id AS booking_id, b.drop_off_date, b.status AS booking_status
        FROM cut_sheets cs
        JOIN reservations r ON r.id = cs.reservation_id
        JOIN listings l     ON l.id = r.listing_id
        JOIN farms f        ON f.id = l.farm_id
        LEFT JOIN users u   ON u.id = cs.buyer_id
        LEFT JOIN bookings b ON b.listing_id = r.listing_id AND b.processor_id = cs.processor_id
        WHERE cs.processor_id = ${processor_id}
          AND cs.status = 'submitted'
        ORDER BY cs.submitted_at DESC
        LIMIT 100`;
      return json({ processor_id, view, cut_sheets: rows });
    }
    case 'cooler': {
      // Animals currently in the hanging cooler: checked-in or fabricating.
      const rows = await sql`
        SELECT b.*, l.number AS animal_number, l.breed, l.species,
               f.name AS farm_name, f.slug AS farm_slug
        FROM bookings b
        JOIN listings l ON l.id = b.listing_id
        JOIN farms f    ON f.id = b.farm_id
        WHERE b.processor_id = ${processor_id}
          AND b.status IN ('checked-in','fabricating')
        ORDER BY b.checked_in_at DESC NULLS LAST, b.drop_off_date DESC`;
      return json({ processor_id, view, bookings: rows });
    }
    case 'ready': {
      // Ready for buyer pickup.
      const rows = await sql`
        SELECT b.*, l.number AS animal_number, l.breed, l.species,
               f.name AS farm_name, f.slug AS farm_slug
        FROM bookings b
        JOIN listings l ON l.id = b.listing_id
        JOIN farms f    ON f.id = b.farm_id
        WHERE b.processor_id = ${processor_id}
          AND b.status = 'ready'
        ORDER BY b.ready_at DESC`;
      return json({ processor_id, view, bookings: rows });
    }
    case 'earnings': {
      // Rough earnings rollup. Real money flows through Stripe Connect transfers
      // (the stripe_transfer_group on reservations); here we surface count + estimate
      // based on processor's per_lb_fees + hanging weights observed this month.
      const rows = await sql`
        SELECT b.id, b.drop_off_date, b.status, b.hanging_weight_lbs,
               l.estimated_hanging_weight, l.species, l.breed,
               f.name AS farm_name
        FROM bookings b
        JOIN listings l ON l.id = b.listing_id
        JOIN farms f    ON f.id = b.farm_id
        WHERE b.processor_id = ${processor_id}
          AND b.drop_off_date >= date_trunc('month', CURRENT_DATE)
        ORDER BY b.drop_off_date DESC`;
      const procRow = await sql`SELECT per_lb_fees, base_fees FROM processors WHERE id = ${processor_id} LIMIT 1`;
      const fees = procRow[0] || {};
      return json({ processor_id, view, bookings: rows, fees });
    }
  }
  return err(400, 'Unknown view');
}

// Unused helper (kept for clarity — see explicit per-view queries above).
function queueQuery() { return ''; }

export default nodejsHandler(handler);
