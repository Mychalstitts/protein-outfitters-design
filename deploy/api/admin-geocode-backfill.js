// /api/admin-geocode-backfill — bulk-geocode farms + processors that
// don't have lat/lng yet. Idempotent: skips rows that already have coords.
//
//   POST /api/admin-geocode-backfill?secret=$MIGRATE_SECRET
//
// Used once after migrate adds the lat/lng columns. After this runs, the
// /api/map-data endpoint serves cached coords instantly with no Nominatim
// calls on the request path.

import { err, json } from './_lib/db.js';
import { backfillEntity } from './_lib/geocode.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!process.env.MIGRATE_SECRET) return err(503, 'MIGRATE_SECRET env var not set');
  if (!secret || secret !== process.env.MIGRATE_SECRET) return err(401, 'Unauthorized');
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const farms = await backfillEntity('farms');
  const processors = await backfillEntity('processors');
  return json({ ok: true, farms, processors });
}
