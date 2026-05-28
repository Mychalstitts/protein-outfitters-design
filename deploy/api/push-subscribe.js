// /api/push-subscribe — store a Web Push subscription for the current user.
//
// POST body shape (the standard PushSubscription.toJSON() output):
//   {
//     endpoint: 'https://fcm.googleapis.com/...',
//     keys: { p256dh: '...', auth: '...' }
//   }
//
// We dedupe by endpoint (UNIQUE in the schema) — same browser re-subscribing
// just bumps last_seen_at + reattaches to whichever user is currently signed in.
// Anonymous subs are allowed (user_id NULL) so a visitor can opt in to "drop
// alert" notifications before they have an account.
//
// VAPID key pair lives in env vars VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. The
// public key is exposed to the frontend via /api/public-config; the actual
// push send happens server-side via web-push from a future /api/push-send.
//
// GET → returns { vapid_public_key } so po-shell.js can subscribe without
//        a separate config round-trip.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (req.method === 'GET') {
    const key = process.env.VAPID_PUBLIC_KEY || '';
    return json({ vapid_public_key: key, configured: !!key });
  }

  if (req.method !== 'POST') return err(405, 'Method not allowed');

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const authKey = body?.keys?.auth;
  if (!endpoint || !p256dh || !authKey) {
    return err(400, 'endpoint + keys.p256dh + keys.auth all required');
  }

  const user = await currentUser(req);
  const ua = (req.headers.get('user-agent') || '').slice(0, 240);

  // Upsert by endpoint — repeated calls from the same device just refresh
  // last_seen + re-attach to the current user (handy after sign-in).
  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
    VALUES (${user?.id || null}, ${endpoint}, ${p256dh}, ${authKey}, ${ua})
    ON CONFLICT (endpoint) DO UPDATE
      SET user_id      = COALESCE(push_subscriptions.user_id, EXCLUDED.user_id),
          p256dh       = EXCLUDED.p256dh,
          auth_key     = EXCLUDED.auth_key,
          user_agent   = EXCLUDED.user_agent,
          last_seen_at = NOW()
  `;

  return json({ ok: true, attached_user: !!user });
}
