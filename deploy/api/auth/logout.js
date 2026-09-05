// POST /api/auth/logout — clears session cookie + DB row
// Also accepts Authorization: Bearer <sessionId> (mobile).
import {
  sql,
  getSessionToken,
  clearSessionCookie,
  nodejsHandler,
} from '../_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const sessionId = getSessionToken(req);
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

export default nodejsHandler(handler);
