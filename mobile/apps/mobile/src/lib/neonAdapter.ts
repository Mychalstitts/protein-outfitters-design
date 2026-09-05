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

function claimFrom(claimable?: boolean, ownerId?: string | null): ClaimStatus {
  if (ownerId) return 'claimed';
  if (claimable === false) return 'claimed';
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

function ensureSlug(row: { id: string; slug?: string | null; name?: string }): string {
  if (row.slug) return row.slug;
  // ~60% of Neon map-data rows currently lack slugs; synthesize a stable
  // key so pins still render. Detail by this slug will 404 until Neon fills
  // slug — UI should prefer rows that already have one when linking.
  return `neon-${String(row.id).replace(/-/g, '').slice(0, 16)}`;
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
