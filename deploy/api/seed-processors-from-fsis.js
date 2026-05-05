// /api/seed-processors-from-fsis — promote FSIS records out of discovered_partners
// into the processors table so they show up in the reserve flow, /map, /processor lookups.
// Idempotent: re-running upserts on (slug). Filters by states by default to keep the
// public-facing processor list manageable for soft launch.
//
// POST ?states=MN,WI,ND,SD&limit=300

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

function slugify(s) {
  return (s || '').toString().toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  const url = new URL(req.url);
  const states = (url.searchParams.get('states') || 'MN,WI,ND,SD,IA,IL').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '300', 10), 1000);

  // Add contact columns if they don't exist yet (idempotent — safe to run repeatedly).
  try {
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS phone TEXT`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS email TEXT`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS website TEXT`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS address TEXT`;
  } catch (e) { /* ignore — best-effort */ }

  // Pull candidates ordered by state, then name
  const rows = await sql`
    SELECT id, name, address, city, state, zip, phone, email, website, raw_data, species
    FROM discovered_partners
    WHERE source = 'fsis'
      AND kind = 'processor'
      AND state = ANY(${states})
    ORDER BY state, name
    LIMIT ${limit}
  `;

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  const byState = {};
  const sample = [];

  for (const r of rows) {
    try {
      let baseSlug = slugify(`${r.name}-${r.city || r.state}`);
      if (!baseSlug) { skipped++; continue; }
      // Loop to find unique slug
      let finalSlug = baseSlug, n = 0;
      while (true) {
        const exists = await sql`SELECT 1 FROM processors WHERE slug = ${finalSlug} LIMIT 1`;
        if (!exists[0]) break;
        n++;
        finalSlug = `${baseSlug}-${n}`;
        if (n > 30) { finalSlug = null; break; }
      }
      if (!finalSlug) { skipped++; continue; }

      // Build a sensible processors row from FSIS data
      const inspection = r.raw_data?.inspection || 'Federal (USDA)';
      const capabilities = {
        species: Array.isArray(r.species) ? r.species : [],
        slaughter: /slaughter/i.test(r.raw_data?.activities || ''),
        processing: /processing|cut|wrap/i.test(r.raw_data?.activities || ''),
      };
      // Reasonable default fees (industry midpoints) — owners can override after claiming
      const base_fees = { kill_fee: 100 };           // $100 to bring an animal in
      const per_lb_fees = { processing: 1.25 };      // $1.25/lb hanging weight
      const schedule = {};                            // empty until claimed

      const result = await sql`
        INSERT INTO processors (
          slug, name, city, state, zip,
          phone, email, website, inspection,
          capabilities, base_fees, per_lb_fees, schedule, bio
        ) VALUES (
          ${finalSlug},
          ${r.name},
          ${r.city || null},
          ${r.state || null},
          ${r.zip || null},
          ${r.phone || null},
          ${r.email || null},
          ${r.website || null},
          ${inspection},
          ${capabilities},
          ${base_fees},
          ${per_lb_fees},
          ${schedule},
          ${`Federally-inspected ${capabilities.slaughter ? 'slaughter & processing' : 'processing'} facility. Imported from USDA FSIS Meat & Poultry Inspection Directory.`}
        )
        ON CONFLICT (slug) DO UPDATE SET
          city = COALESCE(EXCLUDED.city, processors.city),
          state = COALESCE(EXCLUDED.state, processors.state),
          zip = COALESCE(EXCLUDED.zip, processors.zip),
          phone = COALESCE(EXCLUDED.phone, processors.phone),
          email = COALESCE(EXCLUDED.email, processors.email),
          website = COALESCE(EXCLUDED.website, processors.website),
          inspection = EXCLUDED.inspection,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`;

      if (result[0]?.inserted) inserted++; else updated++;
      const st = r.state || '??';
      byState[st] = (byState[st] || 0) + 1;
      if (sample.length < 5) sample.push({ slug: finalSlug, name: r.name, state: r.state });
    } catch (e) {
      skipped++;
      if (errors.length < 30) errors.push(`${r.name}: ${e.message}`);
    }
  }

  return json({
    candidates_found: rows.length,
    inserted, updated, skipped,
    states_filtered: states,
    by_state: byState,
    errors,
    sample,
  });
}
