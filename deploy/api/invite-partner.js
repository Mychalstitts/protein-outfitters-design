// /api/invite-partner — send an invite email to a farm or processor
//   POST { kind: 'farm'|'processor', name, email, phone?, discovered_id?, message? }
// Auth: any signed-in user can invite (customer-driven viral loop).
// Records the invite in `invites` table, updates discovered_partners status,
// sends invite via Resend with personal link to claim a profile.
import { Resend } from 'resend';
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const FROM = process.env.RESEND_FROM || 'Protein Outfitters <hello@proteinoutfitters.com>';
const SITE = 'https://www.proteinoutfitters.com';

function inviteSubject(kind, partnerName) {
  return kind === 'processor'
    ? `${partnerName} — a customer would like to book you on Protein Outfitters`
    : `${partnerName} — your farm was suggested for Protein Outfitters`;
}

function inviteHtml({ kind, partnerName, inviterName, inviterEmail, personalMessage, claimUrl }) {
  const inviterLabel = inviterName || inviterEmail || 'A buyer';
  const role = kind === 'processor' ? 'processor' : 'farm';
  const value = kind === 'processor'
    ? 'When a buyer reserves an animal nearby, they pick a processor at checkout. Plants on Protein Outfitters get the booking, the deposit, and a vetted customer pre-paid before drop-off.'
    : 'Sell whole, half, or quarter shares of every animal you raise — direct to local buyers, paid up front, no marketplace cut on your meat (we charge a flat platform fee separately).';
  const personal = personalMessage
    ? `<blockquote style="margin:18px 0;padding:14px 18px;background:rgba(125,160,93,.08);border-left:4px solid #7da05d;font:500 14px/1.5 Inter;color:#3a4a3f;">"${personalMessage.replace(/[<>]/g, '')}"</blockquote>`
    : '';

  return `
<!doctype html>
<html><body style="margin:0;padding:0;background:#fbf9f5;font-family:Inter,system-ui,-apple-system,sans-serif;color:#061b0e;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <img src="${SITE}/brand/logo-monogram.svg" alt="Protein Outfitters" width="44" height="44" style="border-radius:10px;margin-bottom:20px;display:block;" />
    <h1 style="font:900 28px/1.15 Inter;letter-spacing:-0.02em;margin:0 0 14px;">A local buyer picked you.</h1>
    <p style="font:500 16px/1.55 Inter;color:#3a4a3f;margin:0 0 16px;">
      Hey ${partnerName} —
    </p>
    <p style="font:500 16px/1.55 Inter;color:#3a4a3f;margin:0 0 16px;">
      <strong style="color:#061b0e;">${inviterLabel}</strong> just reserved an animal on
      <strong style="color:#061b0e;">Protein Outfitters</strong> and asked us to invite you as their preferred ${role}. That's a real customer with a real reservation, today.
    </p>
    ${personal}
    <p style="font:500 16px/1.55 Inter;color:#3a4a3f;margin:0 0 22px;">
      ${value}
    </p>
    <p style="margin:0 0 28px;">
      <a href="${claimUrl}" style="display:inline-block;background:#061b0e;color:#fbf9f5;text-decoration:none;padding:14px 26px;border-radius:999px;font:800 14px/1 Inter;letter-spacing:.01em;">Claim your profile →</a>
    </p>
    <p style="font:500 13px/1.5 Inter;color:#6b7270;margin:0 0 8px;">
      Sign-in is by magic link — no password. We'll pre-fill your name and address so you can review and publish in 2 minutes.
    </p>
    <p style="font:500 12px/1.5 Inter;color:#9aa0a0;margin:32px 0 0;">
      Don't want these? Just ignore this email — we won't follow up. Protein Outfitters · Nationwide · proteinoutfitters.com
    </p>
  </div>
</body></html>`;
}

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  if (!process.env.RESEND_API_KEY) return err(500, 'Resend not configured');

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const { kind, name, email, phone, discovered_id, message } = body;
  if (!kind || !['farm', 'processor'].includes(kind)) return err(400, 'kind must be "farm" or "processor"');
  if (!name) return err(400, 'name required');
  if (!email && !phone) return err(400, 'email or phone required');

  const user = await currentUser(req);
  // Allow anonymous invites with a captcha-equivalent: require an email so we
  // can rate-limit per inviter. (Add real captcha later if abuse appears.)
  if (!user && !body.inviter_email) return err(401, 'Sign in or provide inviter_email');
  const inviterEmail = user?.email || body.inviter_email;
  const inviterName  = user?.name || body.inviter_name || null;

  // Resolve / create discovered_partners row so the invite is anchored to it
  let discoveredId = discovered_id || null;
  if (!discoveredId) {
    try {
      const rows = await sql`
        INSERT INTO discovered_partners (kind, name, email, phone, source, source_ref, invite_status)
        VALUES (${kind}, ${name}, ${email || null}, ${phone || null}, 'customer', ${'cust:' + (email || phone)}, 'queued')
        ON CONFLICT (source, source_ref) DO UPDATE
          SET name = EXCLUDED.name,
              email = COALESCE(EXCLUDED.email, discovered_partners.email),
              phone = COALESCE(EXCLUDED.phone, discovered_partners.phone),
              updated_at = NOW()
        RETURNING id`;
      discoveredId = rows[0]?.id || null;
    } catch (e) { /* if table doesn't exist yet, skip */ }
  }

  // Personalized claim link
  const claimUrl = `${SITE}/onboarding?as=${kind === 'farm' ? 'producer' : 'processor'}&invite=${discoveredId || 'direct'}&via=${encodeURIComponent(inviterEmail)}`;

  // Insert invite record
  let inviteId = null;
  try {
    const irows = await sql`
      INSERT INTO invites (
        discovered_id, kind, name, email, phone,
        inviter_user_id, inviter_email, inviter_name, message, channel, status
      ) VALUES (
        ${discoveredId}, ${kind}, ${name}, ${email || null}, ${phone || null},
        ${user?.id || null}, ${inviterEmail}, ${inviterName}, ${message || null}, 'email', 'queued'
      )
      RETURNING id`;
    inviteId = irows[0]?.id || null;
  } catch (e) { /* keep going — email send still attempted */ }

  // Send invite (only if we have an email)
  let resendId = null, sendError = null;
  if (email) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const r = await resend.emails.send({
        from: FROM,
        to: email,
        reply_to: inviterEmail,
        subject: inviteSubject(kind, name),
        html: inviteHtml({ kind, partnerName: name, inviterName, inviterEmail, personalMessage: message, claimUrl })
      });
      resendId = r.data?.id || null;
      if (inviteId) {
        await sql`UPDATE invites SET status = 'sent', resend_message_id = ${resendId}, sent_at = NOW() WHERE id = ${inviteId}`;
      }
      if (discoveredId) {
        await sql`UPDATE discovered_partners SET invite_status = 'sent', invited_by = ${user?.id || null}, invited_at = NOW(), updated_at = NOW() WHERE id = ${discoveredId}`;
      }
    } catch (e) {
      sendError = e.message;
      if (inviteId) {
        await sql`UPDATE invites SET status = 'failed' WHERE id = ${inviteId}`;
      }
    }
  }

  return json({
    invite_id: inviteId,
    discovered_id: discoveredId,
    sent: !!resendId,
    resend_id: resendId,
    error: sendError,
    claim_url: claimUrl
  });
}

export default nodejsHandler(handler);
