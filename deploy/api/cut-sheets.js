// /api/cut-sheets
//   POST { reservation_id, species, cuts: [], pills: [], quarter?, notes? }
//     → INSERTs a row into cut_sheets, ties it to the processor on the
//       reservation, and emails the processor a "new cut sheet" notification.
//   GET  ?reservation_id=UUID
//     → { cut_sheet } for the signed-in buyer (or null if none yet)
//   PATCH ?id=UUID { status: 'accepted'|'rejected', notes? }
//     → processor (owner of cut_sheets.processor_id) accepts or rejects the
//       sheet, clearing it out of their inbox. Returns { cut_sheet }.
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

  // ─── PATCH ──────────────────────────────
  // Processor accepts or rejects a submitted cut sheet. Until this existed the
  // processor's inbox (/api/processor-ops?view=inbox filters status='submitted')
  // never cleared.
  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    const id = url.searchParams.get('id');
    if (!id || !isUuid(id)) return err(400, 'id (UUID) required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body || typeof body !== 'object') return err(400, 'Body must be a JSON object');

    // The cut_sheets CHECK constraint allows draft|submitted|accepted|rejected;
    // this endpoint only ever performs the processor's two decisions.
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    if (status !== 'accepted' && status !== 'rejected') {
      return err(400, "status must be 'accepted' or 'rejected'");
    }
    const notes = body.notes == null ? null : String(body.notes).slice(0, 2000);

    const sheetRow = await sql`
      SELECT cs.id, cs.reservation_id, cs.buyer_id, cs.processor_id, cs.status,
             cs.submitted_at,
             r.buyer_email AS reservation_buyer_email,
             u.email       AS buyer_user_email,
             p.name        AS processor_name
      FROM cut_sheets cs
      LEFT JOIN reservations r ON r.id = cs.reservation_id
      LEFT JOIN users u        ON u.id = cs.buyer_id
      LEFT JOIN processors p   ON p.id = cs.processor_id
      WHERE cs.id = ${id} LIMIT 1`;
    if (!sheetRow[0]) return err(404, 'Cut sheet not found');
    const sheet = sheetRow[0];

    // Auth: only the processor this sheet is assigned to (or an admin).
    const isProcessor = await isProcessorOwner(user, sheet.processor_id);
    if (!isProcessor && user.role !== 'admin') {
      return err(403, 'Only the processor this cut sheet was sent to can accept or reject it');
    }

    // Transitions: only ever out of 'submitted'. Re-accepting an already
    // accepted sheet is a no-op success so a double-tap in the inbox doesn't
    // surface an error (and doesn't re-notify anyone).
    if (sheet.status !== 'submitted') {
      if (sheet.status === status) {
        // Same decision again — a double-tap in the inbox, not an error. No
        // re-notify. Accept and reject behave identically here.
        const current = await sql`SELECT * FROM cut_sheets WHERE id = ${id} LIMIT 1`;
        return json({ cut_sheet: current[0], unchanged: true });
      }
      return err(409, `Cut sheet is '${sheet.status}' — only a 'submitted' cut sheet can be ${status}`);
    }

    const updated = notes === null
      ? await sql`
          UPDATE cut_sheets
          SET status = ${status}, updated_at = NOW()
          WHERE id = ${id}
          RETURNING *`
      : await sql`
          UPDATE cut_sheets
          SET status = ${status}, notes = ${notes}, updated_at = NOW()
          WHERE id = ${id}
          RETURNING *`;
    const cut_sheet = updated[0];

    // On rejection the buyer has to go rebuild their sheet, so tell them.
    // There is NO buyer-facing rejection template in the api/_lib/email.js
    // registry (the C-series covers reservation/arrival/pickup/complaint only),
    // and sendLifecycleEmail() silently no-ops on an unknown id — so instead we
    // write the in-app notification row directly, the same way stripe-webhook.js
    // does for events that have no lifecycle template. Best-effort: a failed
    // notification must never fail the processor's decision.
    if (status === 'rejected') {
      const buyerEmail = sheet.buyer_user_email || sheet.reservation_buyer_email;
      if (buyerEmail) {
        try {
          const reason = notes ? ` Reason: ${notes}` : '';
          // Keyed to the submission being rejected, so a re-submitted sheet
          // that gets rejected again produces a fresh notification.
          const dedupKey = `notif::cut_sheet_rejected::${cut_sheet.id}::${sheet.submitted_at ? new Date(sheet.submitted_at).toISOString() : 'na'}`;
          await sql`
            INSERT INTO notifications (user_email, kind, title, body, link_url, icon, dedup_key)
            VALUES (
              ${String(buyerEmail).toLowerCase()},
              'cut_sheet.rejected',
              ${`${sheet.processor_name || 'Your processor'} sent your cut sheet back`},
              ${`They couldn't run this cut sheet as written — open it, make the change, and resubmit.${reason}`},
              ${`/cut-sheet?reservation=${sheet.reservation_id || ''}`},
              'edit_note',
              ${dedupKey}
            )
            ON CONFLICT (dedup_key) DO NOTHING`;
        } catch (e) {
          console.warn('[cut-sheets] rejection notification failed:', e?.message);
        }
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
