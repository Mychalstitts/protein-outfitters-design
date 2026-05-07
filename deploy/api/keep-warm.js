// /api/keep-warm — lightweight ping that prevents Neon from auto-suspending.
//
// Neon's serverless Postgres goes to sleep after ~5 min of inactivity. The
// first request after wake-up takes 2–10 seconds, which can cascade into 504s
// when multiple endpoints fire on cold-start. A scheduled ping every 5 min
// keeps the connection warm so real users never hit cold-start latency.
//
// Vercel cron schedule (in vercel.json): every 5 minutes
//   { "path": "/api/keep-warm", "schedule": "*/5 * * * *" }

import { sql, json, err } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Reject non-cron callers — Vercel cron sends Authorization: Bearer ${CRON_SECRET}
  const auth = req.headers.get('authorization') || '';
  const fromCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!fromCron) return err(401, 'cron-only');

  try {
    const start = Date.now();
    // SELECT 1 is the cheapest way to keep the pool warm
    const rows = await sql`SELECT 1 AS ok`;
    const ms = Date.now() - start;
    return json({ ok: true, ms, rows: rows.length });
  } catch (e) {
    return err(500, 'keep-warm failed: ' + (e.message || '').slice(0, 120));
  }
}
