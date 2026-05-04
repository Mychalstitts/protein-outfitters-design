// POST /api/auth/logout — clears session cookie + DB row
import { sql, parseCookies, clearSessionCookie } from '../_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const sessionId = parseCookies(req).po_session;
  if (sessionId) {
    try { await sql`DELETE FROM sessions WHERE id = ${sessionId}`; } catch {}
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie()
    }
  });
}
