// /api/eatwild-import — scrape EatWild's state-by-state pasture-based farm directory
// and stage records in discovered_partners (source='eatwild').
//
// EatWild lists ~1,400+ pasture-raised farms, organized by state.
// URL pattern: https://www.eatwild.com/products/<state>.html  (e.g. minnesota.html)
//
// Pass ?state=minnesota for one state, no param for all 50.
// Returns per-state inserted/updated counts.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

// 50 US state slugs as used in EatWild URLs
const STATES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','districtofcolumbia','florida','georgia','hawaii','idaho','illinois',
  'indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
  'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada',
  'newhampshire','newjersey','newmexico','newyork','nocarolina','nodakota','ohio',
  'oklahoma','oregon','pennsylvania','rhodeisland','socarolina','sodakota','tennessee',
  'texas','utah','vermont','virginia','washington','westvirginia','wisconsin','wyoming',
];

const STATE_TO_CODE = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA',
  colorado:'CO', connecticut:'CT', delaware:'DE', districtofcolumbia:'DC',
  florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID', illinois:'IL',
  indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA',
  maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN',
  mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV',
  newhampshire:'NH', newjersey:'NJ', newmexico:'NM', newyork:'NY',
  nocarolina:'NC', nodakota:'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
  pennsylvania:'PA', rhodeisland:'RI', socarolina:'SC', sodakota:'SD',
  tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA',
  washington:'WA', westvirginia:'WV', wisconsin:'WI', wyoming:'WY',
};

const TARGET_SPECIES = [
  { match: /\bbeef\b|\bcattle\b/i, key: 'beef' },
  { match: /\bpork\b|\bhog\b|\bswine\b|\bpig\b/i, key: 'pork' },
  { match: /\blamb\b|\bsheep\b|\bmutton\b/i, key: 'lamb' },
  { match: /\bgoat\b|\bchevon\b/i, key: 'goat' },
  { match: /\bbison\b|\bbuffalo\b/i, key: 'bison' },
  { match: /\bvenison\b|\bdeer\b|\belk\b|\byak\b/i, key: 'venison' },
  { match: /\brabbit\b/i, key: 'rabbit' },
  { match: /\bpoultry\b|\bchicken\b|\bturkey\b|\bduck\b|\bgoose\b/i, key: 'poultry' },
  { match: /\beggs?\b/i, key: 'eggs' },
  { match: /\bdairy\b|\bmilk\b|\bcheese\b/i, key: 'dairy' },
];

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

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, '"').replace(/&#8221;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function parseStatePage(html, stateSlug) {
  const stateCode = STATE_TO_CODE[stateSlug] || '';
  // Each farm is a block separated by <hr> tags. We grab everything between hr tags.
  const sections = html.split(/<hr\b[^>]*>/i);
  const farms = [];

  for (const section of sections) {
    // First bold name in the section
    const nameMatch = section.match(/<(?:b|strong)[^>]*>\s*([^<]+?)\s*<\/(?:b|strong)>/i);
    if (!nameMatch) continue;
    const rawName = nameMatch[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    if (rawName.length < 3 || rawName.length > 120) continue;
    // Skip headers / non-farm bold text
    if (/^(top|directory|website|email|phone|share|click here|new|home|farm|see|read|note|warning|important)$/i.test(rawName)) continue;

    // Address: look for <a href="..." title="Google map">..</a> or any maps link with address-like text
    let address = null, lat = null, lng = null;
    const addrMatch = section.match(/<a[^>]*(?:title="Google map"|maps\.app\.goo\.gl|maps\.google\.com)[^>]*>\s*([^<]+?)\s*<\/a>/i);
    if (addrMatch) address = addrMatch[1].replace(/&nbsp;/g, ' ').trim();

    // Phone: (xxx) xxx-xxxx or xxx-xxx-xxxx variants
    let phone = null;
    const phoneMatch = section.match(/(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]\d{4}/);
    if (phoneMatch) phone = phoneMatch[0].trim();

    // Email
    let email = null;
    const emailMatch = section.match(/mailto:([^"'?>\s]+)/i);
    if (emailMatch) email = emailMatch[1].trim().toLowerCase();

    // Website (skip eatwild internal + maps + email links)
    let website = null;
    const sites = [...section.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/gi)];
    for (const m of sites) {
      const u = m[1];
      if (/eatwild\.com|maps\.app\.goo\.gl|maps\.google|google\.com\/maps|addthis|facebook\.com|youtube|instagram|tiktok|twitter\.com|x\.com|hotmail|gmail|yahoo|aol|outlook/i.test(u)) continue;
      website = u;
      break;
    }

    // Description text (for species detection)
    const text = stripTags(section);
    const matched = [];
    for (const { match, key } of TARGET_SPECIES) {
      if (match.test(text) && !matched.includes(key)) matched.push(key);
    }
    if (matched.length === 0) continue; // skip if we can't tell what they raise

    // ZIP from address tail
    let zip = null, city = null;
    if (address) {
      const zipM = address.match(/\b(\d{5}(?:-\d{4})?)\b/);
      if (zipM) zip = zipM[1];
      // City is the chunk before the state code
      const cityM = address.match(/,\s*([^,]+?),?\s+[A-Z]{2}\s+\d{5}/);
      if (cityM) city = cityM[1].trim();
    }

    farms.push({
      name: rawName,
      address, city, state: stateCode, zip, lat, lng,
      phone: phone ? phone.replace(/[^\d]/g, '').slice(0, 11) : null,
      email, website,
      species: matched,
      raw_text: text.slice(0, 800),
    });
  }

  // Dedupe by name+state (in case of repeated bold tags)
  const seen = new Set();
  return farms.filter(f => {
    const k = `${f.name.toLowerCase()}|${f.state}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchState(stateSlug) {
  const url = `https://www.eatwild.com/products/${stateSlug}.html`;
  const r = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ProteinOutfittersBot/1.0; +https://www.proteinoutfitters.com)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${stateSlug}`);
  return r.text();
}

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  try { await ensureSchema(); } catch (e) { return err(500, `Schema bootstrap failed: ${e.message}`); }

  const url = new URL(req.url);
  const onlyState = (url.searchParams.get('state') || '').toLowerCase();
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = parseInt(url.searchParams.get('limit') || '5', 10); // states per call

  let statesToFetch = onlyState ? [onlyState] : STATES.slice(offset, offset + limit);

  const phoneFmt = (raw) => {
    if (!raw) return null;
    const d = raw.replace(/[^\d]/g, '');
    if (d.length < 10) return raw;
    return `(${d.slice(-10, -7)}) ${d.slice(-7, -4)}-${d.slice(-4)}`;
  };

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  const byState = {};
  const sample = [];

  for (const stateSlug of statesToFetch) {
    let html = '';
    try {
      html = await fetchState(stateSlug);
    } catch (e) {
      errors.push(`${stateSlug}: ${e.message}`);
      continue;
    }
    const farms = parseStatePage(html, stateSlug);
    byState[STATE_TO_CODE[stateSlug] || stateSlug] = farms.length;
    if (sample.length < 3 && farms.length) sample.push({ state: stateSlug, count: farms.length, first: farms[0].name });

    // Parallel inserts in chunks of 25
    async function upsertOne(f) {
      try {
        const sourceRef = `EATWILD|${(STATE_TO_CODE[stateSlug] || stateSlug)}|${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 200);
        const r = await sql`
          INSERT INTO discovered_partners (
            kind, name, address, city, state, zip, lat, lng, phone, email, website, species,
            source, source_ref, raw_data, invite_status
          ) VALUES (
            'farm',
            ${f.name},
            ${f.address || null},
            ${f.city || null},
            ${f.state || null},
            ${f.zip || null},
            ${f.lat || null},
            ${f.lng || null},
            ${phoneFmt(f.phone)},
            ${f.email || null},
            ${f.website || null},
            ${f.species},
            'eatwild',
            ${sourceRef},
            ${JSON.stringify({ state_slug: stateSlug, blurb: f.raw_text })},
            'new'
          )
          ON CONFLICT (source, source_ref) DO UPDATE SET
            name = EXCLUDED.name,
            address = COALESCE(EXCLUDED.address, discovered_partners.address),
            city = COALESCE(EXCLUDED.city, discovered_partners.city),
            state = COALESCE(EXCLUDED.state, discovered_partners.state),
            zip = COALESCE(EXCLUDED.zip, discovered_partners.zip),
            phone = COALESCE(EXCLUDED.phone, discovered_partners.phone),
            email = COALESCE(EXCLUDED.email, discovered_partners.email),
            website = COALESCE(EXCLUDED.website, discovered_partners.website),
            species = EXCLUDED.species,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted`;
        if (r[0]?.inserted) inserted++; else updated++;
      } catch (e) {
        skipped++;
        if (errors.length < 30) errors.push(`${f.name}: ${e.message}`);
      }
    }

    const CHUNK = 25;
    for (let i = 0; i < farms.length; i += CHUNK) {
      await Promise.all(farms.slice(i, i + CHUNK).map(upsertOne));
    }
  }

  return json({
    states_processed: statesToFetch,
    offset, next_offset: offset + statesToFetch.length,
    has_more: !onlyState && (offset + statesToFetch.length) < STATES.length,
    by_state: byState,
    inserted, updated, skipped,
    errors,
    sample,
  });
}
