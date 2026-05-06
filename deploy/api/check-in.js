// /api/check-in — processor scans / enters the farmer's 6-digit code at drop-off.
//
//   POST { code, processor_slug }
//     - Validates code exists, not consumed, belongs to a booking with this processor.
//     - Marks booking 'checked-in', releases the deposit, flips active reservations
//       on this listing to 'processing', fires C16 (animal arrived) per buyer.
//     - Returns { booking, animal, buyers_notified }.
//
// Auth: must be signed-in user who owns the processor (or admin).

import { sql, currentUser, err, json } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const code = (body.code || '').trim();
  const processorSlug = (body.processor_slug || '').trim();
  if (!/^\d{6}$/.test(code)) return err(400, 'code must be a 6-digit string');
  if (!processorSlug) return err(400, 'processor_slug required');

  // Resolve processor + auth
  const procRow = await sql`SELECT id, owner_id, name FROM processors WHERE slug = ${processorSlug} LIMIT 1`;
  if (!procRow[0]) return err(404, 'Processor not found');
  if (procRow[0].owner_id !== user.id && user.role !== 'admin') {
    return err(403, 'Not your processor');
  }

  // Look up the code
  const codeRow = await sql`
    SELECT cc.code, cc.consumed_at, b.id AS booking_id, b.status AS booking_status,
           b.processor_id, b.listing_id,
           l.number AS animal_number, l.breed, l.species, l.expected_finish_date,
           f.name AS farm_name
    FROM checkin_codes cc
    JOIN bookings b ON b.id = cc.booking_id
    JOIN listings l ON l.id = b.listing_id
    JOIN farms f ON f.id = b.farm_id
    WHERE cc.code = ${code} LIMIT 1`;
  const c = codeRow[0];
  if (!c) return err(404, 'Code not found — double-check the digits with the farmer');
  if (c.consumed_at) return err(409, 'Code already used');
  if (c.processor_id !== procRow[0].id) return err(409, 'Code is for a different processor');
  if (c.booking_status !== 'scheduled') return err(409, `Booking is ${c.booking_status}, not scheduled`);

  // Mark check-in
  const ts = new Date().toISOString();
  await sql`UPDATE checkin_codes SET consumed_at = NOW(), consumed_by = ${user.id} WHERE code = ${code}`;
  await sql`UPDATE bookings SET status = 'checked-in', checked_in_at = NOW(), checked_in_by = ${user.id}, updated_at = NOW() WHERE id = ${c.booking_id}`;
  await sql`UPDATE farmer_deposits SET status = 'released', released_at = NOW(), updated_at = NOW() WHERE booking_id = ${c.booking_id}`;
  // Flip active reservations on this listing to 'processing'
  await sql`
    UPDATE reservations
    SET status = 'processing', updated_at = NOW()
    WHERE listing_id = ${c.listing_id}
      AND status IN ('deposit-paid','paid')`;

  // Fire C16 to all share buyers
  const buyers = await sql`
    SELECT id, buyer_email, buyer_name
    FROM reservations
    WHERE listing_id = ${c.listing_id}
      AND status = 'processing'`;
  const animalLabel = `${c.animal_number ? c.animal_number + ' · ' : ''}${c.breed || c.species || 'animal'}`;
  let notified = 0;
  for (const r of buyers) {
    if (!r.buyer_email) continue;
    try {
      const out = await sendLifecycleEmail('C16.animal_arrived', {
        to: r.buyer_email,
        reservation_id: r.id,
        buyer_name: r.buyer_name,
        animal_label: animalLabel,
        farm_name: c.farm_name,
        processor_name: procRow[0].name,
        estimated_ready_days: 18,
        dedupKey: `C16::${r.id}::${c.booking_id}`,
      });
      if (out.sent) notified++;
    } catch (e) { /* keep going */ }
  }

  return json({
    ok: true,
    booking: { id: c.booking_id, status: 'checked-in', checked_in_at: ts },
    animal: { animal_number: c.animal_number, breed: c.breed, species: c.species, farm_name: c.farm_name },
    buyers_notified: notified,
  });
}
