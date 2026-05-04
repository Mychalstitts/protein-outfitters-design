// Shared DB + auth + utility helpers for serverless functions.
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

// ─── JSON response helper ──────────────────────────────────
export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}

export function err(status, message, extra = {}) {
  return json({ error: message, ...extra }, { status });
}

// ─── Cookie helpers ────────────────────────────────────────
export function parseCookies(req) {
  const cookie = req.headers.get('cookie') || '';
  return Object.fromEntries(
    cookie.split(';').filter(Boolean).map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    })
  );
}

export function setSessionCookie(sessionId, maxAgeDays = 30) {
  const maxAge = maxAgeDays * 86400;
  const isProd = process.env.VERCEL_ENV === 'production';
  return `po_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? '; Secure' : ''}`;
}

export function clearSessionCookie() {
  return `po_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ─── Session lookup ────────────────────────────────────────
export async function currentUser(req) {
  const sessionId = parseCookies(req).po_session;
  if (!sessionId) return null;
  const rows = await sql`
    SELECT u.id, u.email, u.name, u.role, u.zip, u.avatar_url, u.phone
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  return user;
}

// ─── Random token generator ────────────────────────────────
export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Slug helper ───────────────────────────────────────────
export function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}
