// /api/admin-clean-farms — one-shot data hygiene endpoint.
// Removes farms whose `name` was scraped wrong (e.g. EatWild picked up the species
// column instead of the farm name). Heuristics:
//   • Name is fewer than 3 chars, OR
//   • Name is all lowercase (real farm names start with uppercase), OR
//   • Name is just a comma-separated list of meat species, OR
//   • Name has no farm-shaped words (Farm, Ranch, Acres, Pastures, Meats, Co, LLC,
//     Family, Brothers, etc.) AND is short and lowercase
//
// Idempotent. Returns counts + sample of deleted rows.
//
// POST. Admin only.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const SPECIES_TOKENS = /^(poultry|beef|pork|lamb|goat|bison|venison|chicken|turkey|duck|eggs|certified\s+organic|grass[\s-]?fed|pasture[\s-]?raised|all\s+natural)\b/i;
const FARM_SHAPED = /\b(farm|ranch|acres|pastures?|meats?|co\b|llc|inc\b|family|brothers|sister|hill|creek|valley|prairie|stead|orchard|gardens?|fields?|barn|country)/i;

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  // Pull every imported farm (anything WITHOUT an owner is auto-imported and
  // safe to evaluate; manually-claimed farms have an owner_id and we leave alone).
  const rows = await sql`
    SELECT id, slug, name, state
    FROM farms
    WHERE owner_id IS NULL
    ORDER BY name`;

  const toDelete = [];
  for (const r of rows) {
    const name = (r.name || '').trim();
    if (!name) { toDelete.push(r); continue; }
    if (name.length < 3) { toDelete.push(r); continue; }

    // All lowercase → bad scrape
    if (name === name.toLowerCase()) { toDelete.push(r); continue; }

    // First word is a species/category token (e.g. "poultry, eggs")
    if (SPECIES_TOKENS.test(name)) { toDelete.push(r); continue; }

    // Short name without any farm-shaped vocabulary
    if (name.length < 12 && !FARM_SHAPED.test(name)) {
      // One more rescue: if it looks like a proper noun ("Bauer", "Galen") + 1+ extra word,
      // keep it. We only zap real garbage.
      const words = name.split(/\s+/);
      const hasProper = words.some(w => /^[A-Z][a-z]{2,}$/.test(w));
      if (!hasProper) toDelete.push(r);
    }
  }

  let deleted = 0;
  const errors = [];
  const sample = toDelete.slice(0, 8).map(r => ({ slug: r.slug, name: r.name, state: r.state }));

  for (const r of toDelete) {
    try {
      // Cascade-aware: listings have ON DELETE CASCADE on farm_id, so this is safe.
      await sql`DELETE FROM farms WHERE id = ${r.id}`;
      deleted++;
    } catch (e) {
      if (errors.length < 10) errors.push(`${r.name}: ${(e.message || '').slice(0, 80)}`);
    }
  }

  // Return surviving count for confirmation
  const remain = await sql`SELECT COUNT(*)::int AS n FROM farms`;

  return json({
    examined: rows.length,
    deleted,
    remaining_total: remain[0].n,
    sample_deleted: sample,
    errors,
  });
}
