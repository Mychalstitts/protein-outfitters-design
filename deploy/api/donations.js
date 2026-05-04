// /api/donations — pledges to donate an animal to a 501(c)(3) food bank partner
//   POST {listing_id, recipient_org, estimated_lb, fmv}
//   GET  → all donations for current user (auth) or all if admin
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let rows;
    if (user.role === 'admin') {
      rows = await sql`SELECT * FROM donations ORDER BY created_at DESC LIMIT 200`;
    } else {
      rows = await sql`SELECT * FROM donations WHERE donor_id = ${user.id} ORDER BY created_at DESC`;
    }
    return json({ donations: rows });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body.listing_id) return err(400, 'listing_id required');

    // Verify ownership of listing's farm
    const ownership = await sql`
      SELECT l.id FROM listings l JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${body.listing_id} AND f.owner_id = ${user.id} LIMIT 1
    `;
    if (!ownership[0]) return err(403, 'Not your listing');

    const rows = await sql`
      INSERT INTO donations (listing_id, donor_id, recipient_org, estimated_lb, fmv, notes)
      VALUES (${body.listing_id}, ${user.id}, ${body.recipient_org || null}, ${body.estimated_lb || null}, ${body.fmv || null}, ${body.notes || null})
      RETURNING *
    `;

    // Mark listing as 'donated'
    await sql`UPDATE listings SET status = 'donated', donate_to_foodbank = TRUE, donation_recipient_org = ${body.recipient_org || null}, updated_at = NOW() WHERE id = ${body.listing_id}`;

    return json({ donation: rows[0] });
  }

  return err(405, 'Method not allowed');
}
