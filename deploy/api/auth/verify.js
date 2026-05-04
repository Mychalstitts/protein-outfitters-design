// GET /api/auth/verify?token=XXX&next=/account
// Consumes magic-link token, creates session, sets cookie, redirects.
import { sql, randomToken, setSessionCookie } from '../_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const next = url.searchParams.get('next') || '/account';
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

  // Find or create user
  const userRows = await sql`
    INSERT INTO users (email)
    VALUES (${t.email})
    ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `;
  const userId = userRows[0].id;

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
