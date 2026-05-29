// GET /api/auth/verify?token=XXX&next=/account&ref=XYZ123
// Consumes magic-link token, creates session, sets cookie, redirects.
//
// `ref` (or `?ref=` embedded in `next`) is captured into users.referred_by_code
// for newly created users. Triggers a referral_redemptions row so the credit
// pipeline (stripe-webhook.js) can reward both sides on the first paid order.
import { sql, randomToken, setSessionCookie, nodejsHandler } from '../_lib/db.js';

export const config = { runtime: 'nodejs' };

// Pull a referral code out of either the explicit ?ref= param, or whatever
// `next` URL the user is bouncing to (e.g. /discover?ref=XYZ). Codes are
// 6-char A-Z/2-9 — anything else is rejected to keep the column clean.
function extractRefCode(url, nextRaw) {
  const direct = url.searchParams.get('ref');
  if (direct && /^[A-Z2-9]{6}$/i.test(direct.trim())) return direct.trim().toUpperCase();
  try {
    if (nextRaw && nextRaw.includes('ref=')) {
      // `next` may be a relative path with its own query string
      const u = new URL(nextRaw, 'https://www.proteinoutfitters.com');
      const r = u.searchParams.get('ref');
      if (r && /^[A-Z2-9]{6}$/i.test(r.trim())) return r.trim().toUpperCase();
    }
  } catch { /* ignore malformed next */ }
  return null;
}

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const token = url.searchParams.get('token');
  const next = url.searchParams.get('next') || '/account';
  const refCode = extractRefCode(url, next);
  if (!token) return new Response('Missing token', { status: 400 });

  // Look up token
  const rows = await sql`
    SELECT email, expires_at, consumed_at
    FROM auth_tokens
    WHERE token = ${token}
    LIMIT 1
  `;
  if (!rows[0]) return errorPage('Invalid sign-in link', 'This link is not valid. It may have already been used or never existed.');
  const t = rows[0];
  if (t.consumed_at) return errorPage('Already used', 'This sign-in link has already been used. Request a new one.');
  if (new Date(t.expires_at) < new Date()) return errorPage('Expired', 'This sign-in link has expired. Request a new one.');

  // Mark token consumed
  await sql`UPDATE auth_tokens SET consumed_at = NOW() WHERE token = ${token}`;

  // Find or create user.
  //
  // ⚠ Critical: keep the bare INSERT as the primary path. An earlier change
  // here referenced `users.referred_by_code` directly, which doesn't exist
  // until the batch-4 migration runs — so every magic-link sign-in was
  // throwing a "column does not exist" error until the migration fired.
  // The referral capture is now best-effort and runs AFTER the user is
  // safely created, in a try/catch that can't break auth.
  const userRows = await sql`
    INSERT INTO users (email)
    VALUES (${t.email})
    ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
    RETURNING id, (xmax = 0) AS is_new
  `;
  const userId = userRows[0].id;
  const isNew = !!userRows[0].is_new;

  // Best-effort: stamp the referral code + log a pending redemption. Both
  // wrapped in try/catch so a missing column or table never breaks sign-in.
  if (refCode) {
    try {
      // Only stamps if the column exists AND the user doesn't already have one
      // (first-touch wins). Silently no-ops pre-migration.
      await sql`
        UPDATE users
        SET referred_by_code = ${refCode}, updated_at = NOW()
        WHERE id = ${userId} AND referred_by_code IS NULL
      `;
      if (isNew) {
        const codeRow = await sql`SELECT owner_user_id FROM referral_codes WHERE code = ${refCode} LIMIT 1`;
        if (codeRow[0] && codeRow[0].owner_user_id !== userId) {
          await sql`
            INSERT INTO referral_redemptions (code, redeemed_by, redeemed_email, reward_status)
            VALUES (${refCode}, ${userId}, ${t.email}, 'pending')
          `;
        }
      }
    } catch (e) {
      console.error('referral-capture (non-fatal):', e.message);
    }
  }

  // Create session
  const sessionId = randomToken(40);
  const expiresAt = new Date(Date.now() + 30 * 86400 * 1000); // 30 days
  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${sessionId}, ${userId}, ${expiresAt})
  `;

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': setSessionCookie(sessionId),
      'Location': next
    }
  });
}

function errorPage(title, message) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${title} · Protein Outfitters</title><style>body{font-family:-apple-system,Inter,Helvetica,Arial,sans-serif;background:#fbf9f5;color:#061b0e;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px} .card{max-width:460px;background:#fff;border-radius:18px;padding:40px 32px;box-shadow:0 8px 28px rgba(6,27,14,.08);text-align:center} h1{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 12px} p{font-size:15px;line-height:1.55;opacity:.75;margin:0 0 24px} a{display:inline-block;background:#061b0e;color:#fbf9f5;padding:12px 22px;border-radius:999px;font-weight:700;text-decoration:none}</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p><a href="/">Back to home</a></div></body></html>`, {
    status: 400,
    headers: { 'Content-Type': 'text/html' }
  });
}

export default nodejsHandler(handler);
