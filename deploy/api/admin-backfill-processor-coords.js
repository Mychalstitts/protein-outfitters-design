// /api/admin-backfill-processor-coords — copy lat/lng from discovered_partners
// to processors via single UPDATE…FROM…WHERE join. Avoids N+1 query timeout.
//
// POST. Admin only.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  // Make sure the columns exist
  try {
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`;
  } catch (e) { /* best-effort */ }

  // Single UPDATE: for every processor missing coords, find a discovered_partner
  // with the same name + state that HAS coords, and copy them over.
  const r = await sql`
    UPDATE processors p
    SET lat = dp.lat, lng = dp.lng, updated_at = NOW()
    FROM discovered_partners dp
    WHERE p.owner_id IS NULL
      AND (p.lat IS NULL OR p.lng IS NULL)
      AND dp.lat IS NOT NULL
      AND dp.lng IS NOT NULL
      AND LOWER(p.name) = LOWER(dp.name)
      AND p.state = dp.state
    RETURNING p.slug, p.state`;

  // Count current geocoded coverage
  const counts = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(lat)::int AS with_coords,
      COUNT(*) FILTER (WHERE lat IS NULL)::int AS without_coords
    FROM processors`;

  return json({
    rows_updated: r.length,
    sample: r.slice(0, 8),
    coverage: counts[0],
  });
}
