// GET /api/me — defensive alias for /api/auth/me
// Some older code paths (and any future mobile build / partner integration) reach for the
// un-namespaced /api/me; without this shim that's a hard 404. Keep the canonical handler in
// /api/auth/me; mirror it here.
//
// IMPORTANT: do NOT do `export { config } from './auth/me.js'` — Vercel's build
// reads `export const config` as a static literal at compile time. Re-exporting
// from another module produced an undefined runtime at build time, which made
// /api/me deploy as a default Node handler that then hung for ~30s before the
// edge code path could resolve. Always declare `runtime` inline. (Found run 22.)
import { currentUser, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const u = await currentUser(req);
  return json({ user: u });
}
