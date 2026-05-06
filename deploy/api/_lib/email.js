// Centralized lifecycle email module — Resend-backed, with template registry,
// idempotency via email_log, and a single `send(templateId, ctx)` entrypoint.
//
// Usage from any API endpoint (Edge or Node):
//   import { sendLifecycleEmail } from './_lib/email.js';
//   await sendLifecycleEmail('C1.reservation_confirmed', { reservation_id, ... });
//
// Configuration (Vercel env vars):
//   RESEND_API_KEY         — required to actually send. If missing, emails are
//                            logged + skipped, so flow doesn't break in dev.
//   RESEND_FROM            — optional, defaults to "Protein Outfitters <hello@proteinoutfitters.com>"
//   ESP_PROVIDER           — currently only 'resend' is wired. Reserved for future swap.
//
// All emails are logged to the `email_log` table (bootstrapped on first send),
// keyed by (template_id, dedup_key) so re-firing the same trigger is safe.

import { sql } from './db.js';

const FROM_DEFAULT = 'Protein Outfitters <hello@proteinoutfitters.com>';

// ─── Schema bootstrap (idempotent) ─────────────────────────────
let _schemaReady = false;
async function ensureSchema() {
  if (_schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS email_log (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id  TEXT NOT NULL,
      to_email     TEXT NOT NULL,
      subject      TEXT,
      dedup_key    TEXT,
      reservation_id UUID,
      listing_id   UUID,
      farm_id      UUID,
      processor_id UUID,
      institution_id UUID,
      status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','skipped','failed','queued')),
      provider     TEXT NOT NULL DEFAULT 'resend',
      provider_id  TEXT,
      error        TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS email_log_template_idx ON email_log(template_id)`;
  await sql`CREATE INDEX IF NOT EXISTS email_log_dedup_idx    ON email_log(dedup_key)`;
  await sql`CREATE INDEX IF NOT EXISTS email_log_to_idx       ON email_log(to_email)`;
  _schemaReady = true;
}

// ─── Helper formatters ─────────────────────────────────────────
const fmt$ = (n, def = '$0') => Number.isFinite(Number(n))
  ? Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  : def;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'TBD';
const firstName = (full) => (full || '').split(/\s+/)[0] || 'there';
const baseUrl = () => process.env.PUBLIC_BASE_URL || 'https://www.proteinoutfitters.com';

// ─── Layout wrapper ─────────────────────────────────────────────
function layout({ heading, body, ctaLabel, ctaHref, footerNote }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f1e8;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;background:#fbf9f5;color:#061b0e;">
    <div style="margin-bottom:24px;font-weight:900;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#7da05d;">Protein Outfitters</div>
    <h1 style="font-size:24px;font-weight:800;line-height:1.25;margin:0 0 16px;letter-spacing:-0.02em;">${heading}</h1>
    <div style="font-size:15px;line-height:1.6;color:#1a201d;">${body}</div>
    ${ctaLabel && ctaHref ? `
    <p style="margin:28px 0 0;"><a href="${ctaHref}" style="display:inline-block;background:#061b0e;color:#fbf9f5;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;">${ctaLabel}</a></p>
    ` : ''}
    ${footerNote ? `<p style="margin-top:28px;font-size:12px;color:rgba(6,27,14,.65);line-height:1.55;">${footerNote}</p>` : ''}
    <hr style="border:0;border-top:1px solid rgba(6,27,14,.1);margin:32px 0 16px;">
    <p style="font-size:11px;color:rgba(6,27,14,.55);line-height:1.55;margin:0;">
      Protein Outfitters · By Stittsworth Meats · Bemidji, MN · <a href="${baseUrl()}/policies/refunds" style="color:rgba(6,27,14,.55);">Refund policy</a> · <a href="${baseUrl()}/faq" style="color:rgba(6,27,14,.55);">FAQ</a> · <a href="mailto:hello@proteinoutfitters.com" style="color:rgba(6,27,14,.55);">hello@proteinoutfitters.com</a>
    </p>
  </div>
</body></html>`;
}

// ─── Template registry ──────────────────────────────────────────
// Each entry: id → { subject(ctx), render(ctx) } where ctx is freeform data.
export const TEMPLATES = {
  // ───── Customer (C-series) ─────
  'C1.reservation_confirmed': {
    subject: (c) => `Reserved — ${c.animal_label || 'your share'}, ${fmtDate(c.drop_off_date)}`,
    render: (c) => layout({
      heading: 'Your reservation is locked in.',
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>Your share is reserved.</p>
<p style="background:rgba(125,160,93,.10);border-radius:14px;padding:16px;font-size:14px;">
  <strong>${c.fraction_pretty || 'Your share'} of ${c.animal_label || 'animal'}</strong><br>
  ${c.farm_name || ''}${c.farm_city ? ` · ${c.farm_city}, ${c.farm_state || ''}` : ''}<br>
  Drop-off: <strong>${fmtDate(c.drop_off_date)}</strong>${c.processor_name ? ` at ${c.processor_name}` : ''}
</p>
<p>Today we charged your <strong>deposit of ${fmt$(c.deposit_amount)}</strong>. The remaining balance is settled at pickup based on the actual hanging weight.</p>
<p><strong>What happens next:</strong></p>
<ol style="padding-left:20px;">
  <li>Customize your cut sheet anytime before drop-off (we'll remind you).</li>
  <li>We'll email you when the animal arrives at the processor and again when your meat is ready.</li>
  <li>Pickup window opens after processing.</li>
</ol>
<p>You can cancel for a full refund any time more than 21 days before drop-off. Inside 21 days the deposit is non-refundable. <a href="${baseUrl()}/policies/refunds">Full policy.</a></p>`,
      ctaLabel: 'View your reservation →',
      ctaHref: `${baseUrl()}/account?reservation=${c.reservation_id || ''}`,
    }),
  },

  'C2.cutsheet_reminder': {
    subject: () => 'Two weeks out — pick your cuts when you have a minute',
    render: (c) => layout({
      heading: 'Your share is dropping off in two weeks.',
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>If you want to choose your own cuts — steak thickness, roasts vs. ground, brisket, etc. — now's a good time.</p>
<p>If you don't fill it out, your processor uses a balanced "Processor's Choice" default. You'll still get great meat.</p>
<p>Final deadline: <strong>${fmtDate(c.cutsheet_deadline)}</strong>.</p>`,
      ctaLabel: 'Customize cut sheet →',
      ctaHref: `${baseUrl()}/cut-sheet?reservation=${c.reservation_id}${c.processor_slug ? '&processor=' + c.processor_slug : ''}`,
    }),
  },

  'C4.balance_capture_warning': {
    subject: (c) => `Heads up — balance of ${fmt$(c.balance_amount)} charges in 2 days`,
    render: (c) => layout({
      heading: 'Balance is about to be captured.',
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>In 2 days (on <strong>${fmtDate(c.balance_capture_date)}</strong>) we'll charge the remaining <strong>${fmt$(c.balance_amount)}</strong> for ${c.animal_label || 'your share'}.</p>
<p>The card we have on file ends in <strong>${c.card_last4 ? '•••• ' + c.card_last4 : 'your default card'}</strong>. If you need to update it, do that now to avoid a hold on your share.</p>`,
      ctaLabel: 'Update card →',
      ctaHref: `${baseUrl()}/account?tab=billing`,
    }),
  },

  'C16.animal_arrived': {
    subject: (c) => `Animal arrived at ${c.processor_name || 'the processor'}`,
    render: (c) => layout({
      heading: `${c.animal_label || 'Your animal'} is at the processor.`,
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>${c.farm_name || 'The farm'} just dropped off your animal at ${c.processor_name || 'the processor'}.</p>
<p>Standard timing from here:</p>
<ul style="padding-left:20px;">
  <li>Day 0: Harvest and inspection (today)</li>
  <li>Days 1–14: Carcass aging in the cooler</li>
  <li>Days 14–18: Cut, wrap, package per your cut sheet</li>
  <li>~Day ${c.estimated_ready_days || 18}: Ready for pickup</li>
</ul>
<p>We'll email when you can pick up.</p>`,
      ctaLabel: 'View reservation →',
      ctaHref: `${baseUrl()}/account?reservation=${c.reservation_id}`,
    }),
  },

  'C18.ready_for_pickup': {
    subject: (c) => `Your meat is ready — pickup window: ${c.pickup_window || 'see inside'}`,
    render: (c) => layout({
      heading: `${c.animal_label || 'Your share'} is ready.`,
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>Your meat is packed and ready for pickup at <strong>${c.processor_name || 'the processor'}</strong>${c.processor_address ? `, ${c.processor_address}` : ''}.</p>
<p><strong>Final hanging weight:</strong> ${c.final_hw_lbs || '—'} lbs<br>
<strong>Estimated take-home:</strong> ${c.final_cuts_lbs || '—'} lbs of cuts<br>
<strong>Final balance charged:</strong> ${fmt$(c.final_balance_charged)}</p>
<p>Pickup window: <strong>${c.pickup_window || 'standard hours'}</strong>. Bring a cooler — we recommend at least one ${c.cooler_size_rec || '48-quart'} cooler with ice for transport.</p>
<p>Once you've picked up, you have <strong>7 days</strong> to flag any quality issues.</p>`,
      ctaLabel: 'Pickup details →',
      ctaHref: `${baseUrl()}/account?reservation=${c.reservation_id}`,
    }),
  },

  'C19.delivered_complaint_window': {
    subject: () => 'Picked up — let us know if anything\'s off (7 days)',
    render: (c) => layout({
      heading: 'You\'ve picked up. The 7-day window starts now.',
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>Glad you've got <strong>${c.animal_label || 'your share'}</strong> home. A few quick things:</p>
<ul style="padding-left:20px;">
  <li><strong>Inventory it.</strong> Cross-check what you got against your cut sheet — note any missing or unexpected packs.</li>
  <li><strong>Freezer it fast.</strong> Anything you're not eating in 3 days goes in the freezer at 0°F or below.</li>
  <li><strong>You have 7 days</strong> to flag a quality issue (off-flavor, freezer burn from delayed pickup, wrong cut). After that the window closes.</li>
</ul>
<p>If something's not right — tap "Flag a quality issue" on your reservation in your account, or reply to this email with photos. We respond same business day.</p>
<p>If everything's great, we'd love a star rating on the producer + processor when you have a sec — it's how we keep the marketplace honest.</p>`,
      ctaLabel: 'Open your reservation →',
      ctaHref: `${baseUrl()}/account?reservation=${c.reservation_id}`,
    }),
  },

  'C8_C9_C10.cancel_confirmation': {
    subject: (c) => `Reservation cancelled — ${c.refund_status || 'see refund details inside'}`,
    render: (c) => {
      const stage = c.cancel_stage || 'free'; // 'free' | 'partial' | 'final'
      const stageMsg = {
        free: `<p>You cancelled outside the 21-day window, so we issued a <strong>full refund of ${fmt$(c.refund_amount)}</strong>. It'll show up on your card in 5–10 business days.</p>`,
        partial: `<p>You cancelled inside the 21-day window. Per our policy, the deposit of ${fmt$(c.deposit_amount)} is non-refundable, but we've issued you <strong>${fmt$(c.refund_amount)} as platform credit</strong> toward a future reservation (good for 12 months).</p>`,
        final: `<p>You cancelled inside the 7-day window. The animal is locked into the processor's calendar so the full balance was already owed. We won't be issuing a refund. The meat is still yours — pickup window stays open.</p>`,
      }[stage];
      return layout({
        heading: 'Your reservation is cancelled.',
        body: `<p>Hi ${firstName(c.buyer_name)},</p>${stageMsg}
<p>If anything's not quite right, reply to this email and we'll sort it out — ${c.support_email || 'hello@proteinoutfitters.com'}.</p>`,
        ctaLabel: stage === 'partial' ? 'Browse new listings →' : 'Back to home →',
        ctaHref: `${baseUrl()}/discover`,
      });
    },
  },

  'C11.animal_condemned_refund': {
    subject: () => 'Your animal was condemned — full refund issued',
    render: (c) => layout({
      heading: 'Bad news, but you\'re made whole.',
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>The animal you reserved (${c.animal_label || ''}) was condemned during inspection. ${c.condemnation_stage === 'ante_mortem' ? 'It was caught before harvest, so no kill fee was charged.' : 'It was caught during processing.'} We've issued a <strong>full refund of ${fmt$(c.refund_amount)}</strong> from our condemnation insurance pool.</p>
<p>Refund hits your card in 5–10 business days. The processor's kill fee is also covered by the pool, so the farmer isn't on the hook either.</p>
<p>Want to reserve another animal? We can match you with a similar listing close to the same drop-off date.</p>`,
      ctaLabel: 'Find a similar share →',
      ctaHref: `${baseUrl()}/discover?species=${c.species || ''}`,
    }),
  },

  'C20.complaint_received': {
    subject: () => 'We got your complaint — investigating now',
    render: (c) => layout({
      heading: 'We received your quality flag.',
      body: `<p>Hi ${firstName(c.buyer_name)},</p>
<p>Thanks for flagging the issue with ${c.animal_label || 'your share'}. Our support team has it and is reaching out to ${c.processor_name || 'the processor'} now.</p>
<p>You'll hear from us within <strong>2 business days</strong> with the resolution — typically a refund, replacement share, or platform credit, depending on what we and the processor can verify.</p>
<p>If you have additional photos or context, reply to this email and we'll add them to the case.</p>`,
      footerNote: `Case ID: ${c.complaint_id || 'TBD'}. Reference this if you call.`,
    }),
  },

  // ───── Farmer (F-series) ─────
  'F2.first_sale_pick_processor': {
    subject: (c) => `First fraction sold on ${c.animal_label || 'your listing'} — pick a processor`,
    render: (c) => layout({
      heading: 'Someone reserved your animal.',
      body: `<p>Hi ${firstName(c.farmer_name)},</p>
<p>${c.buyer_first || 'A buyer'} just reserved a ${c.fraction_pretty || 'fraction'} of <strong>${c.animal_label || 'your animal'}</strong>.</p>
<p><strong>Action needed:</strong> the first buyer locks the processor for everyone who buys this animal. Pick a processor in the next 48 hours so we can show buyers your drop-off date.</p>`,
      ctaLabel: 'Pick a processor →',
      ctaHref: `${baseUrl()}/farmer?listing=${c.listing_id}`,
    }),
  },

  'F4.dropoff_reminder': {
    subject: () => 'Drop-off in 3 days — final checklist',
    render: (c) => layout({
      heading: 'Three days until drop-off.',
      body: `<p>Hi ${firstName(c.farmer_name)},</p>
<p>You're scheduled to drop off <strong>${c.animal_label || 'your animal'}</strong> at ${c.processor_name || 'the processor'} on <strong>${fmtDate(c.drop_off_date)}</strong>.</p>
<p><strong>Quick checklist:</strong></p>
<ul style="padding-left:20px;">
  <li>Confirm trailer + driver</li>
  <li>Withhold feed 24 hours prior (water OK)</li>
  <li>Bring your booking confirmation — the processor will scan a QR to check you in</li>
  <li>Plan for ${c.estimated_dressing_time || '~45 min'} on-site</li>
</ul>
<p>If anything has changed — animal sick, trailer issue, weather — reply to this email or call the processor directly: ${c.processor_phone || 'see app'}.</p>`,
      ctaLabel: 'Booking + check-in code →',
      ctaHref: `${baseUrl()}/farmer?booking=${c.booking_id}`,
    }),
  },

  'F11.no_show_flag': {
    subject: () => 'No-show flagged on your drop-off — deposit forfeit',
    render: (c) => layout({
      heading: 'You missed your drop-off slot.',
      body: `<p>Hi ${firstName(c.farmer_name)},</p>
<p>${c.processor_name || 'The processor'} didn't see you arrive on <strong>${fmtDate(c.drop_off_date)}</strong> for <strong>${c.animal_label || 'your animal'}</strong>. Per our drop-off policy, we've flagged the booking as a no-show and forfeited your <strong>${fmt$(c.deposit_amount)}</strong> deposit to the processor — they held the slot, no one showed.</p>
<p>If something went wrong on your end (sick animal, trailer issue, weather, miscommunication), reply to this email and we'll review the flag. One-off events don't escalate; only repeat patterns (3+ in 12 months) trigger a review of your producer status.</p>
<p>If you want to reschedule with the same buyers, we can re-list the animal — just let us know.</p>`,
      ctaLabel: 'Talk to us →',
      ctaHref: `mailto:hello@proteinoutfitters.com?subject=No-show%20flag%20review`,
    }),
  },

  'F7.payout_disbursed': {
    subject: (c) => `Payout sent — ${fmt$(c.payout_amount)} for ${c.animal_label || 'your animal'}`,
    render: (c) => layout({
      heading: 'Your payout is on the way.',
      body: `<p>Hi ${firstName(c.farmer_name)},</p>
<p>We just sent <strong>${fmt$(c.payout_amount)}</strong> to your bank for ${c.animal_label || 'animal'}. Stripe typically deposits within 2 business days.</p>
<p style="background:rgba(125,160,93,.10);border-radius:14px;padding:16px;font-size:14px;">
  <strong>Final hanging weight:</strong> ${c.final_hw_lbs || '—'} lbs<br>
  <strong>Your $/lb hanging:</strong> ${fmt$(c.farmer_per_lb)}/lb<br>
  <strong>Gross:</strong> ${fmt$(c.gross_amount)}<br>
  <strong>Less platform fee + kill share:</strong> ${fmt$(c.fees_amount)}<br>
  <strong>Net to you:</strong> ${fmt$(c.payout_amount)}
</p>`,
      ctaLabel: 'View payout details →',
      ctaHref: `${baseUrl()}/farmer?payout=${c.payout_id}`,
    }),
  },

  // ───── Processor (P-series) ─────
  'P1.new_booking': {
    subject: (c) => `New booking — ${c.animal_label || 'an animal'}, drop-off ${fmtDate(c.drop_off_date)}`,
    render: (c) => layout({
      heading: 'New booking confirmed.',
      body: `<p>Hi ${firstName(c.processor_contact)},</p>
<p>${c.farm_name || 'A farmer'} just booked a slot for <strong>${c.animal_label || 'an animal'}</strong> on <strong>${fmtDate(c.drop_off_date)}</strong>.</p>
<p><strong>What we know:</strong> ${c.species || 'animal'}, ~${c.estimated_hw_lbs || '—'} lb hanging weight, ${c.share_count || 1} share buyer${c.share_count > 1 ? 's' : ''}.</p>`,
      ctaLabel: 'View in queue →',
      ctaHref: `${baseUrl()}/processor-ops`,
    }),
  },

  'P2.cut_sheet_finalized': {
    subject: (c) => `Cut sheet in for ${c.animal_label || 'an animal'}`,
    render: (c) => layout({
      heading: 'Cut sheet finalized.',
      body: `<p>Hi ${firstName(c.processor_contact)},</p>
<p>${c.buyer_first || 'A buyer'} just submitted their cut sheet for <strong>${c.animal_label || 'an animal'}</strong> (${c.farm_name || 'farm'}). It's locked in now — they can\'t change it after this point unless they ask us.</p>
<p>Open the queue to see exactly which cuts they picked, grind ratio, vacuum-seal preference, and any special instructions in the CSR field.</p>`,
      ctaLabel: 'Open queue →',
      ctaHref: `${baseUrl()}/processor-ops`,
    }),
  },

  'P3.checkin_reminder': {
    subject: (c) => `Tomorrow: ${c.farm_name} dropping off ${c.animal_label || 'an animal'}`,
    render: (c) => layout({
      heading: 'Drop-off tomorrow.',
      body: `<p>Hi ${firstName(c.processor_contact)},</p>
<p>Heads up — <strong>${c.farm_name || 'a farmer'}</strong> is bringing in <strong>${c.animal_label || 'an animal'}</strong> tomorrow${c.drop_off_window ? `, ${c.drop_off_window}` : ''}.</p>
<p><strong>To check them in:</strong> open the queue, scan their QR code, accept the animal. The platform releases their dropoff deposit and starts the buyer's countdown automatically.</p>`,
      ctaLabel: 'Open queue →',
      ctaHref: `${baseUrl()}/processor-ops`,
    }),
  },

  // ───── Donation Depot ─────
  'D1.tax_letter_ready': {
    subject: () => 'Your tax acknowledgment letter is ready',
    render: (c) => layout({
      heading: 'Tax letter is ready.',
      body: `<p>Hi ${firstName(c.donor_name)},</p>
<p>The animal you donated has been processed and distributed. Your IRS-compliant tax acknowledgment letter is attached and on file in your account.</p>
<p style="background:rgba(125,160,93,.10);border-radius:14px;padding:16px;font-size:14px;">
  <strong>Final hanging weight:</strong> ${c.final_hw_lbs || '—'} lbs<br>
  <strong>Estimated FMV:</strong> ${fmt$(c.fmv)}<br>
  <strong>Recipient:</strong> ${c.recipient_org || '501(c)(3) partner'}<br>
  <strong>Recipient EIN:</strong> ${c.recipient_ein || '—'}
</p>
<p>"No goods or services were provided in exchange for this donation." Per IRS rules, raised-livestock donations are typically deductible to the donor's basis. Talk to your CPA for your specific deduction.</p>`,
      ctaLabel: 'Download letter (PDF) →',
      ctaHref: `${baseUrl()}/api/pdf/tax-letter?donation=${c.donation_id}`,
    }),
  },

  'D2.institution_approved': {
    subject: () => 'You\'re approved — request donations any time',
    render: (c) => layout({
      heading: `${c.legal_name || 'Your institution'} is approved.`,
      body: `<p>Hi ${firstName(c.contact_name)},</p>
<p>Your application is reviewed and approved. You're now on the Donation Depot recipient list.</p>
<p>You can browse available donations and request what fits your program from the dashboard. We'll email when new donations matching your service area come available.</p>
<p style="background:rgba(125,160,93,.10);border-radius:14px;padding:16px;font-size:14px;">
  <strong>Approved program:</strong> ${c.legal_name}<br>
  <strong>Type:</strong> ${(c.type || 'institution').replace('foodbank', 'food bank')}<br>
  <strong>Service:</strong> ${c.people_per_week ? c.people_per_week + ' people/week' : '—'}<br>
  <strong>Storage:</strong> ${c.storage || '—'}
</p>`,
      ctaLabel: 'Open the dashboard →',
      ctaHref: `${baseUrl()}/donation-flow`,
    }),
  },
};

// ─── Send entry point ──────────────────────────────────────────
/**
 * Send a lifecycle email.
 *
 * @param {string} templateId   — must exist in TEMPLATES
 * @param {object} ctx          — template variables, plus required: { to, dedupKey? }
 * @returns {object}            — { sent: bool, skipped?: string, providerId?: string, error?: string }
 */
export async function sendLifecycleEmail(templateId, ctx = {}) {
  const tpl = TEMPLATES[templateId];
  if (!tpl) return { sent: false, error: `Unknown template: ${templateId}` };
  const to = ctx.to;
  if (!to) return { sent: false, error: 'Missing `to` email address' };

  await ensureSchema().catch(() => {});

  // Idempotency check
  const dedupKey = ctx.dedupKey || `${templateId}::${to}::${ctx.reservation_id || ctx.donation_id || ctx.institution_id || ''}`;
  const existing = await sql`SELECT id FROM email_log WHERE dedup_key = ${dedupKey} AND status = 'sent' LIMIT 1`;
  if (existing[0]) return { sent: false, skipped: 'already_sent', dedupKey };

  const subject = tpl.subject(ctx);
  const html = tpl.render(ctx);
  const from = process.env.RESEND_FROM || FROM_DEFAULT;

  if (!process.env.RESEND_API_KEY) {
    // Log as skipped so we can see what *would* have sent in dev/preview.
    await sql`
      INSERT INTO email_log (template_id, to_email, subject, dedup_key, reservation_id, listing_id, farm_id, processor_id, institution_id, status, error)
      VALUES (${templateId}, ${to}, ${subject}, ${dedupKey},
              ${ctx.reservation_id || null}, ${ctx.listing_id || null}, ${ctx.farm_id || null}, ${ctx.processor_id || null}, ${ctx.institution_id || null},
              'skipped', 'RESEND_API_KEY missing')
    `;
    return { sent: false, skipped: 'no_api_key' };
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({ from, to, subject, html });
    const providerId = result?.data?.id || result?.id || null;
    await sql`
      INSERT INTO email_log (template_id, to_email, subject, dedup_key, reservation_id, listing_id, farm_id, processor_id, institution_id, status, provider_id)
      VALUES (${templateId}, ${to}, ${subject}, ${dedupKey},
              ${ctx.reservation_id || null}, ${ctx.listing_id || null}, ${ctx.farm_id || null}, ${ctx.processor_id || null}, ${ctx.institution_id || null},
              'sent', ${providerId})
    `;
    return { sent: true, providerId };
  } catch (e) {
    await sql`
      INSERT INTO email_log (template_id, to_email, subject, dedup_key, reservation_id, listing_id, farm_id, processor_id, institution_id, status, error)
      VALUES (${templateId}, ${to}, ${subject}, ${dedupKey},
              ${ctx.reservation_id || null}, ${ctx.listing_id || null}, ${ctx.farm_id || null}, ${ctx.processor_id || null}, ${ctx.institution_id || null},
              'failed', ${String(e).slice(0, 500)})
    `;
    return { sent: false, error: String(e).slice(0, 200) };
  }
}

// Convenience: list available templates (used by /api/email-tick to log support).
export function listTemplates() {
  return Object.keys(TEMPLATES);
}
