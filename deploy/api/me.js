// GET /api/me — defensive alias for /api/auth/me
// Some older code paths (and any future mobile build / partner integration) reach for the
// un-namespaced /api/me; without this shim that's a hard 404. Keep the canonical handler in
// /api/auth/me and just re-export it here so the response shape stays in lockstep.
import handler, { config as authMeConfig } from './auth/me.js';

export const config = authMeConfig;
export default handler;
