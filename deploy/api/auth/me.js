// GET /api/auth/me — returns current user or null
import { currentUser, json } from '../_lib/db.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  const u = await currentUser(req);
  return json({ user: u });
}
