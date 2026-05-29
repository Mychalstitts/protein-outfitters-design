// /api/push-test — admin-only smoke test for the web-push pipeline.
//
//   GET                       → reports VAPID env presence + subscription count
//   POST { to?: email }       → fires a data-less push to the target user
//                               (defaults to the calling admin's own email)
//
// Pair with the Service Worker's `push` handler (deploy/sw.js). The push
// arrives as an empty event; the SW then fetches /api/notifications and
// shows whatever's newest, so leave at least one fresh in-app notification
// in the inbox before testing — or POST one ad-hoc via /api/notifications.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };
export default async function handler(req) {
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'admin') return err(403, 'Admin only');

  if (req.method === 'GET') {
    const subCount = await sql`SELECT COUNT(*)::int AS c FROM push_subscriptions`;
    const mySubCount = await sql`SELECT COUNT(*)::int AS c FROM push_subscriptions WHERE user_id = ${user.id}`;
    return json({
      vapid_public_configured: !!process.env.VAPID_PUBLIC_KEY,
      vapid_private_configured: !!process.env.VAPID_PRIVATE_KEY,
      vapid_subject: process.env.VAPID_SUBJECT || null,
      total_subscriptions: subCount[0]?.c ?? 0,
      your_subscriptions: mySubCount[0]?.c ?? 0,
    });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const to = (body.to || user.email).toLowerCase();
    const { sendPushTo } = await import('./_lib/push.js');
    const out = await sendPushTo({ email: to });
    return json({ to, ...out });
  }

  return err(405, 'Method not allowed');
}
