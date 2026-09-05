// POST /api/auth/request-link — body: {email, role?}
// Creates an auth_token, sends email via Resend (or returns link in dev).
import { sql, err, json, randomToken, nodejsHandler } from '../_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'POST only');
  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  if (!body || typeof body !== 'object') return err(400, 'JSON body required');
  const email = (body.email || '').trim().toLowerCase();
  const desiredRole = body.role; // optional 'producer' / 'processor' / 'buyer'
  if (!email || !email.includes('@')) return err(400, 'Valid email required');

  // Optional: referral code + post-login return path, threaded into the magic
  // link so /api/auth/verify can attribute the referral redemption on signup.
  const refRaw = (body.ref || '').trim().toUpperCase();
  const refCode = /^[A-Z2-9]{6}$/.test(refRaw) ? refRaw : null;
  const nextRaw = typeof body.next === 'string' ? body.next : '';
  const nextPath = (nextRaw.startsWith('/') && !nextRaw.startsWith('//')) ? nextRaw : null;

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
  // Mobile may pass a custom-scheme deep link (proteinoutfitters://auth/callback)
  // or an https universal link. Relative paths stay on the web origin.
  const nextRawMobile = typeof body.next === 'string' ? body.next.trim() : '';
  const nextForLink = (() => {
    if (nextPath) return nextPath;
    if (!nextRawMobile) return null;
    if (/^proteinoutfitters:\/\//i.test(nextRawMobile)) return nextRawMobile;
    if (/^exp[s]?:\/\//i.test(nextRawMobile)) return nextRawMobile;
    if (/^https:\/\/(www\.)?proteinoutfitters\.com\//i.test(nextRawMobile)) {
      try {
        const u = new URL(nextRawMobile);
        return `${u.pathname}${u.search}`;
      } catch { return null; }
    }
    return null;
  })();
  const linkParams = new URLSearchParams({ token });
  if (nextForLink) linkParams.set('next', nextForLink);
  if (refCode) linkParams.set('ref', refCode);
  // Mobile clients can ask for JSON verify in the email landing path via
  // format=json when they open the link inside the app WebView — optional.
  if (body.client === 'mobile' && !nextForLink) linkParams.set('format', 'json');
  const link = `${origin}/api/auth/verify?${linkParams.toString()}`;

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

export default nodejsHandler(handler);
