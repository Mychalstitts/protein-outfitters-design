/**
 * Buyer / Farmer discovery helpers — filtering and ranking that
 * power the Find-Suppliers and Find-Processors map sidebars.
 *
 * Pure functions, no platform deps. Web and mobile both consume this.
 */

import { distance, type LatLng } from './geo';
import type { Processor as DbProcessor, Service } from '../types/processor';

export type ProteinType = 'beef' | 'pork' | 'poultry' | 'lamb' | 'bison' | 'goat';

/** A supplier (farm) — a row from `processors` where role='supplier' */
export interface SupplierEnriched extends DbProcessor {
  /** Derived: weekly capacity in lbs (mock until DB column exists) */
  capacity: number;
  /** Derived: primary protein type */
  proteinType: ProteinType;
  /** Derived: certifications list (mock until DB column exists) */
  certifications: string[];
  /** Derived: availability label (mock until DB column exists) */
  availability: string;
  /** Derived: herd / flock size (mock) */
  herdSize: number;

  // Rich marketplace fields (ported from the working frontend/ producers experience)
  nextAvailability?: string;
  animalsAvailable?: number;
  availabilityCalendar?: string[];
}

/** A processor — a row from `processors` where role='processor' */
export interface ProcessorEnriched extends DbProcessor {
  capacity: number;
  throughput: number;
  /** "small" | "medium" | "large" derived from capacity */
  plantSize: 'small' | 'medium' | 'large';
  /** Headroom = capacity - throughput */
  headroom: number;
}

// ---------------------------------------------------------------------------
// Buyer filtering
// ---------------------------------------------------------------------------

export interface BuyerFilters {
  proteins: Set<ProteinType>;
  certifications: Set<string>;
  /** Max distance from origin in miles */
  maxDistanceMiles: number;
  origin: LatLng;
}

export const ALL_PROTEINS: ProteinType[] = [
  'beef',
  'pork',
  'poultry',
  'lamb',
  'bison',
  'goat',
];

export const ALL_CERTIFICATIONS = [
  'USDA Organic',
  'Grass-Fed',
  'Heritage',
  'Pastured',
  'Cage-Free',
  'Free-Range',
  'Non-GMO',
  'Animal Welfare Approved',
  'Regenerative',
  '100% Native',
] as const;

export function filterSuppliers(
  suppliers: SupplierEnriched[],
  filters: BuyerFilters,
): SupplierEnriched[] {
  return suppliers.filter(s => {
    if (!filters.proteins.has(s.proteinType)) return false;
    if (filters.certifications.size > 0) {
      const hasMatch = s.certifications.some(c => filters.certifications.has(c));
      if (!hasMatch) return false;
    }
    if (distance(filters.origin, s) > filters.maxDistanceMiles) return false;
    return true;
  });
}

export function rankSuppliersByDistance<T extends LatLng>(
  suppliers: T[],
  origin: LatLng,
): T[] {
  return [...suppliers].sort((a, b) => distance(origin, a) - distance(origin, b));
}

// ---------------------------------------------------------------------------
// Farmer ranking — "Find me a processor that has room and is close"
// ---------------------------------------------------------------------------

export interface FarmerRankInput {
  origin: LatLng;
  /** Service the farmer needs, e.g. "Slaughter" or "Custom Cuts". 'any' matches all. */
  service: Service | 'any';
}

export interface RankedProcessor extends ProcessorEnriched {
  /** Miles from farmer's location */
  distance: number;
  /** Whether plant offers the requested service */
  servicesMatch: boolean;
  /** Composite fit score — higher is better */
  fitScore: number;
}

export function rankProcessorsForFarmer(
  processors: ProcessorEnriched[],
  input: FarmerRankInput,
): RankedProcessor[] {
  return processors
    .map(p => {
      const d = distance(input.origin, p);
      const servicesMatch =
        input.service === 'any' || p.services.includes(input.service);
      // headroom ÷ distance, with non-matching services discounted to 30%
      const fitScore =
        (servicesMatch ? 1 : 0.3) * (p.headroom / Math.max(d, 1));
      return { ...p, distance: d, servicesMatch, fitScore };
    })
    .filter(p => p.headroom > 0)
    .sort((a, b) => b.fitScore - a.fitScore);
}

// ---------------------------------------------------------------------------
// Enrichment — fills in mock fields that don't exist in the DB yet
// Deterministic so the same processor always renders the same numbers.
// Replace with real DB columns when they ship.
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function rngFromId(id: string): () => number {
  let seed = hashStr(id);
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

const PROTEIN_BY_HASH: ProteinType[] = [
  'beef',
  'beef',
  'beef',
  'pork',
  'pork',
  'poultry',
  'poultry',
  'lamb',
  'bison',
  'goat',
];

const AVAILABILITY_OPTIONS = [
  'Year-round',
  'Apr–Nov',
  'Mar–Oct',
  'May–Sep',
] as const;

export function enrichSupplier(s: DbProcessor): SupplierEnriched {
  const r = rngFromId(s.id);

  // Rich overrides for known good suppliers (from the production `frontend/` demo data)
  const richOverrides: Record<string, Partial<SupplierEnriched>> = {
    northfield: {
      nextAvailability: 'Feb 10–14, 2026',
      animalsAvailable: 3,
      availabilityCalendar: ['Feb 10', 'Feb 11', 'Feb 12', 'Feb 13', 'Feb 14'],
      proteinType: 'beef',
      availability: 'Feb–Apr',
      herdSize: 180,
      capacity: 8500,
    },
    twinpines: {
      nextAvailability: 'Mar 5–10, 2026',
      animalsAvailable: 2,
      availabilityCalendar: ['Mar 5', 'Mar 6', 'Mar 7', 'Mar 8', 'Mar 9', 'Mar 10'],
      proteinType: 'bison',
      availability: 'Mar–May',
      herdSize: 95,
      capacity: 6200,
    },
    prairiewind: {
      nextAvailability: 'Feb 20–28, 2026',
      animalsAvailable: 4,
      availabilityCalendar: ['Feb 20', 'Feb 21', 'Feb 25', 'Feb 26', 'Feb 27', 'Feb 28'],
      proteinType: 'lamb',
      availability: 'Feb–Apr',
      herdSize: 420,
      capacity: 4800,
    },
    redriver: {
      nextAvailability: 'Mar 12–20, 2026',
      animalsAvailable: 5,
      availabilityCalendar: ['Mar 12', 'Mar 13', 'Mar 14', 'Mar 18', 'Mar 19', 'Mar 20'],
      proteinType: 'beef',
      availability: 'Mar–May',
      herdSize: 310,
      capacity: 11200,
    },
  };

  const override = richOverrides[s.id] || {};

  const proteinType: ProteinType =
    override.proteinType ??
    (PROTEIN_BY_HASH[hashStr(s.id) % PROTEIN_BY_HASH.length] ?? 'beef');

  const capacity = override.capacity ?? Math.round(2000 + r() * 18000);
  const certCount = Math.floor(r() * 4);
  const certs = [...ALL_CERTIFICATIONS]
    .sort(() => r() - 0.5)
    .slice(0, certCount);
  const availability =
    override.availability ??
    (AVAILABILITY_OPTIONS[Math.floor(r() * AVAILABILITY_OPTIONS.length)] ??
      'Year-round');
  const herdSize = override.herdSize ?? Math.round(80 + r() * 1200);

  return {
    ...s,
    capacity,
    proteinType,
    certifications: [...certs],
    availability,
    herdSize,
    // Rich fields
    nextAvailability: override.nextAvailability,
    animalsAvailable: override.animalsAvailable,
    availabilityCalendar: override.availabilityCalendar,
  };
}

export function enrichProcessor(p: DbProcessor): ProcessorEnriched {
  const r = rngFromId(p.id);
  const capacity = Math.round(4000 + r() * 44000); // 4k–48k lbs/wk
  const utilization = 0.4 + r() * 0.55; // 40%–95%
  const throughput = Math.round(capacity * utilization);
  const plantSize: ProcessorEnriched['plantSize'] =
    capacity > 25000 ? 'large' : capacity > 12000 ? 'medium' : 'small';
  return {
    ...p,
    capacity,
    throughput,
    plantSize,
    headroom: capacity - throughput,
  };
}

/**
 * Split a list of mixed processors+suppliers into enriched typed arrays.
 * The DB returns Processor[] with a role discriminator; this is the
 * type-safe split used by every page.
 */
export function splitByRole(rows: DbProcessor[]): {
  suppliers: SupplierEnriched[];
  processors: ProcessorEnriched[];
} {
  const suppliers: SupplierEnriched[] = [];
  const processors: ProcessorEnriched[] = [];
  for (const row of rows) {
    if (row.role === 'supplier') suppliers.push(enrichSupplier(row));
    else processors.push(enrichProcessor(row));
  }
  return { suppliers, processors };
}
