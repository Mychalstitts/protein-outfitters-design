/**
 * Smoke-test Neon → Processor mapping against live /api/map-data.
 * Run from repo: node mobile/apps/mobile/scripts/smoke-map-data.mjs
 */
const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL || 'https://www.proteinoutfitters.com';

function isCustomExempt(inspection, slug) {
  if (slug === 'stittsworth-smokehouse-co') return true;
  if (!inspection) return false;
  return String(inspection).trim().toLowerCase().replace(/_/g, '-') === 'custom-exempt';
}

function claimFrom(claimable, ownerId, inspection, slug) {
  // Custom-exempt is labeled separately — never “already claimed”.
  if (isCustomExempt(inspection, slug)) return 'unclaimed';
  if (ownerId) return 'claimed';
  // map-data: claimable === !owner_id (owner_id is not sent)
  if (claimable === false) return 'claimed';
  return 'unclaimed';
}

function processorFromMapDataRow(row) {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!row.name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const city = row.city ?? null;
  const state = row.state ?? null;
  const zip = row.zip ?? null;
  const slug = row.slug || `neon-${String(row.id)}`; // mirrors neonAdapter.ensureSlug
  return {
    id: String(row.id),
    slug,
    name: row.name,
    role: 'processor',
    contact_name: null,
    phone: null,
    email: null,
    website: null,
    address: {
      street: null,
      city,
      state,
      zip,
      full: [city, state, zip].filter(Boolean).join(', ') || null,
    },
    lat,
    lng,
    geocode_source: 'unknown',
    services: Array.isArray(row.species) ? row.species : [],
    inspection_status: row.inspection ?? null,
    usda_establishment_number: null,
    source: 'neon',
    source_url: null,
    claim_status: claimFrom(row.claimable, undefined, row.inspection, slug),
  };
}

const res = await fetch(`${BASE}/api/map-data`);
if (!res.ok) throw new Error(`map-data ${res.status}`);
const data = await res.json();
const rows = data.processors || [];
const adapted = rows.map(processorFromMapDataRow).filter(Boolean);
const summary = {
  ok: true,
  raw: rows.length,
  adapted: adapted.length,
  sample: adapted[0]?.slug,
  mn: adapted.filter((p) => p.address.state === 'MN').length,
  synthetic_slugs: adapted.filter((p) => p.slug.startsWith('neon-')).length,
};
console.log(JSON.stringify(summary, null, 2));
if (adapted.length < 2000) {
  console.error('Expected >= 2000 adapted processors from map-data');
  process.exit(1);
}
