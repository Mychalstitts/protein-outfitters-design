// /api/admin-bootstrap — promote a user to a role (typically admin)
//
//   POST /api/admin-bootstrap?secret=$MIGRATE_SECRET
//     body: { email, role? }    role defaults to 'admin'; allowed: admin|producer|processor|buyer
//
// This is the chicken-and-egg solution: until someone has role='admin' in
// the users table, none of the admin tools (/admin-overview, /admin-health,
// /admin-email) are reachable. Going through Neon SQL works but is friction.
//
// MIGRATE_SECRET-gated so anyone with the same secret that runs migrations
// can bootstrap themselves; no other path. Idempotent — calling it on a user
// who's already that role is a no-op.

import { sql, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOWED_ROLES = ['admin', 'producer', 'processor', 'buyer'];

export default async function handler(req) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');

  if (!process.env.MIGRATE_SECRET) {
    return err(503, 'MIGRATE_SECRET env var not set on the server');
  }
  if (!secret || secret !== process.env.MIGRATE_SECRET) {
    return err(401, 'Unauthorized — pass ?secret=$MIGRATE_SECRET');
  }

  if (req.method !== 'POST') return err(405, 'Method not allowed');

  let body = {};
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const email = (body.email || '').trim().toLowerCase();
  const role  = (body.role  || 'admin').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return err(400, 'valid email required');
  if (!ALLOWED_ROLES.includes(role)) return err(400, `role must be one of: ${ALLOWED_ROLES.join(', ')}`);

  // Find or create the user. We DON'T create a new auth row here — if they
  // don't exist yet, we still upsert so the next magic-link signup links up
  // to the pre-set role.
  const existing = await sql`SELECT id, email, role FROM users WHERE email = ${email} LIMIT 1`;
  if (existing[0]) {
    if (existing[0].role === role) {
      return json({ ok: true, email, role, already: true, message: `${email} is already ${role}` });
    }
    await sql`UPDATE users SET role = ${role}, updated_at = NOW() WHERE email = ${email}`;
    return json({ ok: true, email, role, was: existing[0].role, message: `${email}: ${existing[0].role} → ${role}` });
  }
  // User doesn't exist yet — pre-create with the role. They'll attach this row
  // on first magic-link sign-in.
  await sql`
    INSERT INTO users (email, role)
    VALUES (${email}, ${role})
    ON CONFLICT (email) DO UPDATE SET role = ${role}, updated_at = NOW()`;
  return json({ ok: true, email, role, created: true, message: `Pre-created ${email} as ${role}. Magic-link sign in to claim.` });
}
