// /api/complaint — buyer-side quality complaint flow
//
//   POST { reservation_id, message, photos? }
//     - Authenticates the caller as the buyer (or admin).
//     - Inserts a row into the complaints table (bootstrapped on first call).
//     - Fires C20 to the buyer (acknowledgment).
//     - Returns { complaint_id }.
//
// Complaints are auto-bootstrapped because they're rare enough we don't need
// to lock down a migration cycle for them.

import { sql, currentUser, err, json } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'nodejs' };

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS complaints (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      filed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
      filed_by_email  TEXT,
      message         TEXT NOT NULL,
      photos          TEXT[] DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','under_review','resolved','denied')),
      resolution      TEXT,
      resolved_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS complaints_reservation_idx ON complaints(reservation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints(status)`;
}

export default async function handler(req) {
  await ensureSchema().catch(() => {});

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { reservation_id, message, photos } = body;
    if (!reservation_id) return err(400, 'reservation_id required');
    if (!message || message.trim().length < 10) return err(400, 'A short description is required');

    // Pull reservation + ensure caller is the buyer or admin
    const rows = await sql`
      SELECT r.*, l.species, l.breed, l.number, f.name AS farm_name, p.name AS processor_name
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
      JOIN farms f ON f.id = l.farm_id
      LEFT JOIN processors p ON p.id = r.processor_id
      WHERE r.id = ${reservation_id} LIMIT 1`;
    const r = rows[0];
    if (!r) return err(404, 'Reservation not found');
    const isBuyer = r.buyer_id === user.id || r.buyer_email === user.email;
    if (!isBuyer && user.role !== 'admin') return err(403, 'Not your reservation');

    // 7-day post-pickup window check (informational only — we still accept late ones, just flag them)
    const lateFlag = r.status === 'picked-up' && r.updated_at
      && (Date.now() - new Date(r.updated_at).getTime()) > 7 * 86400000;

    const ins = await sql`
      INSERT INTO complaints (reservation_id, filed_by, filed_by_email, message, photos)
      VALUES (${reservation_id}, ${user.id}, ${user.email}, ${message.trim()}, ${photos || []})
      RETURNING id, created_at`;
    const complaint = ins[0];

    // C20 acknowledgment
    try {
      const animalLabel = `${r.number ? r.number + ' · ' : ''}${r.breed || r.species || 'animal'}`;
      await sendLifecycleEmail('C20.complaint_received', {
        to: r.buyer_email,
        reservation_id,
        buyer_name: r.buyer_name,
        animal_label: animalLabel,
        processor_name: r.processor_name,
        complaint_id: complaint.id.slice(0, 8).toUpperCase(),
        dedupKey: `C20::${complaint.id}`,
      });
    } catch (e) { /* best-effort */ }

    return json({ complaint_id: complaint.id, late_flag: !!lateFlag, status: 'open' });
  }

  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
    const reservationId = url.searchParams.get('reservation_id');
    if (reservationId) {
      const rows = await sql`SELECT * FROM complaints WHERE reservation_id = ${reservationId} ORDER BY created_at DESC`;
      return json({ complaints: rows });
    }
    if (user.role === 'admin') {
      const rows = await sql`SELECT * FROM complaints WHERE status IN ('open','under_review') ORDER BY created_at ASC LIMIT 200`;
      return json({ complaints: rows });
    }
    return err(400, 'Pass reservation_id, or be admin to list all open complaints');
  }

  return err(405, 'Method not allowed');
}
