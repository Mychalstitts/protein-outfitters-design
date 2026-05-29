// /api/admin-prospect — operate on discovered_partners rows from the map UI
//
//   PATCH /api/admin-prospect?id=<uuid>
//     body: { invite_status?, notes? }
//   POST  /api/admin-prospect?id=<uuid>&action=invite
//     → marks the row 'sent' and stamps invited_at + invited_by; if RESEND_API_KEY
//       is configured and the prospect has an email, also sends a recruiting email.
//
// Admin-only.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOWED_STATUS = ['new', 'queued', 'sent', 'bounced', 'clicked', 'signed_up', 'declined', 'dnc'];

const RECRUIT_TEMPLATES = {
  farm: {
    subject: 'Whole-animal demand near you — Protein Outfitters',
    text: ({ name, city, state }) =>
`Hi ${name?.split(' ')[0] || 'there'},

I'm Mychal Stittsworth, 4th-generation processor in Bemidji and the founder of Protein Outfitters. We connect direct-to-consumer livestock buyers to farms in their region for whole-animal sales (quarter / half / whole), and the platform handles deposits, cut sheets, processor scheduling, and pickup notifications.

We're seeing buyer demand near ${city || state || 'your area'} that doesn't have a farm listed nearby. If you raise cattle, hog, or lamb and want to clear inventory at retail-direct margins, listing on Protein Outfitters takes about 5 minutes.

Reply if you want a 10-minute look. No middleman fees on the farmer side.

— Mychal Stittsworth · Stittsworth Meats · Bemidji, MN
   https://www.proteinoutfitters.com/farmer
`,
  },
  processor: {
    subject: 'Drop-off bookings looking for a processor near ${city}',
    text: ({ name, city, state }) =>
`Hi ${name?.split(' ')[0] || 'there'},

I'm Mychal Stittsworth, 4th-generation processor in Bemidji and the founder of Protein Outfitters. We connect direct-to-consumer livestock buyers to farms, and farmers need processors to handle drop-offs.

We're seeing booking demand near ${city || state || 'your area'} that doesn't have a partnered processor. If you cut and wrap on commission, joining is free — we send pre-paid bookings to your calendar with cut sheets already filled in.

Reply if you want a quick look. We pay you direct via Stripe Connect.

— Mychal Stittsworth · Stittsworth Meats · Bemidji, MN
   https://www.proteinoutfitters.com/processor
`,
  },
};

export default async function handler(req) {
  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const id = url.searchParams.get('id');
  if (!id) return err(400, 'id required');

  if (req.method === 'PATCH') {
    let body = {};
    try { body = await req.json(); } catch {}
    const status = body.invite_status;
    const notes = body.notes;
    if (status && !ALLOWED_STATUS.includes(status)) return err(400, `invalid status: ${status}`);
    const sets = [];
    const params = [];
    let i = 1;
    if (status)        { sets.push(`invite_status = $${i++}`); params.push(status); }
    if (notes != null) { sets.push(`notes = $${i++}`); params.push(notes); }
    if (!sets.length) return err(400, 'nothing to update');
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rawQuery } = await import('./_lib/db.js');
    const rows = await rawQuery(`UPDATE discovered_partners SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (!rows[0]) return err(404, 'prospect not found');
    return json({ prospect: rows[0] });
  }

  if (req.method === 'POST' && url.searchParams.get('action') === 'invite') {
    const rows = await sql`SELECT * FROM discovered_partners WHERE id = ${id} LIMIT 1`;
    const p = rows[0];
    if (!p) return err(404, 'prospect not found');

    let emailSent = false;
    let emailError = null;
    if (p.email && process.env.RESEND_API_KEY) {
      const tmpl = RECRUIT_TEMPLATES[p.kind];
      if (tmpl) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: process.env.RESEND_FROM || 'Mychal Stittsworth <hello@proteinoutfitters.com>',
              to: p.email,
              subject: tmpl.subject,
              text: tmpl.text({ name: p.name, city: p.city, state: p.state }),
            }),
          });
          if (r.ok) emailSent = true;
          else emailError = `Resend ${r.status}: ${(await r.text()).slice(0, 100)}`;
        } catch (e) { emailError = String(e.message || e).slice(0, 200); }
      }
    }

    await sql`
      UPDATE discovered_partners
      SET invite_status = 'sent',
          invited_at = NOW(),
          invited_by = ${user.id},
          updated_at = NOW()
      WHERE id = ${id}`;

    return json({
      ok: true, id, email_sent: emailSent, email_error: emailError,
      message: emailSent ? `Recruiting email sent to ${p.email}` :
        p.email ? 'Marked invited (email failed: ' + (emailError || 'no API key') + ')' :
        'Marked invited (no email on record — outreach by phone or mail)',
    });
  }

  return err(405, 'Method not allowed');
}
