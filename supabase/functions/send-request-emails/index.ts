// Edge Function: send-request-emails
//
// Triggered by a database webhook on processor_requests INSERT.
// Sends two emails:
//   1. To the processor (the warm lead)
//   2. To the consumer (confirmation)
//
// Logs every attempt to public.email_log so we can debug delivery.
//
// Deploy:
//   npx supabase functions deploy send-request-emails --no-verify-jwt
//
// Then create the webhook in the dashboard:
//   Database → Webhooks → New
//     Table: processor_requests
//     Events: Insert
//     Type: Supabase Edge Functions
//     Function: send-request-emails

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';
import {
  consumerEmailHtml,
  consumerEmailSubject,
  consumerEmailText,
  processorEmailHtml,
  processorEmailSubject,
  processorEmailText,
  type RequestEmailContext,
} from '../_shared/email-templates.ts';
import { corsHeaders } from '../_shared/cors.ts';

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

    // Pull processor info — needed for the recipient address and the body.
    const { data: proc, error: procErr } = await supabase
      .from('processors')
      .select('name, email, claim_status')
      .eq('id', r.processor_id)
      .maybeSingle();
    if (procErr) throw procErr;
    if (!proc) throw new Error(`Processor ${r.processor_id} not found`);

    // Where to send the processor email. Prefer their listed contact email;
    // fall back to our shared inbox if none on file.
    const processorTo = proc.email ?? REPLY_TO_FALLBACK;

    const ctx: RequestEmailContext = {
      processorName: proc.name,
      processorIsClaimed: proc.claim_status === 'claimed',
      consumerName: r.contact_name,
      consumerEmail: r.contact_email,
      consumerPhone: r.contact_phone,
      consumerZip: r.contact_zip,
      animal: r.animal_type as never,
      service: r.service_requested as never,
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
        // The point — replies go directly to the consumer, not us.
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
  // Log queued first so we have an audit row even if Resend errors
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
    // Dev mode — no provider configured. Log and move on so submission flow
    // still works during local development.
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
