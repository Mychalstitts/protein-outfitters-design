// /api/admin-dedupe-processors — strip processor rows whose slug ends in -1/-2/etc
// (duplicates created when seed-processors-from-mpa was re-run). Keeps the
// original row (without numeric suffix) for each name. Idempotent.
//
// POST. Admin only.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  // Find every processor with -<digit> at the end of the slug, with no owner.
  // These were created by repeated seed runs.
  const dupes = await sql`
    SELECT id, slug, name, state
    FROM processors
    WHERE owner_id IS NULL
      AND slug ~ '-[0-9]+$'
    ORDER BY name`;

  let deleted = 0;
  const errors = [];
  const sample = dupes.slice(0, 8).map(r => ({ slug: r.slug, name: r.name }));

  for (const r of dupes) {
    try {
      await sql`DELETE FROM processors WHERE id = ${r.id}`;
      deleted++;
    } catch (e) {
      if (errors.length < 10) errors.push(`${r.slug}: ${(e.message || '').slice(0, 80)}`);
    }
  }

  const remain = await sql`SELECT COUNT(*)::int AS n FROM processors`;
  return json({
    examined: dupes.length,
    deleted,
    remaining_total: remain[0].n,
    sample_deleted: sample,
    errors,
  });
}
