// /api/seed-farms-from-eatwild — promote EatWild prospects out of discovered_partners
// into the public farms table so they show up on /producers, /discover, /map, /farm/{slug}.
// Idempotent: re-running upserts on (slug). Filters by state so we can stage-load the
// soft-launch region first.
//
// POST ?states=MN,WI,ND,SD,IA,MI,IL,MT,NE&limit=300

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

function slugify(s) {
  return (s || '').toString().toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Default copy used as bio/story when EatWild gives us nothing custom
function defaultBio(name, state, species) {
  const sp = (species && species.length)
    ? species.join(', ')
    : 'pasture-raised meat';
  return `${name} is a pasture-based farm in ${state || 'the Midwest'} producing ${sp}. Imported from the EatWild directory — claim this profile to add your own story, photos, and listings.`;
}

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  const url = new URL(req.url);
  const states = (url.searchParams.get('states') || 'MN,WI,ND,SD,IA,MI,IL,MT,NE')
    .toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '300', 10), 1000);

  // Best-effort: if /api/migrate hasn't added the contact columns yet on farms,
  // make sure the columns exist so the upsert below doesn't blow up.
  try {
    await sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS phone TEXT`;
    await sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS email TEXT`;
    await sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS website TEXT`;
    await sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS address TEXT`;
    await sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`;
    await sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`;
  } catch (e) { /* best-effort */ }

  // Pull EatWild candidates from the recruiting funnel
  const rows = await sql`
    SELECT id, name, address, city, state, zip, lat, lng, phone, email, website, species, raw_data
    FROM discovered_partners
    WHERE source = 'eatwild'
      AND kind = 'farm'
      AND state = ANY(${states})
      AND invite_status NOT IN ('dnc', 'declined')
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
      // Find a unique slug (collisions are rare but real)
      let finalSlug = baseSlug, n = 0;
      while (true) {
        const exists = await sql`SELECT 1 FROM farms WHERE slug = ${finalSlug} LIMIT 1`;
        if (!exists[0]) break;
        n++;
        finalSlug = `${baseSlug}-${n}`;
        if (n > 30) { finalSlug = null; break; }
      }
      if (!finalSlug) { skipped++; continue; }

      // Map EatWild species → our practices/identity defaults
      const species = Array.isArray(r.species) ? r.species : [];
      const practices = ['pasture-raised']; // EatWild is by definition pasture-based
      // Heuristic: if name contains "family" or "ranch", flag as family
      const identity = /family|ranch/i.test(r.name) ? ['family'] : [];
      const certs = []; // EatWild doesn't carry cert data

      const result = await sql`
        INSERT INTO farms (
          slug, name, city, state, zip,
          phone, email, website, address,
          lat, lng,
          practices, certs, identity,
          bio
        ) VALUES (
          ${finalSlug},
          ${r.name},
          ${r.city || null},
          ${r.state || null},
          ${r.zip || null},
          ${r.phone || null},
          ${r.email || null},
          ${r.website || null},
          ${r.address || null},
          ${r.lat || null},
          ${r.lng || null},
          ${practices},
          ${certs},
          ${identity},
          ${defaultBio(r.name, r.state, species)}
        )
        ON CONFLICT (slug) DO UPDATE SET
          city = COALESCE(EXCLUDED.city, farms.city),
          state = COALESCE(EXCLUDED.state, farms.state),
          zip = COALESCE(EXCLUDED.zip, farms.zip),
          phone = COALESCE(EXCLUDED.phone, farms.phone),
          email = COALESCE(EXCLUDED.email, farms.email),
          website = COALESCE(EXCLUDED.website, farms.website),
          address = COALESCE(EXCLUDED.address, farms.address),
          lat = COALESCE(EXCLUDED.lat, farms.lat),
          lng = COALESCE(EXCLUDED.lng, farms.lng),
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`;

      if (result[0]?.inserted) inserted++; else updated++;
      const st = r.state || '??';
      byState[st] = (byState[st] || 0) + 1;
      if (sample.length < 5) sample.push({ slug: finalSlug, name: r.name, state: r.state });
    } catch (e) {
      skipped++;
      if (errors.length < 30) errors.push(`${r.name}: ${(e.message || '').slice(0, 100)}`);
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
