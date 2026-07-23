// /api/cron-geocode — scheduled geocoding sweep (Vercel Cron).
//
// Runs one polite, time-budgeted Nominatim batch (~35s, ~20-40 rows) against
// processors missing lat/lng; once processors are fully mapped, sweeps farms
// instead. Keeps the hotspot map's capacity layer complete as new registry
// imports, claims, and signups arrive — no admin clicks needed. When there is
// nothing left to geocode it returns in milliseconds, so the daily run is
// effectively free once the backlog clears.
//
// Auth: only Vercel Cron invocations carry the `x-vercel-cron` header — the
// platform strips inbound x-vercel-* headers from external requests, so no
// secret needs to live in the repo. The admin UI path for manual batches is
// /api/admin-county-stats?action=geocode-processors (session-authed).
//
// vercel.json: { "path": "/api/cron-geocode", "schedule": "30 14 * * *" }

import { err, json, nodejsHandler } from './_lib/db.js';
import { backfillEntity } from './_lib/geocode.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

async function handler(req) {
  const isCron = req.headers?.get ? req.headers.get('x-vercel-cron') : null;
  if (!isCron) return err(401, 'Cron only');

  const processors = await backfillEntity('processors');
  let farms = null;
  if (!processors.scanned) {
    farms = await backfillEntity('farms');
  }
  return json({ ok: true, processors, farms });
}

export default nodejsHandler(handler);
