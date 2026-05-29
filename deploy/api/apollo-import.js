// /api/apollo-import — prospect livestock farms via Apollo.io REST API.
// Searches Apollo's mixed_companies / mixed_people endpoints by NAICS + state,
// upserts results into discovered_partners with source='apollo'.
//
// Free plan: 75 credits/month. Each page of ~25 results = 1 credit.
// Strategy: pull a few pages per (state × industry) combo, prioritize high-value states.
//
// Apollo API docs: https://apolloio.github.io/apollo-api-docs/

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS discovered_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL, name TEXT NOT NULL,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    lat DOUBLE PRECISION, lng DOUBLE PRECISION,
    phone TEXT, email TEXT, website TEXT,
    species TEXT[],
    source TEXT NOT NULL, source_ref TEXT NOT NULL,
    raw_data JSONB,
    invite_status TEXT DEFAULT 'new',
    invited_by UUID, signed_up_user UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, source_ref)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS discovered_partners_state_idx ON discovered_partners(state)`;
  await sql`CREATE INDEX IF NOT EXISTS discovered_partners_kind_idx ON discovered_partners(kind)`;
  await sql`CREATE INDEX IF NOT EXISTS discovered_partners_status_idx ON discovered_partners(invite_status)`;
}

// Apollo's industry tag IDs aren't stable; use industry_keywords instead.
// Each "industry" here is a search profile that maps Apollo company hits → species we care about.
const SEARCH_PROFILES = [
  { id: 'cattle',   keywords: ['cattle ranch', 'beef producer', 'grass-fed beef', 'cow-calf'],     species: ['beef'] },
  { id: 'pork',     keywords: ['hog farm', 'pork producer', 'pasture-raised pork', 'pig farm'],    species: ['pork'] },
  { id: 'lamb',     keywords: ['sheep farm', 'lamb producer', 'sheep ranch'],                      species: ['lamb'] },
  { id: 'goat',     keywords: ['goat farm', 'goat dairy', 'meat goat'],                            species: ['goat'] },
  { id: 'bison',    keywords: ['bison ranch', 'buffalo ranch', 'bison farm'],                      species: ['bison'] },
  { id: 'venison',  keywords: ['elk ranch', 'deer farm', 'venison producer'],                      species: ['venison'] },
  { id: 'poultry',  keywords: ['poultry farm', 'pasture-raised chicken', 'free-range eggs'],       species: ['poultry', 'eggs'] },
  { id: 'mixed',    keywords: ['regenerative farm', 'pasture-raised', 'whole animal'],             species: ['beef', 'pork'] },
];

const PRIORITY_STATES = [
  // Top livestock states by USDA Cattle on Feed + Hog Inventory + ICP density
  'TX', 'NE', 'KS', 'IA', 'CA', 'OK', 'MN', 'MO', 'WI', 'SD',
  'CO', 'NC', 'OH', 'PA', 'KY', 'MT', 'IL', 'IN', 'GA', 'TN',
];

function parseAddressBlob(org) {
  return {
    address: org.street_address || org.raw_address || null,
    city: org.city || null,
    state: (org.state || '').toUpperCase().slice(0, 2) || null,
    zip: (org.postal_code || '').toString().slice(0, 10) || null,
    lat: typeof org.latitude === 'number' ? org.latitude : null,
    lng: typeof org.longitude === 'number' ? org.longitude : null,
  };
}

function fmtPhone(raw) {
  if (!raw) return null;
  const d = raw.toString().replace(/[^\d]/g, '');
  if (d.length < 10) return raw;
  return `(${d.slice(-10, -7)}) ${d.slice(-7, -4)}-${d.slice(-4)}`;
}

async function apolloSearchOrgs({ apiKey, keywords, state, page = 1, perPage = 25 }) {
  // mixed_companies/search — POST with q_organization_keyword_tags[] and q_organization_locations[]
  const body = {
    page,
    per_page: perPage,
    q_organization_keyword_tags: keywords,
    organization_locations: [`United States`, state],
    // Filter to small/independent farm operations
    organization_num_employees_ranges: ['1,10', '11,20', '21,50'],
  };
  const r = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Apollo HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return err(500, 'APOLLO_API_KEY not configured');

  try { await ensureSchema(); } catch (e) { return err(500, `Schema bootstrap failed: ${e.message}`); }

  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const onlyState = (url.searchParams.get('state') || '').toUpperCase();
  const onlyProfile = (url.searchParams.get('profile') || '').toLowerCase();
  const maxPages = parseInt(url.searchParams.get('pages') || '1', 10);
  const stateOffset = parseInt(url.searchParams.get('state_offset') || '0', 10);
  const stateLimit = parseInt(url.searchParams.get('state_limit') || '5', 10);

  const states = onlyState ? [onlyState] : PRIORITY_STATES.slice(stateOffset, stateOffset + stateLimit);
  const profiles = onlyProfile ? SEARCH_PROFILES.filter(p => p.id === onlyProfile) : SEARCH_PROFILES.slice(0, 3);

  let inserted = 0, updated = 0, skipped = 0, creditsUsed = 0;
  const errors = [];
  const byState = {};
  const sample = [];

  async function upsertOrg(org, profile) {
    try {
      const sourceRef = `APOLLO|${org.id || `${org.name}|${org.state || ''}`}`.slice(0, 200);
      const addr = parseAddressBlob(org);
      const result = await sql`
        INSERT INTO discovered_partners (
          kind, name, address, city, state, zip, lat, lng,
          phone, email, website, species,
          source, source_ref, raw_data, invite_status
        ) VALUES (
          'farm',
          ${org.name},
          ${addr.address},
          ${addr.city},
          ${addr.state},
          ${addr.zip},
          ${addr.lat},
          ${addr.lng},
          ${fmtPhone(org.phone || org.primary_phone?.number)},
          ${org.email || null},
          ${org.website_url || null},
          ${profile.species},
          'apollo',
          ${sourceRef},
          ${JSON.stringify({ apollo_id: org.id, profile: profile.id, employees: org.estimated_num_employees, industry: org.industry, raw_keywords: org.keywords })},
          'new'
        )
        ON CONFLICT (source, source_ref) DO UPDATE SET
          name = EXCLUDED.name,
          address = COALESCE(EXCLUDED.address, discovered_partners.address),
          city = COALESCE(EXCLUDED.city, discovered_partners.city),
          state = COALESCE(EXCLUDED.state, discovered_partners.state),
          zip = COALESCE(EXCLUDED.zip, discovered_partners.zip),
          phone = COALESCE(EXCLUDED.phone, discovered_partners.phone),
          website = COALESCE(EXCLUDED.website, discovered_partners.website),
          species = (
            SELECT ARRAY(SELECT DISTINCT unnest(discovered_partners.species || EXCLUDED.species))
          ),
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`;
      if (result[0]?.inserted) inserted++; else updated++;
      const stateCode = addr.state || '??';
      byState[stateCode] = (byState[stateCode] || 0) + 1;
    } catch (e) {
      skipped++;
      if (errors.length < 30) errors.push(`${org.name}: ${e.message}`);
    }
  }

  for (const state of states) {
    for (const profile of profiles) {
      for (let page = 1; page <= maxPages; page++) {
        let resp;
        try {
          resp = await apolloSearchOrgs({ apiKey, keywords: profile.keywords, state, page });
        } catch (e) {
          errors.push(`${state}/${profile.id} page ${page}: ${e.message}`);
          continue;
        }
        creditsUsed++;
        const orgs = resp.organizations || resp.accounts || [];
        if (sample.length < 5 && orgs.length > 0) {
          sample.push({ state, profile: profile.id, first: orgs[0].name, count: orgs.length });
        }
        if (orgs.length === 0) break; // no more results for this state/profile
        for (const org of orgs) {
          await upsertOrg(org, profile);
        }
        if (orgs.length < 25) break; // last page
      }
    }
  }

  return json({
    states_processed: states,
    profiles_processed: profiles.map(p => p.id),
    state_offset: stateOffset,
    next_state_offset: stateOffset + states.length,
    has_more_states: !onlyState && (stateOffset + states.length) < PRIORITY_STATES.length,
    credits_used_this_call: creditsUsed,
    inserted,
    updated,
    skipped,
    by_state: byState,
    errors,
    sample,
  });
}
