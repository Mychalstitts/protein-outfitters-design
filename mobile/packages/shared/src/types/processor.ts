/**
 * Processor types — mirror the shape of the existing data/processors.json
 * so we can ingest the 509-record seed without transformation.
 *
 * Any field that's nullable in the source stays nullable here. We don't
 * "fix" data shape on the type layer; we fix it during seeding.
 */

export type Role = 'processor' | 'supplier';

export type ClaimStatus = 'unclaimed' | 'pending' | 'claimed';

export type GeocodeSource =
  | 'street'
  | 'zip-centroid'
  | 'census-approx'
  | 'manual'
  | 'unknown';

export type Source = 'MAMP' | 'IMPPA' | 'WAMP' | 'PAMP' | 'IMPA' | string;

export type Service =
  | 'Retail'
  | 'Wholesale'
  | 'Custom Cuts'
  | 'Smoking'
  | 'Sausage'
  | 'Game Processing'
  | 'Slaughter'
  | 'USDA Inspected'
  | 'State Inspected'
  | string;

export interface Address {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Pre-formatted full address from the source data */
  full: string | null;
}

export interface Processor {
  /** Stable ID like "mamp-564" — keyed by source + source-specific id */
  id: string;
  /** URL slug like "2nd-ave-sausage-company" */
  slug: string;
  name: string;
  role: Role;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: Address;
  lat: number;
  lng: number;
  geocode_source: GeocodeSource;
  services: Service[];
  inspection_status: string | null;
  usda_establishment_number: string | null;
  source: Source;
  source_url: string | null;
  claim_status: ClaimStatus;
  /** Cover photo URL, or null → frontend uses procedural cover art */
  cover_photo_url?: string | null;
  /** Additional photo URLs */
  gallery_urls?: string[];
}

/** A processor as returned from the database — adds server-managed fields */
export interface DbProcessor extends Processor {
  created_at: string;
  updated_at: string;
  /** PostGIS geography(Point) — only present when explicitly selected */
  location?: unknown;
}
