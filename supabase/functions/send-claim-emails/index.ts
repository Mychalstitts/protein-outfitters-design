// Edge Function: send-claim-emails
//
// Triggered by a database webhook on processor_claims INSERT.
// Sends two emails:
//   1. Admin notification → review queue
//   2. Acknowledgement to the claimant
//
// Deploy:
//   npx supabase functions deploy send-claim-emails --no-verify-jwt
//
// Then create the webhook (Database → Webhooks → New) on processor_claims INSERT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';
import { corsHeaders } from '../_shared/cors.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FROM_ADDRESS =
  Deno.env.get('EMAIL_FROM_ADDRESS') ?? 'Protein Outfitters <noreply@proteinoutfitters.com>';
const ADMIN_INBOX =
  Deno.env.get('ADMIN_INBOX') ?? 'claims@proteinoutfitters.com';
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
    claimant_user_id: string;
    evidence_url: string | null;
    evidence_notes: string | null;
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = (await req.json()) as WebhookPayload;
    if (payload.table !== 'processor_claims' || payload.type !== 'INSERT') {
      return json({ skipped: true, reason: 'wrong table or event' });
    }

    const c = payload.record;

    const [{ data: proc }, { data: claimantAuth }] = await Promise.all([
      supabase
        .from('processors')
        .select('id, name, address_full, source')
        .eq('id', c.processor_id)
        .maybeSingle(),
      supabase.auth.admin.getUserById(c.claimant_user_id),
    ]);

    if (!proc) throw new Error(`Processor ${c.processor_id} not found`);

    const claimantEmail = claimantAuth?.user?.email ?? null;
    const claimantName =
      claimantAuth?.user?.user_metadata?.full_name ??
      claimantAuth?.user?.email?.split('@')[0] ??
      'New claimant';

    const adminUrl = `${PUBLIC_URL}/admin/claims/${c.id}`;

    await Promise.allSettled([
      // Admin notification
      sendEmail({
        kind: 'claim_admin_notification',
        claim_id: c.id,
        to: ADMIN_INBOX,
        subject: `Claim review: ${proc.name}`,
        text: [
          `New claim submitted.`,
          ``,
          `Processor:    ${proc.name} (${proc.id})`,
          `Source:       ${proc.source}`,
          `Address:      ${proc.address_full ?? '—'}`,
          ``,
          `Claimant:     ${claimantName} <${claimantEmail ?? 'no-email'}>`,
          `User ID:      ${c.claimant_user_id}`,
          ``,
          `Evidence URL: ${c.evidence_url ?? '—'}`,
          `Notes:        ${c.evidence_notes ?? '—'}`,
          ``,
          `Review:       ${adminUrl}`,
        ].join('\n'),
        html: `<!doctype html><html><body style="font-family:-apple-system,Inter,sans-serif;background:#0f1115;color:#e8ebf0;padding:24px;">
          <h2 style="margin:0 0 16px;">Claim review queue</h2>
          <table cellpadding="0" cellspacing="0" style="border:1px solid #2a3140;border-radius:8px;background:#1a1f2a;width:100%;max-width:560px;">
            <tr><td style="padding:16px;line-height:1.7;font-size:14px;">
              <div><span style="color:#7d8896">Processor:</span> <strong>${escape(proc.name)}</strong> (${escape(proc.id)})</div>
              <div><span style="color:#7d8896">Source:</span> ${escape(proc.source)}</div>
              <div><span style="color:#7d8896">Address:</span> ${escape(proc.address_full ?? '—')}</div>
              <hr style="border:none;border-top:1px solid #2a3140;margin:12px 0;">
              <div><span style="color:#7d8896">Claimant:</span> ${escape(claimantName)} &lt;${escape(claimantEmail ?? 'no-email')}&gt;</div>
              <div><span style="color:#7d8896">User ID:</span> <code>${escape(c.claimant_user_id)}</code></div>
              <hr style="border:none;border-top:1px solid #2a3140;margin:12px 0;">
              <div><span style="color:#7d8896">Evidence URL:</span> ${c.evidence_url ? `<a href="${escape(c.evidence_url)}" style="color:#5fb377;">${escape(c.evidence_url)}</a>` : '—'}</div>
              <div style="margin-top:8px;"><span style="color:#7d8896">Notes:</span><br>${escape(c.evidence_notes ?? '—').replace(/\n/g,'<br>')}</div>
            </td></tr>
          </table>
          <p style="margin-top:16px"><a href="${escape(adminUrl)}" style="background:#2c9a52;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">Review in admin</a></p>
        </body></html>`,
      }),
      // Claimant acknowledgement
      claimantEmail
        ? sendEmail({
            kind: 'claim_received',
            claim_id: c.id,
            to: claimantEmail,
            subject: `We got your claim for ${proc.name}`,
            text: [
              `Hi ${claimantName},`,
              ``,
              `Thanks for submitting a claim for ${proc.name}. Our team reviews claims within 1–2 business days.`,
              ``,
              `If we need more info, we'll email you. Once your claim is approved, you'll be able to manage requests, post photos, and update your profile from inside the app.`,
              ``,
              `— Protein Outfitters`,
              `${PUBLIC_URL}`,
            ].join('\n'),
            html: `<!doctype html><html><body style="font-family:-apple-system,Inter,sans-serif;background:#0f1115;color:#e8ebf0;padding:24px;">
              <div style="max-width:560px;margin:0 auto;">
                <div style="font-size:13px;color:#7d8896;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Protein Outfitters</div>
                <h1 style="margin:6px 0 0;font-size:22px;">Claim received</h1>
                <p style="color:#aab2c0;font-size:15px;line-height:1.6;">
                  Hi ${escape(claimantName)} — thanks for submitting a claim for <strong style="color:#fff;">${escape(proc.name)}</strong>. We review claims within 1–2 business days.
                </p>
                <p style="color:#aab2c0;font-size:14px;line-height:1.6;">
                  If we need more info, we'll email you. Once approved, you'll be able to manage requests, post photos, and update your profile from inside the app.
                </p>
                <hr style="border:none;border-top:1px solid #1f2530;margin:24px 0 12px;">
                <p style="color:#5a6271;font-size:12px;">Protein Outfitters · ${PUBLIC_URL.replace(/^https?:\/\//, '')}</p>
              </div>
            </body></html>`,
          })
        : Promise.resolve(),
    ]);

    return json({ ok: true });
  } catch (e) {
    console.error('send-claim-emails failed:', e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

interface SendArgs {
  kind: string;
  claim_id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function sendEmail(args: SendArgs): Promise<void> {
  const { data: row } = await supabase
    .from('email_log')
    .insert({
      kind: args.kind,
      claim_id: args.claim_id,
      to_email: args.to,
      status: 'queued',
    })
    .select('id')
    .single();

  if (!RESEND_API_KEY) {
    console.log('[dev mode] would send:', args.subject, '→', args.to);
    if (row?.id) {
      await supabase
        .from('email_log')
        .update({ status: 'failed', error_message: 'RESEND_API_KEY not set (dev mode)' })
        .eq('id', row.id);
    }
    return;
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [args.to], subject: args.subject, text: args.text, html: args.html }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Resend ${resp.status}: ${body}`);
    }
    const data = (await resp.json()) as { id?: string };
    if (row?.id) {
      await supabase
        .from('email_log')
        .update({ status: 'sent', provider_id: data.id ?? null, sent_at: new Date().toISOString() })
        .eq('id', row.id);
    }
  } catch (e) {
    if (row?.id) {
      await supabase
        .from('email_log')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', row.id);
    }
    throw e;
  }
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
