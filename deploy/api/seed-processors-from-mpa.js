// /api/seed-processors-from-mpa — promote state-MPA discovered_partners records
// (custom-cut shops with services like "Custom", "Retail", "Deer", etc.) into
// the public processors table so they show up on /discover, /map, reservation flow.
//
// Recognizes our MPA source tags: mamp, wamp, impa, imppa, pamp, aamp, oamp, kamp,
// nempa, ilmpa, mima, ndmpa, sdamp, mompa, vamp, meamp, mmpa, cosmp, ccma, ncamp.
//
// POST ?states=ALL&limit=2000  (or ?states=MN,WI,...)
// Admin only.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const MPA_SOURCES = [
  'mamp','wamp','impa','imppa','pamp','aamp','oamp','kamp','nempa','ilmpa',
  'mima','ndmpa','sdamp','mompa','vamp','meamp','mmpa','cosmp','ccma','ncamp',
];

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
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  const url = new URL(req.url);
  const statesParam = url.searchParams.get('states') || 'ALL';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '2000', 10), 10000);
  const states = statesParam.toUpperCase() === 'ALL'
    ? null
    : statesParam.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);

  // Make sure contact + geocoding columns exist on processors
  try {
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS phone TEXT`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS email TEXT`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS website TEXT`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS address TEXT`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`;
    await sql`ALTER TABLE processors ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`;
  } catch (e) { /* best-effort */ }

  const rows = states
    ? await sql`
        SELECT id, name, address, city, state, zip, lat, lng, phone, email, website, raw_data, species, source
        FROM discovered_partners
        WHERE source = ANY(${MPA_SOURCES})
          AND kind = 'processor'
          AND state = ANY(${states})
          AND invite_status NOT IN ('dnc','declined')
        ORDER BY state, name
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, name, address, city, state, zip, lat, lng, phone, email, website, raw_data, species, source
        FROM discovered_partners
        WHERE source = ANY(${MPA_SOURCES})
          AND kind = 'processor'
          AND invite_status NOT IN ('dnc','declined')
        ORDER BY state, name
        LIMIT ${limit}
      `;

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  const byState = {};
  const bySource = {};
  const sample = [];

  for (const r of rows) {
    try {
      const baseSlug = slugify(`${r.name}-${r.city || r.state}`);
      if (!baseSlug) { skipped++; continue; }
      // Match on (name, state) first — if an existing imported record has the same name+state,
      // re-use its slug (so subsequent re-runs UPDATE instead of duplicating).
      let finalSlug = null;
      const existingByName = await sql`
        SELECT slug FROM processors
        WHERE LOWER(name) = LOWER(${r.name})
          AND state = ${r.state}
          AND owner_id IS NULL
        LIMIT 1`;
      if (existingByName[0]) {
        finalSlug = existingByName[0].slug;
      } else {
        // No existing match — find a unique slug. Collisions are rare but real (different
        // shops with the same name in the same city).
        finalSlug = baseSlug;
        let n = 0;
        while (true) {
          const exists = await sql`SELECT 1 FROM processors WHERE slug = ${finalSlug} LIMIT 1`;
          if (!exists[0]) break;
          n++;
          finalSlug = `${baseSlug}-${n}`;
          if (n > 30) { finalSlug = null; break; }
        }
      }
      if (!finalSlug) { skipped++; continue; }

      // Map raw inspection_status → CHECK-allowed value on processors table
      // Allowed values per current schema: 'usda','state','custom-exempt','equal-to'
      const rd = r.raw_data || {};
      const insRaw = (rd.inspection_status || '').toString().toLowerCase();
      let inspection = 'state'; // sensible default for MPA member without flag
      if (/usda|federal/.test(insRaw)) inspection = 'usda';
      else if (/equal.*to/.test(insRaw)) inspection = 'equal-to';
      else if (/custom.*exempt|^custom$/.test(insRaw)) inspection = 'custom-exempt';
      else if (/state/.test(insRaw)) inspection = 'state';

      // Capabilities + fees (industry midpoints — owner can override after claim)
      const services = (rd.services || '').toString();
      const capabilities = {
        species: Array.isArray(r.species) ? r.species : [],
        slaughter: /slaughter|harvest|whole.*animal|kill/i.test(services),
        processing: /processing|cut|wrap|retail|custom/i.test(services) || !services,
        smoking: /smok|jerky|sausage|pepperoni/i.test(services),
        deer: /deer|wild|game/i.test(services),
      };
      const base_fees = { kill_fee: 100 };
      const per_lb_fees = { processing: 1.25 };
      const schedule = {};

      const sourceTag = (r.source || '').toUpperCase();
      const bio = `${r.name} is a member of ${sourceTag}. ${capabilities.slaughter ? 'Slaughter & processing.' : 'Processing facility.'} Imported from the ${sourceTag} member directory — claim this profile to add hours, photos, and your real cut sheet.`;

      const result = await sql`
        INSERT INTO processors (
          slug, name, city, state, zip, lat, lng,
          phone, email, website, address, inspection,
          capabilities, base_fees, per_lb_fees, schedule, bio
        ) VALUES (
          ${finalSlug},
          ${r.name},
          ${r.city || null},
          ${r.state || null},
          ${r.zip || null},
          ${r.lat || null},
          ${r.lng || null},
          ${r.phone || null},
          ${r.email || null},
          ${r.website || null},
          ${r.address || null},
          ${inspection},
          ${capabilities},
          ${base_fees},
          ${per_lb_fees},
          ${schedule},
          ${bio}
        )
        ON CONFLICT (slug) DO UPDATE SET
          city = COALESCE(EXCLUDED.city, processors.city),
          state = COALESCE(EXCLUDED.state, processors.state),
          zip = COALESCE(EXCLUDED.zip, processors.zip),
          lat = COALESCE(EXCLUDED.lat, processors.lat),
          lng = COALESCE(EXCLUDED.lng, processors.lng),
          phone = COALESCE(EXCLUDED.phone, processors.phone),
          email = COALESCE(EXCLUDED.email, processors.email),
          website = COALESCE(EXCLUDED.website, processors.website),
          address = COALESCE(EXCLUDED.address, processors.address),
          inspection = EXCLUDED.inspection,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`;

      if (result[0]?.inserted) inserted++; else updated++;
      const st = r.state || '??';
      byState[st] = (byState[st] || 0) + 1;
      bySource[r.source] = (bySource[r.source] || 0) + 1;
      if (sample.length < 5) sample.push({ slug: finalSlug, name: r.name, state: r.state });
    } catch (e) {
      skipped++;
      if (errors.length < 30) errors.push(`${r.name}: ${(e.message || '').slice(0, 100)}`);
    }
  }

  return json({
    candidates_found: rows.length,
    inserted, updated, skipped,
    states_filtered: states || 'ALL',
    by_state: byState,
    by_source: bySource,
    errors,
    sample,
  });
}
