/**
 * Adapters: Neon / Vercel API rows → mobile `Processor` shape.
 *
 * Neon uses UUID ids; bundled/Supabase directory rows use `mamp-*` style ids.
 * Prefer slug for navigation and never mix ID namespaces across writes.
 */

import type {
  Processor,
  ClaimStatus,
  Service,
} from '@protein-outfitters/shared';

/** Slim row from GET /api/map-data → processors[] */
export interface MapDataProcessorRow {
  id: string;
  slug: string;
  name: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat: number;
  lng: number;
  inspection?: string | null;
  species?: string[] | null;
  claimable?: boolean;
}

/** Full row from GET /api/processors?slug= → { processor } */
export interface NeonProcessorRow {
  id: string;
  slug: string;
  name: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  lat?: number | null;
  lng?: number | null;
  inspection?: string | null;
  capabilities?: unknown;
  owner_id?: string | null;
  cover_url?: string | null;
}

/** Live map pin — Product YES: keep visible; label, do not hide. */
export const CUSTOM_EXEMPT_SLUG = 'stittsworth-smokehouse-co';

export const CUSTOM_EXEMPT_LABEL =
  'Custom-exempt / not claimable / already claimed / not sellable';

/** Live map uses `custom-exempt`. */
export function isCustomExemptInspection(
  inspection?: string | null,
): boolean {
  if (!inspection) return false;
  return inspection.trim().toLowerCase().replace(/_/g, '-') === 'custom-exempt';
}

export function isCustomExemptListing(proc: {
  slug?: string | null;
  inspection_status?: string | null;
}): boolean {
  if (proc.slug === CUSTOM_EXEMPT_SLUG) return true;
  return isCustomExemptInspection(proc.inspection_status);
}

function claimFrom(_claimable?: boolean, ownerId?: string | null): ClaimStatus {
  // Owner means claimed for filters. Custom-exempt stays on the map either
  // way — label via CUSTOM_EXEMPT_LABEL, do not drop the pin.
  if (ownerId) return 'claimed';
  return 'unclaimed';
}

function servicesFrom(species?: string[] | null, capabilities?: unknown): Service[] {
  const out: string[] = [];
  if (Array.isArray(species)) out.push(...species);

  // capabilities may be JSONB object, string, or messy array of fragments
  const blobs: unknown[] = Array.isArray(capabilities)
    ? capabilities
    : capabilities
      ? [capabilities]
      : [];
  for (const blob of blobs) {
    let parsed: unknown = blob;
    if (typeof blob === 'string') {
      try {
        parsed = JSON.parse(blob);
      } catch {
        continue;
      }
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.services)) out.push(...obj.services.map(String));
    if (Array.isArray(obj.species)) out.push(...obj.species.map(String));
    const cuts = obj.species_cuts;
    if (cuts && typeof cuts === 'object') {
      out.push(...Object.keys(cuts as object));
    }
  }
  return [...new Set(out)] as Service[];
}

/** Prefix for slugs we synthesize when a Neon row has no slug yet. */
export const SYNTHETIC_SLUG_PREFIX = 'neon-';

export function isSyntheticSlug(slug: string): boolean {
  return slug.startsWith(SYNTHETIC_SLUG_PREFIX);
}

function ensureSlug(row: { id: string; slug?: string | null; name?: string }): string {
  if (row.slug) return row.slug;
  // ~60% of Neon map-data rows currently lack slugs; synthesize a stable
  // key so pins still render. `/api/processors?slug=` will 404 for these,
  // so `loadProcessorBySlug` serves them from the in-memory map-data set
  // instead. Keep the full UUID so this stays reversible once the API
  // supports lookup by id.
  return `${SYNTHETIC_SLUG_PREFIX}${String(row.id)}`;
}

export function processorFromMapDataRow(row: MapDataProcessorRow): Processor | null {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!row.name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const city = row.city ?? null;
  const state = row.state ?? null;
  const zip = row.zip ?? null;
  return {
    id: String(row.id),
    slug: ensureSlug(row),
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
    services: servicesFrom(row.species),
    inspection_status: row.inspection ?? null,
    usda_establishment_number: null,
    source: 'neon',
    source_url: null,
    claim_status: claimFrom(row.claimable, undefined),
  };
}

export function processorFromNeonRow(row: NeonProcessorRow): Processor | null {
  if (!row.slug || !row.name) return null;
  const lat = row.lat == null ? NaN : Number(row.lat);
  const lng = row.lng == null ? NaN : Number(row.lng);
  const city = row.city ?? null;
  const state = row.state ?? null;
  const zip = row.zip ?? null;
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    role: 'processor',
    contact_name: null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    address: {
      street: row.address ?? null,
      city,
      state,
      zip,
      full:
        row.address ||
        [city, state, zip].filter(Boolean).join(', ') ||
        null,
    },
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
    geocode_source: 'unknown',
    services: servicesFrom(undefined, row.capabilities),
    inspection_status: row.inspection ?? null,
    usda_establishment_number: null,
    source: 'neon',
    source_url: null,
    claim_status: claimFrom(undefined, row.owner_id ?? null),
    cover_photo_url: row.cover_url ?? null,
  };
}
