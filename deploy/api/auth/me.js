// GET /api/auth/me — returns current user or null
import { currentUser, json, nodejsHandler } from '../_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const u = await currentUser(req);
  return json({ user: u });
}

export default nodejsHandler(handler);
