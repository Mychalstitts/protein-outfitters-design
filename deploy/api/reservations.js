// /api/reservations
//   GET   → reservations for current user (auth required)
//   POST  → create reservation (auth optional — uses email)
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
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
