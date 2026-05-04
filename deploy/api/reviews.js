// /api/reviews
//   GET ?subject_type=farm&subject_id=UUID → reviews about that farm/processor (only revealed)
//   POST {reservation_id, subject_type, subject_id, rating, body} → submit review
//   When both sides of a reservation have submitted, both get revealed_at = NOW().
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const subject_type = url.searchParams.get('subject_type');
    const subject_id = url.searchParams.get('subject_id');
    if (!subject_type || !subject_id) return err(400, 'subject_type and subject_id required');
    const rows = await sql`
      SELECT r.id, r.rating, r.body, r.submitted_at, r.revealed_at, u.name as reviewer_name, r.reviewer_role
      FROM reviews r
      LEFT JOIN users u ON u.id = r.reviewer_id
      WHERE r.subject_type = ${subject_type} AND r.subject_id = ${subject_id} AND r.revealed_at IS NOT NULL
      ORDER BY r.revealed_at DESC LIMIT 50
    `;
    return json({ reviews: rows });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body.reservation_id || !body.subject_type || !body.subject_id || !body.rating) {
      return err(400, 'reservation_id, subject_type, subject_id, rating required');
    }

    const reservRow = await sql`SELECT id, buyer_id FROM reservations WHERE id = ${body.reservation_id} LIMIT 1`;
    if (!reservRow[0]) return err(404, 'Reservation not found');

    const reviewer_role = user.role === 'producer' ? 'farmer' : (user.role === 'processor' ? 'processor' : 'buyer');

    // Check user hasn't already reviewed this reservation as this role
    const dup = await sql`SELECT 1 FROM reviews WHERE reservation_id = ${body.reservation_id} AND reviewer_id = ${user.id} LIMIT 1`;
    if (dup[0]) return err(409, 'Already reviewed');

    const rev = await sql`
      INSERT INTO reviews (reservation_id, reviewer_id, reviewer_role, subject_type, subject_id, rating, body)
      VALUES (${body.reservation_id}, ${user.id}, ${reviewer_role}, ${body.subject_type}, ${body.subject_id}, ${body.rating}, ${body.body || null})
      RETURNING *
    `;

    // Mutual reveal: if there are two reviews on this reservation, mark both revealed
    const both = await sql`SELECT COUNT(*) as n FROM reviews WHERE reservation_id = ${body.reservation_id}`;
    if (parseInt(both[0].n) >= 2) {
      await sql`UPDATE reviews SET revealed_at = NOW() WHERE reservation_id = ${body.reservation_id} AND revealed_at IS NULL`;
    }

    return json({ review: rev[0] });
  }

  return err(405, 'Method not allowed');
}
