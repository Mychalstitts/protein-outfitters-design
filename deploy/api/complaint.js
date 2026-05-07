// /api/complaint — buyer reports a quality / fulfillment problem with a reservation
//
// POST  body: { reservation_id, message, summary?, photos?[] }
//        → { complaint_id, status }
//        Best-effort sends the customer an acknowledgment email and pings Mychal.
//
// GET   admin only → { complaints: [...] }   (most recent 200, optional ?status=)
// PATCH admin only → { complaint }            (?id=...) update status / resolution / refund
//
// Schema lives in api/migrate.js → CREATE TABLE complaints (id, reservation_id, buyer_email,
//                                   buyer_name, summary, detail, photos, status,
//                                   resolution, refund_cents, created_at, updated_at)
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const MAX_DETAIL = 4000;
const MAX_SUMMARY = 200;
const ALLOWED_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];

function summarize(text, n = MAX_SUMMARY) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

async function _handler(req) {
  const url = new URL(req.url);

  // ── POST: file a complaint ──
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { reservation_id, message, summary, photos } = body || {};
    if (!reservation_id) return err(400, 'reservation_id required');
    if (!message || String(message).trim().length < 10) {
      return err(400, 'message must be at least 10 characters');
    }
    const detail = String(message).trim().slice(0, MAX_DETAIL);
    const sum    = summarize(summary || detail);
    const photoArr = Array.isArray(photos) ? photos.filter(Boolean).slice(0, 8) : [];

    // Tie the complaint to the reservation when we can; copy buyer_email/name for
    // ops triage even when the reservation row gets deleted later.
    const rrows = await sql`
      SELECT id, buyer_email, buyer_name FROM reservations
      WHERE id = ${reservation_id} LIMIT 1`;
    if (!rrows[0]) return err(404, 'Reservation not found');
    const r = rrows[0];

    // Allow filing as a logged-in buyer OR anonymously (auth is best-effort).
    const user = await currentUser(req).catch(() => null);

    const buyerEmail = user?.email || r.buyer_email || null;
    const buyerName  = user?.name  || r.buyer_name  || null;

    const inserted = await sql`
      INSERT INTO complaints (reservation_id, buyer_email, buyer_name, summary, detail, photos, status)
      VALUES (${reservation_id}, ${buyerEmail}, ${buyerName}, ${sum}, ${detail},
              ${JSON.stringify(photoArr)}::jsonb, 'open')
      RETURNING id, status, created_at`;
    const c = inserted[0];

    // Best-effort acknowledgment to the buyer + ops alert. Failure here must not
    // bubble up — the complaint is already recorded in the DB.
    if (buyerEmail) {
      try {
        const { sendLifecycleEmail } = await import('./_lib/email.js');
        await sendLifecycleEmail('Complaint.received', {
          to: buyerEmail,
          buyer_name: buyerName,
          complaint_id: c.id,
          reservation_id,
          summary: sum,
          dedupKey: `Complaint.received::${c.id}`,
        });
      } catch (e) { console.error('Complaint ack email failed:', e.message); }
    }
    try {
      const adminTo = process.env.OPS_COMPLAINTS_EMAIL || process.env.HARDWARE_LEADS_EMAIL || 'mychal@proteinoutfitters.com';
      if (process.env.RESEND_API_KEY) {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'Protein Outfitters <hello@proteinoutfitters.com>',
          to: adminTo,
          subject: `New complaint — ${sum}`,
          html: `<div style="font:500 14px/1.55 -apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#061b0e;max-width:560px;">
<h2 style="margin:0 0 12px;font-size:18px;font-weight:800;">New complaint</h2>
<p><strong>Case:</strong> ${c.id}</p>
<p><strong>Reservation:</strong> ${reservation_id}</p>
<p><strong>From:</strong> ${buyerName || '—'} ${buyerEmail ? `&lt;${buyerEmail}&gt;` : ''}</p>
<p><strong>Summary:</strong> ${sum}</p>
<pre style="white-space:pre-wrap;background:#f5f1e8;padding:12px;border-radius:8px;font:500 13px/1.5 ui-monospace,Menlo,monospace;">${detail.replace(/[<>]/g, '')}</pre>
<p style="margin-top:14px;font-size:12px;color:#5a6359;">Triage in <a href="https://www.proteinoutfitters.com/admin">/admin</a>.</p>
</div>`,
        });
      }
    } catch (e) { console.error('Complaint ops alert failed:', e.message); }

    return json({ complaint_id: c.id, status: c.status, created_at: c.created_at });
  }

  // ── GET: admin lists complaints ──
  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    const status = url.searchParams.get('status');
    const rows = status
      ? await sql`SELECT * FROM complaints WHERE status = ${status} ORDER BY created_at DESC LIMIT 200`
      : await sql`SELECT * FROM complaints ORDER BY created_at DESC LIMIT 200`;
    return json({ complaints: rows });
  }

  // ── PATCH: admin updates a complaint ──
  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    const id = url.searchParams.get('id');
    if (!id) return err(400, 'id required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { status, resolution, refund_cents } = body || {};
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return err(400, `Invalid status: ${status}`);
    }
    const sets = [];
    const params = [];
    let i = 1;
    if (status)               { sets.push(`status = $${i++}`); params.push(status); }
    if (resolution != null)   { sets.push(`resolution = $${i++}`); params.push(resolution); }
    if (refund_cents != null) { sets.push(`refund_cents = $${i++}`); params.push(refund_cents); }
    if (!sets.length) return err(400, 'Nothing to update');
    sets.push('updated_at = NOW()');
    params.push(id);
    const { rawQuery } = await import('./_lib/db.js');
    const rows = await rawQuery(
      `UPDATE complaints SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );
    if (!rows[0]) return err(404, 'Complaint not found');
    return json({ complaint: rows[0] });
  }

  return err(405, 'Method not allowed');
}

// Top-level guard — buyer should never see a generic Vercel FUNCTION_INVOCATION_FAILED.
export default async function handler(req) {
  try {
    return await _handler(req);
  } catch (e) {
    console.error('complaint crashed:', e?.stack || e?.message || e);
    return err(500, 'Could not file complaint. Email hello@proteinoutfitters.com and we will sort this out.');
  }
}
