// POST /api/auth/request-link — body: {email, role?}
// Creates an auth_token, sends email via Resend (or returns link in dev).
import { sql, err, json, randomToken } from '../_lib/db.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'POST only');
  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const email = (body.email || '').trim().toLowerCase();
  const desiredRole = body.role; // optional 'producer' / 'processor' / 'buyer'
  if (!email || !email.includes('@')) return err(400, 'Valid email required');

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

  await sql`
    INSERT INTO auth_tokens (token, email, expires_at)
    VALUES (${token}, ${email}, ${expiresAt})
  `;

  // If user doesn't exist, pre-create with desired role (else default 'buyer')
  await sql`
    INSERT INTO users (email, role)
    VALUES (${email}, ${desiredRole || 'buyer'})
    ON CONFLICT (email) DO NOTHING
  `;

  const origin = req.headers.get('origin') || 'https://www.proteinoutfitters.com';
  const link = `${origin}/api/auth/verify?token=${token}`;

  // Try to send via Resend if configured
  const resendKey = process.env.RESEND_API_KEY;
  let emailSent = false;
  let devLink = null;

  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'Protein Outfitters <hello@proteinoutfitters.com>',
          to: [email],
          subject: 'Your Protein Outfitters sign-in link',
          html: signInEmailHtml(link),
          text: `Click to sign in: ${link}\n\nThis link expires in 30 minutes.\n\nIf you didn't request this, you can safely ignore this email.`
        })
      });
      emailSent = r.ok;
      if (!r.ok) devLink = link; // surface for debugging
    } catch (e) {
      devLink = link;
    }
  } else {
    // Dev mode — return the link directly so you can copy-paste during testing
    devLink = link;
  }

  return json({ ok: true, emailSent, devLink });
}

function signInEmailHtml(link) {
  return `<!doctype html><html><body style="font-family:-apple-system,Inter,Helvetica,Arial,sans-serif;background:#fbf9f5;padding:48px 24px;color:#061b0e">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;padding:38px 32px;box-shadow:0 8px 28px rgba(6,27,14,.08)">
    <div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#061b0e;opacity:.6">Protein Outfitters</div>
    <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.02em;margin:14px 0 8px">Sign in to your account</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 24px;opacity:.78">Tap the button below to finish signing in. The link expires in 30 minutes.</p>
    <a href="${link}" style="display:inline-block;background:#061b0e;color:#fbf9f5;padding:14px 26px;border-radius:999px;font-weight:700;text-decoration:none;letter-spacing:.01em">Sign in →</a>
    <p style="font-size:13px;line-height:1.55;margin:28px 0 0;opacity:.55">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all;color:#061b0e">${link}</span></p>
    <p style="font-size:12px;margin-top:32px;padding-top:20px;border-top:1px solid #eee;opacity:.45">If you didn't request this, you can safely ignore this email.</p>
  </div></body></html>`;
}
