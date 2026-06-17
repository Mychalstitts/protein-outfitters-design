// Edge Function: send-request-emails (single-file bundle for in-dashboard deploy)
//
// Source of truth: app/supabase/functions/send-request-emails/index.ts
// This bundle inlines _shared/cors.ts, _shared/email-templates.ts, and the
// AnimalType/ServiceRequested string-union types so the Supabase dashboard
// editor can deploy without resolving relative imports.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';

// ============================================================================
// inlined: _shared/cors.ts
// ============================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ============================================================================
// inlined types (from packages/shared/src/types/request.ts)
// ============================================================================
type AnimalType =
  | 'beef'
  | 'pork'
  | 'lamb'
  | 'goat'
  | 'poultry'
  | 'venison'
  | 'elk'
  | 'wild_game'
  | 'other';

type ServiceRequested =
  | 'whole_animal_processing'
  | 'half_animal_processing'
  | 'quarter_animal_processing'
  | 'custom_cuts'
  | 'smoking'
  | 'sausage_making'
  | 'curing'
  | 'game_processing'
  | 'retail_purchase'
  | 'consultation';

// ============================================================================
// inlined: _shared/email-templates.ts
// ============================================================================
const ANIMAL_LABELS: Record<AnimalType, string> = {
  beef: 'Beef',
  pork: 'Pork',
  lamb: 'Lamb',
  goat: 'Goat',
  poultry: 'Poultry',
  venison: 'Venison',
  elk: 'Elk',
  wild_game: 'Wild Game',
  other: 'Other',
};

const SERVICE_LABELS: Record<ServiceRequested, string> = {
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

interface RequestEmailContext {
  processorName: string;
  processorIsClaimed: boolean;
  consumerName: string;
  consumerEmail: string;
  consumerPhone: string | null;
  consumerZip: string | null;
  animal: AnimalType;
  service: ServiceRequested;
  preferredDate: string | null;
  notes: string | null;
  requestId: string;
  publicUrl: string;
}

function processorEmailSubject(c: RequestEmailContext): string {
  return `New service request from ${c.consumerName} — ${ANIMAL_LABELS[c.animal]}`;
}

function processorEmailText(c: RequestEmailContext): string {
  const lines = [
    `Hi ${c.processorName},`,
    ``,
    `You have a new service request from a customer who found you on Protein Outfitters.`,
    ``,
    `--- THE REQUEST ---`,
    `Service:        ${SERVICE_LABELS[c.service]}`,
    `Animal:         ${ANIMAL_LABELS[c.animal]}`,
    c.preferredDate ? `Preferred date: ${c.preferredDate}` : null,
    c.notes ? `Notes:          ${c.notes}` : null,
    ``,
    `--- THE CUSTOMER ---`,
    `Name:   ${c.consumerName}`,
    `Email:  ${c.consumerEmail}`,
    c.consumerPhone ? `Phone:  ${c.consumerPhone}` : null,
    c.consumerZip ? `ZIP:    ${c.consumerZip}` : null,
    ``,
    `Reply directly to this email to respond — your reply goes straight to ${c.consumerName}.`,
    ``,
    !c.processorIsClaimed
      ? [
          `--- ARE YOU THE OWNER? ---`,
          `This listing hasn't been claimed yet. Claim it (free) to:`,
          `  • Manage future requests in one place`,
          `  • Add photos, hours, and pricing`,
          `  • Get a verified badge on your profile`,
          `Claim now: ${c.publicUrl}/claim`,
          ``,
        ].join('\n')
      : null,
    `— Protein Outfitters`,
    `${c.publicUrl}`,
  ].filter(Boolean);
  return lines.join('\n');
}

function processorEmailHtml(c: RequestEmailContext): string {
  const claim = !c.processorIsClaimed
    ? `<tr><td style="padding:16px 0 0;">
         <div style="background:#1a1f2a;border:1px solid #2a3140;border-radius:10px;padding:16px;">
           <div style="color:#5fb377;font-weight:700;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">Are you the owner?</div>
           <div style="color:#aab2c0;font-size:14px;line-height:1.5;margin-top:6px;">
             This listing hasn't been claimed. Claim it (free) to manage future requests, add photos and pricing, and get a verified badge.
           </div>
           <a href="${c.publicUrl}/claim?id=${encodeURIComponent(c.requestId)}"
              style="display:inline-block;margin-top:10px;background:#2c9a52;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
             Claim your listing
           </a>
         </div>
       </td></tr>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>New Request</title></head>
<body style="margin:0;background:#0f1115;color:#e8ebf0;font-family:-apple-system,Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:24px;">
    <tr><td>
      <div style="font-size:13px;color:#7d8896;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Protein Outfitters</div>
      <h1 style="margin:6px 0 0;font-size:24px;letter-spacing:-0.5px;">New service request</h1>
      <p style="color:#aab2c0;font-size:15px;line-height:1.6;margin:12px 0 24px;">
        Hi ${escapeHtml(c.processorName)} — a customer found you on the Protein Outfitters map and wants to send you business.
      </p>

      <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #2a3140;border-radius:10px;background:#1a1f2a;">
        <tr><td style="padding:16px;">
          <div style="color:#5fb377;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;">The request</div>
          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#e8ebf0;line-height:1.7;">
            <tr><td style="color:#7d8896;width:120px;">Service</td><td>${escapeHtml(SERVICE_LABELS[c.service])}</td></tr>
            <tr><td style="color:#7d8896;">Animal</td><td>${escapeHtml(ANIMAL_LABELS[c.animal])}</td></tr>
            ${c.preferredDate ? `<tr><td style="color:#7d8896;">Preferred date</td><td>${escapeHtml(c.preferredDate)}</td></tr>` : ''}
            ${c.notes ? `<tr><td style="color:#7d8896;vertical-align:top;">Notes</td><td>${escapeHtml(c.notes).replace(/\n/g, '<br>')}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="padding:0 16px 16px;">
          <div style="color:#6ea3d4;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin:16px 0 8px;">The customer</div>
          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#e8ebf0;line-height:1.7;">
            <tr><td style="color:#7d8896;width:120px;">Name</td><td>${escapeHtml(c.consumerName)}</td></tr>
            <tr><td style="color:#7d8896;">Email</td><td><a href="mailto:${escapeHtml(c.consumerEmail)}" style="color:#5fb377;">${escapeHtml(c.consumerEmail)}</a></td></tr>
            ${c.consumerPhone ? `<tr><td style="color:#7d8896;">Phone</td><td><a href="tel:${escapeHtml(c.consumerPhone)}" style="color:#5fb377;">${escapeHtml(c.consumerPhone)}</a></td></tr>` : ''}
            ${c.consumerZip ? `<tr><td style="color:#7d8896;">ZIP</td><td>${escapeHtml(c.consumerZip)}</td></tr>` : ''}
          </table>
        </td></tr>
      </table>

      <p style="color:#aab2c0;font-size:13px;line-height:1.6;margin:16px 0;">
        Reply directly to this email — your reply goes straight to ${escapeHtml(c.consumerName)}.
      </p>

      ${claim}

      <hr style="border:none;border-top:1px solid #1f2530;margin:24px 0 12px;">
      <p style="color:#5a6271;font-size:12px;line-height:1.5;margin:0;">
        Sent by Protein Outfitters · <a href="${c.publicUrl}" style="color:#7d8896;">${c.publicUrl.replace(/^https?:\/\//, '')}</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function consumerEmailSubject(c: RequestEmailContext): string {
  return `We sent your request to ${c.processorName}`;
}

function consumerEmailText(c: RequestEmailContext): string {
  return [
    `Hi ${c.consumerName},`,
    ``,
    `We forwarded your request to ${c.processorName}. They have your contact info and will reach out directly.`,
    ``,
    `Your request:`,
    `  Service: ${SERVICE_LABELS[c.service]}`,
    `  Animal:  ${ANIMAL_LABELS[c.animal]}`,
    c.preferredDate ? `  Date:    ${c.preferredDate}` : null,
    ``,
    `If you don't hear back in a few days, you can try another processor on the map.`,
    ``,
    `— Protein Outfitters`,
    `${c.publicUrl}`,
  ].filter(Boolean).join('\n');
}

function consumerEmailHtml(c: RequestEmailContext): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#0f1115;color:#e8ebf0;font-family:-apple-system,Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:24px;">
    <tr><td>
      <div style="font-size:13px;color:#7d8896;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Protein Outfitters</div>
      <h1 style="margin:6px 0 0;font-size:22px;letter-spacing:-0.5px;">Request sent</h1>
      <p style="color:#aab2c0;font-size:15px;line-height:1.6;margin:12px 0 16px;">
        Hi ${escapeHtml(c.consumerName)} — we forwarded your request to <strong style="color:#fff;">${escapeHtml(c.processorName)}</strong>. They have your contact info and will reach out directly.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #2a3140;border-radius:10px;background:#1a1f2a;">
        <tr><td style="padding:16px;font-size:14px;line-height:1.7;color:#e8ebf0;">
          <div style="color:#7d8896;">Service</div><div>${escapeHtml(SERVICE_LABELS[c.service])}</div>
          <div style="color:#7d8896;margin-top:8px;">Animal</div><div>${escapeHtml(ANIMAL_LABELS[c.animal])}</div>
          ${c.preferredDate ? `<div style="color:#7d8896;margin-top:8px;">Preferred date</div><div>${escapeHtml(c.preferredDate)}</div>` : ''}
        </td></tr>
      </table>
      <p style="color:#7d8896;font-size:13px;line-height:1.6;margin:16px 0;">
        If you don't hear back in a few days, try another processor on the map.
      </p>
      <hr style="border:none;border-top:1px solid #1f2530;margin:16px 0 12px;">
      <p style="color:#5a6271;font-size:12px;margin:0;">
        Sent by Protein Outfitters · <a href="${c.publicUrl}" style="color:#7d8896;">${c.publicUrl.replace(/^https?:\/\//, '')}</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// main handler
// ============================================================================
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FROM_ADDRESS =
  Deno.env.get('EMAIL_FROM_ADDRESS') ?? 'Protein Outfitters <noreply@proteinoutfitters.com>';
const REPLY_TO_FALLBACK =
  Deno.env.get('EMAIL_REPLY_TO_FALLBACK') ?? 'support@proteinoutfitters.com';
const PUBLIC_URL = Deno.env.get('PUBLIC_URL') ?? 'https://proteinoutfitters.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface WebhookPayload {
  type: string;
  table: string;
  record: {
    id: string;
    processor_id: string;
    contact_name: string;
    contact_email: string;
    contact_phone: string | null;
    contact_zip: string | null;
    animal_type: string;
    service_requested: string;
    preferred_date: string | null;
    notes: string | null;
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = (await req.json()) as WebhookPayload;
    if (payload.table !== 'processor_requests' || payload.type !== 'INSERT') {
      return json({ skipped: true, reason: 'wrong table or event' });
    }

    const r = payload.record;

    const { data: proc, error: procErr } = await supabase
      .from('processors')
      .select('name, email, claim_status')
      .eq('id', r.processor_id)
      .maybeSingle();
    if (procErr) throw procErr;
    if (!proc) throw new Error(`Processor ${r.processor_id} not found`);

    const processorTo = proc.email ?? REPLY_TO_FALLBACK;

    const ctx: RequestEmailContext = {
      processorName: proc.name,
      processorIsClaimed: proc.claim_status === 'claimed',
      consumerName: r.contact_name,
      consumerEmail: r.contact_email,
      consumerPhone: r.contact_phone,
      consumerZip: r.contact_zip,
      animal: r.animal_type as AnimalType,
      service: r.service_requested as ServiceRequested,
      preferredDate: r.preferred_date,
      notes: r.notes,
      requestId: r.id,
      publicUrl: PUBLIC_URL,
    };

    const results = await Promise.allSettled([
      send({
        kind: 'request_to_processor',
        request_id: r.id,
        to: processorTo,
        toName: proc.name,
        replyTo: r.contact_email,
        subject: processorEmailSubject(ctx),
        text: processorEmailText(ctx),
        html: processorEmailHtml(ctx),
      }),
      send({
        kind: 'request_confirmation',
        request_id: r.id,
        to: r.contact_email,
        toName: r.contact_name,
        replyTo: REPLY_TO_FALLBACK,
        subject: consumerEmailSubject(ctx),
        text: consumerEmailText(ctx),
        html: consumerEmailHtml(ctx),
      }),
    ]);

    const sent = results.filter(x => x.status === 'fulfilled').length;
    const failed = results.length - sent;
    return json({ ok: true, sent, failed });
  } catch (e) {
    console.error('send-request-emails failed:', e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

interface SendArgs {
  kind: string;
  request_id?: string;
  claim_id?: string;
  to: string;
  toName?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

async function send(args: SendArgs): Promise<void> {
  const { data: row } = await supabase
    .from('email_log')
    .insert({
      kind: args.kind,
      request_id: args.request_id ?? null,
      claim_id: args.claim_id ?? null,
      to_email: args.to,
      to_name: args.toName ?? null,
      status: 'queued',
    })
    .select('id')
    .single();

  if (!RESEND_API_KEY) {
    console.log('[dev mode] would send:', args.subject, '→', args.to);
    if (row?.id) {
      await supabase
        .from('email_log')
        .update({
          status: 'failed',
          error_message: 'RESEND_API_KEY not set (dev mode)',
        })
        .eq('id', row.id);
    }
    return;
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [args.toName ? `${args.toName} <${args.to}>` : args.to],
        reply_to: args.replyTo ? [args.replyTo] : undefined,
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Resend ${resp.status}: ${body}`);
    }
    const data = (await resp.json()) as { id?: string };
    if (row?.id) {
      await supabase
        .from('email_log')
        .update({
          status: 'sent',
          provider_id: data.id ?? null,
          sent_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
  } catch (e) {
    if (row?.id) {
      await supabase
        .from('email_log')
        .update({
          status: 'failed',
          error_message: String(e),
        })
        .eq('id', row.id);
    }
    throw e;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
