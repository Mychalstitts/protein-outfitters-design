// /api/notifications — in-app notification inbox
//
//   GET                       → recent notifications for current user (limit 50)
//   GET ?unread=1             → only unread
//   GET ?count=1              → { unread } only — for the bell badge
//   PATCH ?id=<uuid>          → mark a single notification read
//   PATCH ?all=1              → mark all read
//   POST  (admin only)        → create one ad-hoc (used by lifecycle hook + manual ops)
//
// Notifications are written by /api/_lib/email.js whenever a lifecycle
// email is sent, so the inbox always mirrors what we emailed the user.

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  // ── Bell-badge fast path ──
  if (req.method === 'GET' && url.searchParams.get('count') === '1') {
    const rows = await sql`
      SELECT COUNT(*)::int AS c
      FROM notifications
      WHERE user_email = ${user.email} AND read_at IS NULL`;
    return json({ unread: rows[0]?.c ?? 0 });
  }

  // ── List inbox ──
  if (req.method === 'GET') {
    const onlyUnread = url.searchParams.get('unread') === '1';
    const rows = onlyUnread
      ? await sql`
          SELECT id, kind, title, body, link_url, icon, read_at, created_at
          FROM notifications
          WHERE user_email = ${user.email} AND read_at IS NULL
          ORDER BY created_at DESC LIMIT 50`
      : await sql`
          SELECT id, kind, title, body, link_url, icon, read_at, created_at
          FROM notifications
          WHERE user_email = ${user.email}
          ORDER BY created_at DESC LIMIT 50`;
    const unread = await sql`
      SELECT COUNT(*)::int AS c
      FROM notifications WHERE user_email = ${user.email} AND read_at IS NULL`;
    return json({ notifications: rows, unread: unread[0]?.c ?? 0 });
  }

  // ── Mark read ──
  if (req.method === 'PATCH') {
    const all = url.searchParams.get('all') === '1';
    const id  = url.searchParams.get('id');
    if (all) {
      await sql`UPDATE notifications SET read_at = NOW()
                WHERE user_email = ${user.email} AND read_at IS NULL`;
      return json({ ok: true, marked: 'all' });
    }
    if (!id) return err(400, 'id or all=1 required');
    await sql`UPDATE notifications SET read_at = NOW()
              WHERE id = ${id} AND user_email = ${user.email}`;
    return json({ ok: true, marked: id });
  }

  // ── Admin push ──
  if (req.method === 'POST') {
    if (user.role !== 'admin') return err(403, 'Admin only');
    let b;
    try { b = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!b.user_email || !b.title) return err(400, 'user_email + title required');
    const rows = await sql`
      INSERT INTO notifications (user_email, kind, title, body, link_url, icon, dedup_key)
      VALUES (
        ${String(b.user_email).toLowerCase()},
        ${b.kind || 'admin_message'},
        ${b.title},
        ${b.body || null},
        ${b.link_url || null},
        ${b.icon || null},
        ${b.dedup_key || null}
      )
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id`;
    return json({ ok: true, id: rows[0]?.id ?? null });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
