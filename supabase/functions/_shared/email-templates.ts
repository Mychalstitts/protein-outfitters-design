// Email templates. Plain text first, HTML second — most email clients render
// the HTML, but accessible clients (and some spam filters) prefer text.
//
// Keep these dependency-free; Edge Functions run on Deno without npm.

import type { ServiceRequested, AnimalType } from '../../../packages/shared/src/types/request.ts';

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

export interface RequestEmailContext {
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
  publicUrl: string; // e.g. https://proteinoutfitters.com
}

// ============================================================================
// Email to processor — the warm-lead pitch
// ============================================================================

export function processorEmailSubject(c: RequestEmailContext): string {
  return `New service request from ${c.consumerName} — ${ANIMAL_LABELS[c.animal]}`;
}

export function processorEmailText(c: RequestEmailContext): string {
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

export function processorEmailHtml(c: RequestEmailContext): string {
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
        Hi ${escape(c.processorName)} — a customer found you on the Protein Outfitters map and wants to send you business.
      </p>

      <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #2a3140;border-radius:10px;background:#1a1f2a;">
        <tr><td style="padding:16px;">
          <div style="color:#5fb377;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;">The request</div>
          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#e8ebf0;line-height:1.7;">
            <tr><td style="color:#7d8896;width:120px;">Service</td><td>${escape(SERVICE_LABELS[c.service])}</td></tr>
            <tr><td style="color:#7d8896;">Animal</td><td>${escape(ANIMAL_LABELS[c.animal])}</td></tr>
            ${c.preferredDate ? `<tr><td style="color:#7d8896;">Preferred date</td><td>${escape(c.preferredDate)}</td></tr>` : ''}
            ${c.notes ? `<tr><td style="color:#7d8896;vertical-align:top;">Notes</td><td>${escape(c.notes).replace(/\n/g, '<br>')}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="padding:0 16px 16px;">
          <div style="color:#6ea3d4;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin:16px 0 8px;">The customer</div>
          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#e8ebf0;line-height:1.7;">
            <tr><td style="color:#7d8896;width:120px;">Name</td><td>${escape(c.consumerName)}</td></tr>
            <tr><td style="color:#7d8896;">Email</td><td><a href="mailto:${escape(c.consumerEmail)}" style="color:#5fb377;">${escape(c.consumerEmail)}</a></td></tr>
            ${c.consumerPhone ? `<tr><td style="color:#7d8896;">Phone</td><td><a href="tel:${escape(c.consumerPhone)}" style="color:#5fb377;">${escape(c.consumerPhone)}</a></td></tr>` : ''}
            ${c.consumerZip ? `<tr><td style="color:#7d8896;">ZIP</td><td>${escape(c.consumerZip)}</td></tr>` : ''}
          </table>
        </td></tr>
      </table>

      <p style="color:#aab2c0;font-size:13px;line-height:1.6;margin:16px 0;">
        Reply directly to this email — your reply goes straight to ${escape(c.consumerName)}.
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

// ============================================================================
// Confirmation email to consumer
// ============================================================================

export function consumerEmailSubject(c: RequestEmailContext): string {
  return `We sent your request to ${c.processorName}`;
}

export function consumerEmailText(c: RequestEmailContext): string {
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

export function consumerEmailHtml(c: RequestEmailContext): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#0f1115;color:#e8ebf0;font-family:-apple-system,Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:24px;">
    <tr><td>
      <div style="font-size:13px;color:#7d8896;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Protein Outfitters</div>
      <h1 style="margin:6px 0 0;font-size:22px;letter-spacing:-0.5px;">Request sent</h1>
      <p style="color:#aab2c0;font-size:15px;line-height:1.6;margin:12px 0 16px;">
        Hi ${escape(c.consumerName)} — we forwarded your request to <strong style="color:#fff;">${escape(c.processorName)}</strong>. They have your contact info and will reach out directly.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #2a3140;border-radius:10px;background:#1a1f2a;">
        <tr><td style="padding:16px;font-size:14px;line-height:1.7;color:#e8ebf0;">
          <div style="color:#7d8896;">Service</div><div>${escape(SERVICE_LABELS[c.service])}</div>
          <div style="color:#7d8896;margin-top:8px;">Animal</div><div>${escape(ANIMAL_LABELS[c.animal])}</div>
          ${c.preferredDate ? `<div style="color:#7d8896;margin-top:8px;">Preferred date</div><div>${escape(c.preferredDate)}</div>` : ''}
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

// ============================================================================
// helpers
// ============================================================================
function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
