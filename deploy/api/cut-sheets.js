// /api/cut-sheets
//   POST { reservation_id, species, cuts: [], pills: [], quarter?, notes? }
//     → INSERTs a row into cut_sheets, ties it to the processor on the
//       reservation, and emails the processor a "new cut sheet" notification.
//   GET  ?reservation_id=UUID
//     → { cut_sheet } for the signed-in buyer (or null if none yet)
//
// Auth: must own the reservation (reservations.buyer_id = user.id) OR be
// the processor handling it OR an admin. We allow re-submission — the
// buyer can update their cut sheet up until the processor accepts it.

import { sql, currentUser, json, err, isUuid, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };
// Lightweight direct-Resend send. We don't go through sendLifecycleEmail()
// because that requires a registered template and idempotency keys we don't
// want here (a buyer revising a cut sheet should send a fresh notification).
async function notifyProcessor({ to, subject, html, reservation_id, processor_id }) {
  // Always log, even when API key missing (so admins can see what would have sent in dev).
  const from = process.env.RESEND_FROM || 'Protein Outfitters <hello@proteinoutfitters.com>';
  if (!process.env.RESEND_API_KEY) {
    await sql`
      INSERT INTO email_log (template_id, to_email, subject, status, reservation_id, processor_id, error)
      VALUES ('cut_sheet_submitted', ${to}, ${subject}, 'skipped', ${reservation_id}, ${processor_id}, 'RESEND_API_KEY missing')
    `.catch(() => {});
    return { sent: false, skipped: 'no_api_key' };
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({ from, to, subject, html });
    const providerId = result?.data?.id || result?.id || null;
    await sql`
      INSERT INTO email_log (template_id, to_email, subject, status, provider_id, reservation_id, processor_id)
      VALUES ('cut_sheet_submitted', ${to}, ${subject}, 'sent', ${providerId}, ${reservation_id}, ${processor_id})
    `.catch(() => {});
    return { sent: true, providerId };
  } catch (e) {
    await sql`
      INSERT INTO email_log (template_id, to_email, subject, status, reservation_id, processor_id, error)
      VALUES ('cut_sheet_submitted', ${to}, ${subject}, 'failed', ${reservation_id}, ${processor_id}, ${String(e).slice(0, 500)})
    `.catch(() => {});
    return { sent: false, error: String(e).slice(0, 200) };
  }
}

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));

  // ─── GET ────────────────────────────────
  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const reservation_id = url.searchParams.get('reservation_id');
    if (!reservation_id || !isUuid(reservation_id)) return err(400, 'reservation_id (UUID) required');

    const resRow = await sql`
      SELECT r.id, r.buyer_id, r.processor_id
      FROM reservations r
      WHERE r.id = ${reservation_id} LIMIT 1`;
    if (!resRow[0]) return err(404, 'Reservation not found');
    const reservation = resRow[0];

    // Buyer or processor-owner of this reservation, or admin
    const isProcessor = await isProcessorOwner(user, reservation.processor_id);
    if (reservation.buyer_id !== user.id && !isProcessor && user.role !== 'admin') {
      return err(403, 'Not your reservation');
    }

    const rows = await sql`
      SELECT id, reservation_id, buyer_id, processor_id, species, cuts, pills,
             quarter, notes, status, submitted_at, updated_at
      FROM cut_sheets
      WHERE reservation_id = ${reservation_id}
      ORDER BY submitted_at DESC LIMIT 1`;
    return json({ cut_sheet: rows[0] || null });
  }

  // ─── POST ───────────────────────────────
  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const reservation_id = body.reservation_id;
    if (!reservation_id || !isUuid(reservation_id)) {
      return err(400, 'reservation_id (UUID) required — make a reservation first');
    }

    const resRow = await sql`
      SELECT r.id, r.buyer_id, r.processor_id, r.listing_id,
             l.species AS listing_species, l.farm_id, f.name AS farm_name
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
      JOIN farms    f ON f.id = l.farm_id
      WHERE r.id = ${reservation_id} LIMIT 1`;
    if (!resRow[0]) return err(404, 'Reservation not found');
    const r = resRow[0];

    if (r.buyer_id !== user.id && user.role !== 'admin') {
      return err(403, 'Only the buyer of this reservation can submit a cut sheet');
    }

    // Sanitize JSON arrays — cap size so a maliciously huge payload can't bloat the row.
    const cuts   = Array.isArray(body.cuts)   ? body.cuts.slice(0, 200).map(String) : [];
    const pills  = Array.isArray(body.pills)  ? body.pills.slice(0, 100).map(String) : [];
    const species = String(body.species || r.listing_species || 'beef').slice(0, 30);
    const quarter = body.quarter ? String(body.quarter).slice(0, 20) : null;
    const notes   = body.notes   ? String(body.notes).slice(0, 2000)  : null;

    // Insert, replacing any prior submission for this reservation.
    // (Buyer can re-submit up until processor accepts — see status check below.)
    const existing = await sql`SELECT id, status FROM cut_sheets WHERE reservation_id = ${reservation_id} LIMIT 1`;
    if (existing[0] && existing[0].status === 'accepted') {
      return err(409, 'Cut sheet already accepted by the processor — contact them to revise');
    }

    // cuts + pills are JSONB columns; the Neon serverless driver passes raw
    // JS arrays as Postgres TEXT[] which Postgres rejects with "invalid input
    // syntax for type json". Stringify + explicit ::jsonb cast forces the
    // right path. (Same trick we'll need anywhere we INSERT/UPDATE a JS array
    // into JSONB.)
    const cutsJson  = JSON.stringify(cuts);
    const pillsJson = JSON.stringify(pills);

    let row;
    if (existing[0]) {
      row = await sql`
        UPDATE cut_sheets SET
          species = ${species},
          cuts    = ${cutsJson}::jsonb,
          pills   = ${pillsJson}::jsonb,
          quarter = ${quarter}, notes = ${notes},
          status = 'submitted', submitted_at = NOW(), updated_at = NOW()
        WHERE id = ${existing[0].id}
        RETURNING *`;
    } else {
      row = await sql`
        INSERT INTO cut_sheets (reservation_id, buyer_id, processor_id, species, cuts, pills, quarter, notes, status)
        VALUES (${reservation_id}, ${user.id}, ${r.processor_id}, ${species},
                ${cutsJson}::jsonb, ${pillsJson}::jsonb,
                ${quarter}, ${notes}, 'submitted')
        RETURNING *`;
    }
    const cut_sheet = row[0];

    // Fire-and-forget email to the processor. Don't block the response on it.
    if (r.processor_id) {
      try {
        const procRow = await sql`SELECT name, email FROM processors WHERE id = ${r.processor_id} LIMIT 1`;
        const proc = procRow[0];
        if (proc && proc.email) {
          notifyProcessor({
            to: proc.email,
            subject: `New cut sheet from ${user.name || 'a buyer'} · ${r.farm_name}`,
            html: cutSheetEmailHtml({
              processor_name: proc.name,
              buyer_name: user.name || user.email,
              farm_name: r.farm_name,
              reservation_id,
              cuts_count: cuts.length,
              notes
            }),
            reservation_id,
            processor_id: r.processor_id
          }).catch(e => console.warn('[cut-sheets] email send failed:', e?.message));
        }
      } catch (e) {
        console.warn('[cut-sheets] could not look up processor email:', e?.message);
      }
    }

    return json({ cut_sheet });
  }

  return err(405, 'Method not allowed');
}

async function isProcessorOwner(user, processor_id) {
  if (!user || !processor_id) return false;
  const row = await sql`SELECT 1 FROM processors WHERE id = ${processor_id} AND owner_id = ${user.id} LIMIT 1`;
  return !!row[0];
}

function cutSheetEmailHtml({ processor_name, buyer_name, farm_name, reservation_id, cuts_count, notes }) {
  const safe = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const notesBlock = notes
    ? `<p style="margin:12px 0 0;padding:12px 14px;background:#f5f3ef;border-radius:10px;font-size:14px;line-height:1.5;color:#0a2012;">${safe(notes)}</p>`
    : '';
  return `
    <table cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;color:#061b0e;">
      <tr><td style="padding:32px 0;">
        <h1 style="margin:0 0 14px;font-size:24px;font-weight:800;letter-spacing:-.02em;">New cut sheet ready</h1>
        <p style="margin:0;font-size:15px;line-height:1.55;">
          ${safe(buyer_name)} just submitted a cut sheet for their ${safe(farm_name)} reservation.
          ${cuts_count} cuts selected.
        </p>
        ${notesBlock}
        <p style="margin:22px 0 0;">
          <a href="https://www.proteinoutfitters.com/processor-ops?reservation_id=${safe(reservation_id)}"
             style="background:#061b0e;color:#fbf9f5;padding:13px 22px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
             Open in your queue →
          </a>
        </p>
      </td></tr>
    </table>
  `;
}

export default nodejsHandler(handler);
