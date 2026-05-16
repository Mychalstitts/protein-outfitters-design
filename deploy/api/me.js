// GET   /api/me — alias for /api/auth/me (returns current user or null)
// PATCH /api/me — alias for /api/auth/me PATCH (update profile fields)
//
// Some older code paths (and future mobile / partner integrations) reach for
// the un-namespaced /api/me; without this shim those calls 404. Mirror the
// canonical handler in /api/auth/me here.
//
// IMPORTANT: do NOT re-export from ./auth/me.js — Vercel reads `export const
// config` as a static literal at build time, and re-export resolves at runtime,
// which makes /api/me deploy as a default Node handler that hangs ~30s before
// the edge code path resolves. Declare `runtime` inline and re-implement
// the handler. (Found run 22.)
import { sql, currentUser, json, err } from './_lib/db.js';

export const config = { runtime: 'edge' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = { name: 120, email: 200, phone: 40, zip: 20, avatar_url: 1000 };

export default async function handler(req) {
  if (req.method === 'GET') {
    const u = await currentUser(req);
    return json({ user: u });
  }

  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const patch = {};
    if (typeof body.name === 'string')        patch.name        = body.name.trim().slice(0, MAX.name);
    if (typeof body.email === 'string')       patch.email       = body.email.trim().toLowerCase().slice(0, MAX.email);
    if (typeof body.phone === 'string')       patch.phone       = body.phone.trim().slice(0, MAX.phone);
    if (typeof body.zip === 'string')         patch.zip         = body.zip.trim().slice(0, MAX.zip);
    if (typeof body.avatar_url === 'string')  patch.avatar_url  = body.avatar_url.trim().slice(0, MAX.avatar_url);

    if (Object.keys(patch).length === 0) return json({ user });
    if ('email' in patch && patch.email && !EMAIL_RE.test(patch.email)) {
      return err(400, 'Invalid email format');
    }
    if ('email' in patch && patch.email && patch.email !== user.email) {
      const conflict = await sql`SELECT id FROM users WHERE email = ${patch.email} AND id <> ${user.id} LIMIT 1`;
      if (conflict[0]) return err(409, 'That email is already used by another account');
    }

    if ('name' in patch)        await sql`UPDATE users SET name = ${patch.name},               updated_at = NOW() WHERE id = ${user.id}`;
    if ('email' in patch)       await sql`UPDATE users SET email = ${patch.email},             updated_at = NOW() WHERE id = ${user.id}`;
    if ('phone' in patch)       await sql`UPDATE users SET phone = ${patch.phone},             updated_at = NOW() WHERE id = ${user.id}`;
    if ('zip' in patch)         await sql`UPDATE users SET zip = ${patch.zip},                 updated_at = NOW() WHERE id = ${user.id}`;
    if ('avatar_url' in patch)  await sql`UPDATE users SET avatar_url = ${patch.avatar_url},   updated_at = NOW() WHERE id = ${user.id}`;

    const rows = await sql`SELECT id, email, name, role, zip, avatar_url, phone FROM users WHERE id = ${user.id} LIMIT 1`;
    return json({ user: rows[0] || null });
  }

  return err(405, 'Method not allowed');
}
