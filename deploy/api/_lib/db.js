// Shared DB + auth + utility helpers for serverless functions.
//
// 2026-05-28: migrated off `@neondatabase/serverless` to `postgres` (porsager)
// after Neon hit its compute-time quota and the user moved to Supabase Pro.
// This file is the only required change for the driver swap — the template
// literal SQL syntax (sql`SELECT ... ${val}`) is identical between the two
// libraries, so callers don't need any changes.
//
// IMPORTANT: porsager's `postgres` uses raw TCP, which Vercel's Edge runtime
// doesn't support. Every API function in this repo must declare
// `export const config = { runtime: 'nodejs' }` (not 'edge'). The mass-flip
// is in commit history alongside this change.
import postgres from 'postgres';

// Singleton — `postgres` handles pooling internally. Use Supabase's
// transaction-mode pooler URL (port 6543) for serverless connections that
// shouldn't hold long-lived sessions. The connection string lives in
// DATABASE_URL on Vercel.
//
// 2026-05-28: parse DATABASE_URL with Node's URL constructor and pass
// explicit options to `postgres`, rather than handing the URL string to
// porsager's library. porsager's URL parser was mishandling Supabase's
// dotted username format (`postgres.PROJECT_REF`) — the username was being
// truncated at the dot, causing "password authentication failed for user
// 'postgres'" even with a correct password. Node's URL parser handles the
// dot correctly, and the options-object form bypasses porsager's parser
// entirely.
const _dbUrl = new URL(process.env.DATABASE_URL);
export const sql = postgres({
  host: _dbUrl.hostname,
  port: Number(_dbUrl.port || 5432),
  database: _dbUrl.pathname.slice(1) || 'postgres',
  username: decodeURIComponent(_dbUrl.username),
  password: decodeURIComponent(_dbUrl.password),
  ssl: 'require',
  max: 4,                  // small pool per function instance
  idle_timeout: 20,        // recycle idle clients after 20s
  connect_timeout: 10,
  prepare: false,          // pooler-friendly: avoid prepared statements with transaction pooler
});

// Backwards-compat shim for the few callsites that used Pool/rawQuery.
// porsager's `sql.unsafe(text, params)` accepts raw SQL + bind values and
// returns rows directly, matching the shape pool.query(...).rows used to
// produce.
export function getPool() {
  return {
    query: async (text, params = []) => ({
      rows: await sql.unsafe(text, params),
    }),
  };
}
export async function rawQuery(text, params = []) {
  return await sql.unsafe(text, params);
}

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
// Handle both runtimes: Edge (Web Fetch req with headers.get) and
// Node.js (IncomingMessage with headers as plain object).
export function parseCookies(req) {
  const headers = req.headers;
  const cookie = (typeof headers?.get === 'function')
    ? (headers.get('cookie') || '')
    : (headers?.cookie || headers?.Cookie || '');
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
