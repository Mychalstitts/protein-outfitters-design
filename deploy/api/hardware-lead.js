// /api/hardware-lead — capture + score quote requests from /hardware
//
//   POST body:
//     { full_name, email, phone?, role?, state?, existing_facility, timeline,
//       financing_help, bundle_interest?, notes? }
//   Returns: { lead_id, score, temperature }
//
// Lead scoring matrix (max 85 pts):
//   timeline:           0-3m=25, 3-6m=20, 6-12m=15, 12+m=10, exploring=0
//   existing_facility:  yes=10, no=5
//   bundle_interest:    full=20, mhu=15, single=10, other=5
//   financing_help:     yes=10
//   state:              MN/ND/WI/SD/IA=5
//   phone provided:     yes=5
//   role:               Farm owner/Processor/Locker=10, Co-op/Investor=5
// Temperature buckets:
//   hot   ≥ 60
//   warm  35–59
//   cold  < 35
//
// Side effects (best-effort, don't fail the response):
//   - Email Mychal directly with the lead summary (HARDWARE_LEADS_EMAIL env, defaults to mychal@proteinoutfitters.com)
//   - POST to HARDWARE_CRM_WEBHOOK_URL if set (HubSpot/Pipedrive/Salesforce/Zapier — generic JSON webhook)

import { sql, currentUser, err, json } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

// runtime: 'edge' — nodejs cold-start was timing out at 10-12s on Vercel
// (run-14 reproduction). Resend SDK is already lazy-imported inside the
// handler and works on edge.
export const config = { runtime: 'edge' };

const TIMELINE_PTS = { '0-3m': 25, '3-6m': 20, '6-12m': 15, '12+m': 10, 'exploring': 0 };
const ROLE_PTS = {
  'Farm owner': 10, 'Processor': 10, 'Locker operator': 10,
  'Co-op': 5, 'Investor': 5, 'Other': 0,
};
const NEAR_STATES = new Set(['MN','ND','WI','SD','IA','MT','MI','NE']);

function scoreLead(b) {
  let s = 0;
  s += TIMELINE_PTS[b.timeline] ?? 0;
  if (b.existing_facility === 'yes') s += 10;
  else if (b.existing_facility === 'no') s += 5;
  if (b.bundle_interest === 'full') s += 20;
  else if (b.bundle_interest === 'mhu') s += 15;
  else if (b.bundle_interest === 'single') s += 10;
  else if (b.bundle_interest) s += 5;
  if (b.financing_help) s += 10;
  if (b.state && NEAR_STATES.has(String(b.state).toUpperCase().slice(0, 2))) s += 5;
  if (b.phone && String(b.phone).replace(/\D/g, '').length >= 7) s += 5;
  s += ROLE_PTS[b.role] ?? 0;
  return Math.min(85, s);
}

function temperatureFor(score) {
  return score >= 60 ? 'hot' : score >= 35 ? 'warm' : 'cold';
}

export default async function handler(req) {
  const url = new URL(req.url, 'https://www.proteinoutfitters.com');

  // ── GET: admin lead list ──
  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    const status = url.searchParams.get('status');
    const temp = url.searchParams.get('temperature');
    let rows;
    if (status && temp) {
      rows = await sql`SELECT * FROM hardware_leads WHERE status = ${status} AND temperature = ${temp} ORDER BY created_at DESC LIMIT 200`;
    } else if (status) {
      rows = await sql`SELECT * FROM hardware_leads WHERE status = ${status} ORDER BY created_at DESC LIMIT 200`;
    } else if (temp) {
      rows = await sql`SELECT * FROM hardware_leads WHERE temperature = ${temp} ORDER BY created_at DESC LIMIT 200`;
    } else {
      rows = await sql`SELECT * FROM hardware_leads ORDER BY created_at DESC LIMIT 200`;
    }
    return json({ leads: rows });
  }

  // ── PATCH: admin status update ──
  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    const id = url.searchParams.get('id');
    if (!id) return err(400, 'id required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { status, notes, crm_external_id } = body;
    const allowedStatuses = ['new','contacted','qualified','disqualified','closed_won','closed_lost'];
    if (status && !allowedStatuses.includes(status)) return err(400, `Invalid status: ${status}`);
    const sets = [];
    const params = [];
    let i = 1;
    if (status)               { sets.push(`status = $${i++}`); params.push(status); }
    if (notes != null)        { sets.push(`notes = $${i++}`); params.push(notes); }
    if (crm_external_id)      { sets.push(`crm_external_id = $${i++}, crm_synced_at = NOW()`); params.push(crm_external_id); }
    if (!sets.length) return err(400, 'Nothing to update');
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rawQuery } = await import('./_lib/db.js');
    const rows = await rawQuery(`UPDATE hardware_leads SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (!rows[0]) return err(404, 'Lead not found');
    return json({ lead: rows[0] });
  }

  // ── POST: capture a new lead ──
  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!b.full_name || !String(b.full_name).trim()) return err(400, 'full_name required');
    if (!b.email || !/^[^@\s]+@[^@\s]+$/.test(b.email)) return err(400, 'valid email required');

    const score = scoreLead(b);
    const temperature = temperatureFor(score);

    const rows = await sql`
      INSERT INTO hardware_leads (
        full_name, email, phone, role, state,
        existing_facility, timeline, financing_help, bundle_interest, notes,
        score, temperature
      ) VALUES (
        ${b.full_name.trim()},
        ${String(b.email).trim().toLowerCase()},
        ${b.phone || null},
        ${b.role || null},
        ${(b.state || '').toString().toUpperCase().slice(0, 2) || null},
        ${b.existing_facility || 'unknown'},
        ${b.timeline || 'unknown'},
        ${!!b.financing_help},
        ${b.bundle_interest || null},
        ${b.notes || null},
        ${score},
        ${temperature}
      )
      RETURNING id, score, temperature, created_at`;
    const lead = rows[0];

    // ── Side effect 1: notify the sales lead (Mychal) ──
    try {
      const adminTo = process.env.HARDWARE_LEADS_EMAIL || 'mychal@proteinoutfitters.com';
      const { Resend } = await import('resend');
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.RESEND_FROM || 'Protein Outfitters <hello@proteinoutfitters.com>',
          to: adminTo,
          subject: `${temperature.toUpperCase()} hardware lead — ${b.full_name} (${score}/85)`,
          html: `<div style="font:500 14px/1.55 -apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#061b0e;max-width:560px;">
<h2 style="font-weight:800;font-size:18px;margin:0 0 12px;">New ${temperature} hardware lead — score ${score}/85</h2>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Name</td><td style="padding:6px 10px;background:#f5f1e8;">${b.full_name}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:700;">Email</td><td style="padding:6px 10px;"><a href="mailto:${b.email}">${b.email}</a></td></tr>
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Phone</td><td style="padding:6px 10px;background:#f5f1e8;">${b.phone || '—'}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:700;">Role</td><td style="padding:6px 10px;">${b.role || '—'}</td></tr>
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">State</td><td style="padding:6px 10px;background:#f5f1e8;">${b.state || '—'}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:700;">Existing facility</td><td style="padding:6px 10px;">${b.existing_facility || '—'}</td></tr>
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Timeline</td><td style="padding:6px 10px;background:#f5f1e8;">${b.timeline || '—'}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:700;">Wants financing help</td><td style="padding:6px 10px;">${b.financing_help ? 'yes' : 'no'}</td></tr>
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Bundle interest</td><td style="padding:6px 10px;background:#f5f1e8;">${b.bundle_interest || '—'}</td></tr>
</table>
${b.notes ? `<p style="margin-top:16px;padding:12px 14px;background:#f5f1e8;border-radius:8px;font-size:13px;"><strong>Notes:</strong><br>${String(b.notes).replace(/\n/g, '<br>')}</p>` : ''}
<p style="margin-top:16px;font-size:12px;color:#5a6359;">Lead ID: ${lead.id} · admin view: <a href="https://www.proteinoutfitters.com/admin-overview">/admin-overview</a></p>
</div>`,
        });
      }
    } catch (e) { console.error('Lead notification failed:', e.message); }

    // ── Side effect 2: post to generic CRM webhook ──
    if (process.env.HARDWARE_CRM_WEBHOOK_URL) {
      try {
        const r = await fetch(process.env.HARDWARE_CRM_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'protein-outfitters/hardware',
            lead_id: lead.id,
            score,
            temperature,
            ...b,
          }),
        });
        if (r.ok) {
          const out = await r.json().catch(() => ({}));
          if (out.id || out.external_id) {
            await sql`UPDATE hardware_leads SET crm_external_id = ${out.id || out.external_id}, crm_synced_at = NOW() WHERE id = ${lead.id}`;
          } else {
            await sql`UPDATE hardware_leads SET crm_synced_at = NOW() WHERE id = ${lead.id}`;
          }
        }
      } catch (e) { console.error('CRM webhook failed:', e.message); }
    }

    // ── Side effect 3: best-effort acknowledgment to the lead ──
    try {
      await sendLifecycleEmail('Hardware.lead_received', {
        to: b.email,
        full_name: b.full_name,
        bundle_interest: b.bundle_interest,
        timeline: b.timeline,
        dedupKey: `Hardware.lead::${lead.id}`,
      });
    } catch (e) { /* template may not exist; that's fine */ }

    return json({ lead_id: lead.id, score, temperature, created_at: lead.created_at });
  }

  return err(405, 'Method not allowed');
}
