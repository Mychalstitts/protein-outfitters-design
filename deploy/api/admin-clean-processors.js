// /api/admin-clean-processors — strip industrial FSIS plants from the public
// processors table. These came in via the original FSIS bulk seed (seed-
// processors-from-fsis) and aren't appropriate for whole-animal custom work.
//
// Heuristics for "this is an industrial plant, not a custom-cut shop":
//   • Name contains a known industrial brand (Tyson, Cargill, JBS, Hormel,
//     Smithfield, Jack Links, Land O'Lakes, Perdue, Pilgrim's, ConAgra, etc.)
//   • Name contains corporate-bloat tokens (Foods Inc, Industries, Manufacturing,
//     International, Worldwide, Global, Corporation)
//   • OR the inspection_status came in as USDA-only AND the name has no
//     small-shop signals (Custom, Locker, Meat Co, Family, Bros)
//
// Idempotent. Returns counts + sample of deleted.
//
// POST. Admin only.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

const BRAND_BLOCK = /\b(tyson|cargill|jbs|hormel|smithfield|jack\s*link|jack\s*links|land\s*o\s*lakes|perdue|pilgrim|conagra|sara\s*lee|kraft|nestle|maple\s*leaf|seaboard|national\s*beef|swift|oscar\s*mayer|butterball|foster\s*farms|bumble\s*bee|del\s*monte|kerry|kettle|kenosha\s*beef|kemps|cliffstar|m\.?g\.?\s*waldbaum|papetti|michael\s*foods|aramark|sysco|us\s*foods|gordon\s*food|reser|hatfield|johnsonville|farmland|premium\s*standard|excel|ibp|monfort|wampler|vlasic|leprino|rich\s*products|advance\s*pierre|nestl[ée]|chick.fil.a)\b/i;

const CORPORATE_BLOAT = /\b(foods?\s+(?:inc|llc|corp|company|international|global|worldwide)|industries\b|manufacturing\b|international\b|worldwide\b|corporation\b|enterprises\b|holdings?\b|group\b)\b/i;

const SMALL_SHOP_KEEP = /\b(custom|locker|meats?|family|farm|bros|brothers|sons|country|valley|prairie|hill|creek|mountain|ranch|butcher|smokehouse|provisions|processors?|packing|abattoir|deer|game|gourmet|heritage|legacy)\b/i;

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  // Pull every imported processor (no owner = imported, can be evaluated).
  const rows = await sql`
    SELECT id, slug, name, state
    FROM processors
    WHERE owner_id IS NULL
    ORDER BY name`;

  const toDelete = [];
  for (const r of rows) {
    const name = (r.name || '').trim();
    if (!name) { toDelete.push(r); continue; }

    // Hard block: known industrial brands
    if (BRAND_BLOCK.test(name)) { toDelete.push(r); continue; }

    // Soft block: corporate-bloat words AND no small-shop signals
    if (CORPORATE_BLOAT.test(name) && !SMALL_SHOP_KEEP.test(name)) {
      toDelete.push(r);
      continue;
    }
  }

  let deleted = 0;
  const errors = [];
  const sample = toDelete.slice(0, 12).map(r => ({ name: r.name, state: r.state }));

  for (const r of toDelete) {
    try {
      // CASCADE: bookings/listings against this processor will delete too.
      // For seed data with no real bookings, this is fine.
      await sql`DELETE FROM processors WHERE id = ${r.id}`;
      deleted++;
    } catch (e) {
      if (errors.length < 10) errors.push(`${r.name}: ${(e.message || '').slice(0, 80)}`);
    }
  }

  const remain = await sql`SELECT COUNT(*)::int AS n FROM processors`;

  return json({
    examined: rows.length,
    deleted,
    remaining_total: remain[0].n,
    sample_deleted: sample,
    errors,
  });
}
