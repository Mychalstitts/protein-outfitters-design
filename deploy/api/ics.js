// /api/ics?reservation=UUID  → .ics file the user can import into any calendar app.
// /api/ics?listing=UUID      → .ics for the listing's harvest date (producer-facing).
import { sql, err, isUuid } from './_lib/db.js';

export const config = { runtime: 'edge' };

function ics(s) {
  return String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
}
function icsDate(d) {
  // YYYYMMDD (all-day) — UTC-safe for the date itself
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
function dateRange(start, days = 1) {
  const e = new Date(start); e.setUTCDate(e.getUTCDate() + days);
  return e;
}

function toIcs(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Protein Outfitters//Marketplace//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];
  events.forEach(ev => {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + ev.uid + '@proteinoutfitters.com');
    lines.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'));
    lines.push('DTSTART;VALUE=DATE:' + ev.dtStart);
    if (ev.dtEnd) lines.push('DTEND;VALUE=DATE:' + ev.dtEnd);
    lines.push('SUMMARY:' + ics(ev.summary));
    if (ev.description) lines.push('DESCRIPTION:' + ics(ev.description));
    if (ev.location) lines.push('LOCATION:' + ics(ev.location));
    if (ev.url) lines.push('URL:' + ev.url);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export default async function handler(req) {
  const url = new URL(req.url);
  const reservationId = url.searchParams.get('reservation');
  const listingId = url.searchParams.get('listing');
  if (reservationId && !isUuid(reservationId)) return err(400, 'reservation must be a UUID');
  if (listingId && !isUuid(listingId)) return err(400, 'listing must be a UUID');

  let events = [];
  let filename = 'protein-outfitters.ics';

  if (reservationId) {
    const rows = await sql`
      SELECT r.*, l.species, l.breed, l.number, l.expected_finish_date, f.name as farm_name, f.city as farm_city, f.state as farm_state
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
      JOIN farms f ON f.id = l.farm_id
      WHERE r.id = ${reservationId}
      LIMIT 1
    `;
    if (!rows[0]) return err(404, 'Reservation not found');
    const r = rows[0];
    const finish = icsDate(r.expected_finish_date || new Date());
    if (finish) {
      events.push({
        uid: 'reservation-harvest-' + r.id,
        dtStart: finish,
        dtEnd: icsDate(dateRange(r.expected_finish_date)),
        summary: `Harvest: ${r.share_size} ${r.breed || r.species} from ${r.farm_name}`,
        description: `Reservation #${r.id.slice(0,8)} · ${r.share_size} share of ${r.number || r.breed || r.species}. Cuts ready ~10-21 days after harvest.`,
        location: `${r.farm_city || ''}${r.farm_city && r.farm_state ? ', ' : ''}${r.farm_state || ''}`,
        url: `https://www.proteinoutfitters.com/account`
      });
      // Also add an estimated pickup window (14 days after harvest)
      const pickup = new Date(r.expected_finish_date || Date.now());
      pickup.setUTCDate(pickup.getUTCDate() + 14);
      events.push({
        uid: 'reservation-pickup-' + r.id,
        dtStart: icsDate(pickup),
        dtEnd: icsDate(dateRange(pickup, 1)),
        summary: `Pickup window: ${r.breed || r.species} cuts ready`,
        description: `Estimated pickup window for reservation #${r.id.slice(0,8)}. Confirm with processor before driving.`,
        url: `https://www.proteinoutfitters.com/account`
      });
    }
    filename = `po-reservation-${r.id.slice(0,8)}.ics`;
  } else if (listingId) {
    const rows = await sql`
      SELECT l.*, f.name as farm_name, f.city as farm_city, f.state as farm_state
      FROM listings l JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${listingId} LIMIT 1
    `;
    if (!rows[0]) return err(404, 'Listing not found');
    const l = rows[0];
    const finish = icsDate(l.expected_finish_date || new Date());
    if (finish) {
      events.push({
        uid: 'listing-harvest-' + l.id,
        dtStart: finish,
        dtEnd: icsDate(dateRange(l.expected_finish_date)),
        summary: `Harvest: ${l.number || l.breed || l.species} from ${l.farm_name}`,
        description: l.description || '',
        location: `${l.farm_city || ''}${l.farm_city && l.farm_state ? ', ' : ''}${l.farm_state || ''}`,
        url: `https://www.proteinoutfitters.com/listing?id=${l.id}`
      });
    }
    filename = `po-listing-${l.id.slice(0,8)}.ics`;
  } else {
    return err(400, 'Provide ?reservation=UUID or ?listing=UUID');
  }

  return new Response(toIcs(events), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
