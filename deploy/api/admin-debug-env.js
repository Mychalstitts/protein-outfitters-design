// /api/admin-debug-env — admin-only env diagnostic.
// REPORTS PRESENCE + LENGTH ONLY (never values) for VAPID_* and a couple
// other known-good vars. Lets us tell if an env var is missing vs typoed
// vs present-but-empty without ever logging the secret itself.
//
// Should be deleted once we're done debugging. Documented as temporary
// in the response payload.

import { currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'admin') return err(403, 'Admin only');

  const report = (k) => {
    const v = process.env[k];
    if (v === undefined) return { present: false };
    return {
      present: true,
      length: v.length,
      starts_with: v.slice(0, 6),
      ends_with: v.slice(-4),
      has_leading_space: v[0] === ' ' || v[0] === '\t',
      has_trailing_space: v[v.length - 1] === ' ' || v[v.length - 1] === '\t',
      starts_with_quote: v[0] === '"' || v[0] === "'",
    };
  };

  // Also list every env var key that contains VAPID, to catch typos like
  // "VAPID_PUB_KEY" or accidental "VAPID_PUBLIC_KEY_PROD".
  const vapidKeys = Object.keys(process.env).filter(k => k.toUpperCase().includes('VAPID'));

  return json({
    _warning: 'TEMPORARY DEBUG ENDPOINT — DELETE WHEN DONE',
    vapid_keys_found_in_env: vapidKeys,
    VAPID_PUBLIC_KEY: report('VAPID_PUBLIC_KEY'),
    VAPID_PRIVATE_KEY: report('VAPID_PRIVATE_KEY'),
    VAPID_SUBJECT: report('VAPID_SUBJECT'),
    // Sanity-check against a known-good var.
    DATABASE_URL: { present: !!process.env.DATABASE_URL, length: (process.env.DATABASE_URL || '').length },
    STRIPE_SECRET_KEY: { present: !!process.env.STRIPE_SECRET_KEY },
  });
}
