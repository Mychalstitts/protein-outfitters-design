// /api/processor-requests — warm-lead service requests (Neon)
//
//   POST { processor_id? | processor_slug?, contact_name, contact_email,
//          contact_phone?, contact_zip?, animal_type, service_requested,
//          preferred_date?, notes? }
//     Auth required (cookie or Bearer). Writes to Neon and best-effort emails
//     the processor + confirmation to the consumer (Resend).
//
//   GET  ?mine=1                          → caller's own requests
//   GET  ?processor_id=… | ?slug=…        → requests for a plant (owner/admin)
//   GET  (admin, no filter)               → recent requests
//
// Replaces Supabase `processor_requests` insert used by the mobile request
// screen (Slice F / App Store path).

import { sql, rawQuery, currentUser, err, json, isUuid, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const SITE = 'https://www.proteinoutfitters.com';
const FROM = process.env.RESEND_FROM || 'Protein Outfitters <hello@proteinoutfitters.com>';
const FALLBACK_TO =
  process.env.REQUESTS_FALLBACK_EMAIL || 'support@proteinoutfitters.com';

const ANIMALS = new Set([
  'beef', 'pork', 'lamb', 'goat', 'poultry', 'venison', 'elk', 'wild_game', 'other',
]);
const SERVICES = new Set([
  'whole_animal_processing',
  'half_animal_processing',
  'quarter_animal_processing',
  'custom_cuts',
  'smoking',
  'sausage_making',
  'curing',
  'game_processing',
  'retail_purchase',
  'consultation',
]);
const STATUSES = new Set([
  'pending', 'accepted', 'declined', 'needs_info', 'completed', 'cancelled',
]);

const ANIMAL_LABELS = {
  beef: 'Beef', pork: 'Pork', lamb: 'Lamb', goat: 'Goat', poultry: 'Poultry',
  venison: 'Venison', elk: 'Elk', wild_game: 'Wild Game', other: 'Other',
};
const SERVICE_LABELS = {
  whole_animal_processing: 'Whole animal processing',
  half_animal_processing: 'Half animal processing',
  quarter_animal_processing: 'Quarter animal processing',
  custom_cuts: 'Custom cuts',
  smoking: 'Smoking',
  sausage_making: 'Sausage making',
  curing: 'Curing',
  game_processing: 'Game processing',
  retail_purchase: 'Retail purchase',
  consultation: 'Question / consultation',
};

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS processor_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processor_id UUID NOT NULL REFERENCES processors(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    contact_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_phone TEXT,
    contact_zip TEXT,
    animal_type TEXT NOT NULL,
    service_requested TEXT NOT NULL,
    preferred_date DATE,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','accepted','declined','needs_info','completed','cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await rawQuery(CREATE_TABLE);
  await rawQuery(`CREATE INDEX IF NOT EXISTS processor_requests_processor_idx ON processor_requests(processor_id)`);
  await rawQuery(`CREATE INDEX IF NOT EXISTS processor_requests_user_idx ON processor_requests(user_id)`);
  await rawQuery(`CREATE INDEX IF NOT EXISTS processor_requests_status_idx ON processor_requests(status)`);
  schemaReady = true;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

function isoDateOrNull(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function resolveProcessor({ processor_id, processor_slug }) {
  if (processor_id && isUuid(processor_id)) {
    const rows = await sql`
      SELECT id, slug, name, email, owner_id
      FROM processors WHERE id = ${processor_id} LIMIT 1`;
    return rows[0] || null;
  }
  const slug = (processor_slug || '').trim().slice(0, 80);
  if (slug) {
    const rows = await sql`
      SELECT id, slug, name, email, owner_id
      FROM processors WHERE slug = ${slug} LIMIT 1`;
    return rows[0] || null;
  }
  return null;
}

async function sendResend({ to, subject, text, html, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[processor-requests] RESEND_API_KEY missing — skip email to', to);
    return { sent: false, skipped: 'no_api_key' };
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = { from: FROM, to, subject, text, html };
  if (replyTo) payload.reply_to = replyTo;
  const result = await resend.emails.send(payload);
  return { sent: true, providerId: result?.data?.id || result?.id || null };
}

function processorEmailBodies(ctx) {
  const animal = ANIMAL_LABELS[ctx.animal] || ctx.animal;
  const service = SERVICE_LABELS[ctx.service] || ctx.service;
  const claimed = Boolean(ctx.processorIsClaimed);
  const subject = `New service request from ${ctx.consumerName} — ${animal}`;
  const text = [
    `Hi ${ctx.processorName},`,
    ``,
    `You have a new service request from a customer who found you on Protein Outfitters.`,
    ``,
    `--- THE REQUEST ---`,
    `Service:        ${service}`,
    `Animal:         ${animal}`,
    ctx.preferredDate ? `Preferred date: ${ctx.preferredDate}` : null,
    ctx.notes ? `Notes:          ${ctx.notes}` : null,
    ``,
    `--- THE CUSTOMER ---`,
    `Name:   ${ctx.consumerName}`,
    `Email:  ${ctx.consumerEmail}`,
    ctx.consumerPhone ? `Phone:  ${ctx.consumerPhone}` : null,
    ctx.consumerZip ? `ZIP:    ${ctx.consumerZip}` : null,
    ``,
    `Reply directly to this email to respond — your reply goes straight to ${ctx.consumerName}.`,
    ``,
    !claimed
      ? [
          `--- ARE YOU THE OWNER? ---`,
          `This listing hasn't been claimed yet. Claim it (free):`,
          `${SITE}/claim`,
          ``,
        ].join('\n')
      : null,
    `— Protein Outfitters`,
    SITE,
  ].filter((x) => x != null).join('\n');

  const claimBlock = !claimed
    ? `<div style="margin-top:16px;padding:14px;background:#f5f1e8;border-radius:8px;font-size:13px;">
         <strong>Are you the owner?</strong> Claim this listing free to manage requests and add pricing.
         <a href="${SITE}/claim">Claim now →</a>
       </div>`
    : '';

  const html = `<div style="font:500 14px/1.55 -apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#061b0e;max-width:560px;">
<h2 style="font-weight:800;font-size:18px;margin:0 0 12px;">New service request</h2>
<p>Hi ${escapeHtml(ctx.processorName)} — a customer found you on Protein Outfitters.</p>
<table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;">
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Service</td><td style="padding:6px 10px;background:#f5f1e8;">${escapeHtml(service)}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:700;">Animal</td><td style="padding:6px 10px;">${escapeHtml(animal)}</td></tr>
  ${ctx.preferredDate ? `<tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Preferred date</td><td style="padding:6px 10px;background:#f5f1e8;">${escapeHtml(ctx.preferredDate)}</td></tr>` : ''}
  ${ctx.notes ? `<tr><td style="padding:6px 10px;font-weight:700;vertical-align:top;">Notes</td><td style="padding:6px 10px;">${escapeHtml(ctx.notes).replace(/\n/g, '<br>')}</td></tr>` : ''}
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Name</td><td style="padding:6px 10px;background:#f5f1e8;">${escapeHtml(ctx.consumerName)}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:700;">Email</td><td style="padding:6px 10px;"><a href="mailto:${escapeHtml(ctx.consumerEmail)}">${escapeHtml(ctx.consumerEmail)}</a></td></tr>
  ${ctx.consumerPhone ? `<tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Phone</td><td style="padding:6px 10px;background:#f5f1e8;">${escapeHtml(ctx.consumerPhone)}</td></tr>` : ''}
  ${ctx.consumerZip ? `<tr><td style="padding:6px 10px;font-weight:700;">ZIP</td><td style="padding:6px 10px;">${escapeHtml(ctx.consumerZip)}</td></tr>` : ''}
</table>
<p style="font-size:13px;color:#5a6359;">Reply directly to this email — it goes to ${escapeHtml(ctx.consumerName)}.</p>
${claimBlock}
<p style="margin-top:16px;font-size:12px;color:#5a6359;">Request ${escapeHtml(ctx.requestId)} · ${SITE}</p>
</div>`;

  return { subject, text, html };
}

function consumerEmailBodies(ctx) {
  const animal = ANIMAL_LABELS[ctx.animal] || ctx.animal;
  const service = SERVICE_LABELS[ctx.service] || ctx.service;
  const subject = `We sent your request to ${ctx.processorName}`;
  const text = [
    `Hi ${ctx.consumerName},`,
    ``,
    `We forwarded your request to ${ctx.processorName}. They have your contact info and will reach out directly.`,
    ``,
    `Your request:`,
    `  Service: ${service}`,
    `  Animal:  ${animal}`,
    ctx.preferredDate ? `  Date:    ${ctx.preferredDate}` : null,
    ``,
    `If you don't hear back in a few days, try another processor on the map.`,
    ``,
    `— Protein Outfitters`,
    SITE,
  ].filter((x) => x != null).join('\n');

  const html = `<div style="font:500 14px/1.55 -apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#061b0e;max-width:560px;">
<h2 style="font-weight:800;font-size:18px;margin:0 0 12px;">Request sent</h2>
<p>Hi ${escapeHtml(ctx.consumerName)} — we forwarded your request to <strong>${escapeHtml(ctx.processorName)}</strong>.</p>
<table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;">
  <tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Service</td><td style="padding:6px 10px;background:#f5f1e8;">${escapeHtml(service)}</td></tr>
  <tr><td style="padding:6px 10px;font-weight:700;">Animal</td><td style="padding:6px 10px;">${escapeHtml(animal)}</td></tr>
  ${ctx.preferredDate ? `<tr><td style="padding:6px 10px;background:#f5f1e8;font-weight:700;">Preferred date</td><td style="padding:6px 10px;background:#f5f1e8;">${escapeHtml(ctx.preferredDate)}</td></tr>` : ''}
</table>
<p style="font-size:13px;color:#5a6359;">If you don't hear back in a few days, try another processor on the map.</p>
</div>`;

  return { subject, text, html };
}

async function notifyRequest(row, proc) {
  const ctx = {
    processorName: proc.name,
    processorIsClaimed: Boolean(proc.owner_id),
    consumerName: row.contact_name,
    consumerEmail: row.contact_email,
    consumerPhone: row.contact_phone,
    consumerZip: row.contact_zip,
    animal: row.animal_type,
    service: row.service_requested,
    preferredDate: row.preferred_date
      ? String(row.preferred_date).slice(0, 10)
      : null,
    notes: row.notes,
    requestId: row.id,
  };

  const processorTo = (proc.email && isEmail(proc.email))
    ? proc.email.trim()
    : FALLBACK_TO;

  const toProc = processorEmailBodies(ctx);
  const toConsumer = consumerEmailBodies(ctx);

  const results = await Promise.allSettled([
    sendResend({
      to: processorTo,
      subject: toProc.subject,
      text: toProc.text,
      html: toProc.html,
      replyTo: row.contact_email,
    }),
    sendResend({
      to: row.contact_email,
      subject: toConsumer.subject,
      text: toConsumer.text,
      html: toConsumer.html,
    }),
  ]);

  return {
    processor: results[0].status === 'fulfilled' ? results[0].value : { sent: false, error: String(results[0].reason) },
    consumer: results[1].status === 'fulfilled' ? results[1].value : { sent: false, error: String(results[1].reason) },
  };
}

async function handler(req) {
  await ensureSchema().catch((e) => {
    console.warn('[processor-requests] ensureSchema:', e?.message || e);
  });

  const url = new URL(req.url, 'https://www.proteinoutfitters.com');

  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    const mine = url.searchParams.get('mine') === '1';
    const processorId = url.searchParams.get('processor_id');
    const slug = (url.searchParams.get('slug') || '').trim();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

    if (mine) {
      const rows = await sql`
        SELECT r.*, p.name AS processor_name, p.slug AS processor_slug
        FROM processor_requests r
        JOIN processors p ON p.id = r.processor_id
        WHERE r.user_id = ${user.id}
        ORDER BY r.created_at DESC
        LIMIT ${limit}`;
      return json({ requests: rows });
    }

    if (processorId || slug) {
      const proc = await resolveProcessor({
        processor_id: processorId,
        processor_slug: slug,
      });
      if (!proc) return err(404, 'Processor not found');
      const isOwner = proc.owner_id === user.id;
      if (!isOwner && user.role !== 'admin') return err(403, 'Not your processor');
      const rows = await sql`
        SELECT r.*
        FROM processor_requests r
        WHERE r.processor_id = ${proc.id}
        ORDER BY r.created_at DESC
        LIMIT ${limit}`;
      return json({ requests: rows, processor: { id: proc.id, slug: proc.slug, name: proc.name } });
    }

    if (user.role !== 'admin') {
      return err(400, 'Use ?mine=1 or ?slug= / ?processor_id=');
    }
    const rows = await sql`
      SELECT r.*, p.name AS processor_name, p.slug AS processor_slug
      FROM processor_requests r
      JOIN processors p ON p.id = r.processor_id
      ORDER BY r.created_at DESC
      LIMIT ${limit}`;
    return json({ requests: rows });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body || typeof body !== 'object') return err(400, 'Body must be a JSON object');

    const contactName = String(body.contact_name || '').trim().slice(0, 120);
    const contactEmail = String(body.contact_email || '').trim().toLowerCase().slice(0, 200);
    if (!contactName) return err(400, 'contact_name required');
    if (!isEmail(contactEmail)) return err(400, 'valid contact_email required');

    const animal = String(body.animal_type || '').trim();
    const service = String(body.service_requested || '').trim();
    if (!ANIMALS.has(animal)) return err(400, 'invalid animal_type');
    if (!SERVICES.has(service)) return err(400, 'invalid service_requested');

    const preferredDate = isoDateOrNull(body.preferred_date);
    if (body.preferred_date && !preferredDate) {
      return err(400, 'preferred_date must be YYYY-MM-DD');
    }

    const proc = await resolveProcessor({
      processor_id: body.processor_id,
      processor_slug: body.processor_slug || body.slug,
    });
    if (!proc) {
      return err(404, 'Processor not found — use a Neon UUID processor_id or live slug (not offline bundled mamp-* ids)');
    }

    const rows = await sql`
      INSERT INTO processor_requests (
        processor_id, user_id,
        contact_name, contact_email, contact_phone, contact_zip,
        animal_type, service_requested, preferred_date, notes, status
      ) VALUES (
        ${proc.id},
        ${user.id},
        ${contactName},
        ${contactEmail},
        ${body.contact_phone ? String(body.contact_phone).trim().slice(0, 40) : null},
        ${body.contact_zip ? String(body.contact_zip).trim().slice(0, 12) : null},
        ${animal},
        ${service},
        ${preferredDate},
        ${body.notes ? String(body.notes).trim().slice(0, 4000) : null},
        'pending'
      )
      RETURNING *`;
    const request = rows[0];

    let email = null;
    try {
      email = await notifyRequest(request, proc);
    } catch (e) {
      console.error('[processor-requests] email failed:', e?.message || e);
      email = { error: String(e?.message || e).slice(0, 200) };
    }

    return json({ request, email }, { status: 201 });
  }

  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const id = url.searchParams.get('id');
    if (!id || !isUuid(id)) return err(400, 'id (uuid) required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const status = body?.status;
    if (!status || !STATUSES.has(status)) return err(400, 'valid status required');

    const existing = await sql`
      SELECT r.*, p.owner_id
      FROM processor_requests r
      JOIN processors p ON p.id = r.processor_id
      WHERE r.id = ${id} LIMIT 1`;
    const row = existing[0];
    if (!row) return err(404, 'Request not found');
    const canUpdate = row.owner_id === user.id || user.role === 'admin';
    if (!canUpdate) return err(403, 'Not your processor');

    const updated = await sql`
      UPDATE processor_requests
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *`;
    return json({ request: updated[0] });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
