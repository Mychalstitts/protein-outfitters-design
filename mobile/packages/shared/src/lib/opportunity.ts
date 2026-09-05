/**
 * Opportunity scoring — for the Hardware / Admin map view.
 *
 * Identifies regions where deploying processing hardware would have
 * outsized impact. Score blends raw demand density with the
 * demand-to-processing-capacity ratio, so a region with many existing
 * plants but 10× more customers still ranks high.
 *
 * Pure math — no platform deps. Web and mobile both consume this.
 *
 * Production note: when processor count exceeds ~20k, move this
 * aggregation server-side via a Postgres materialized view that
 * snaps to a grid (see processor_demand_cells in your migration plan).
 * The scoring math here stays the same; only the cell aggregation moves.
 */

import { distance, type LatLng } from './geo';

/**
 * Minimal supplier shape for opportunity scoring. Distinct from the DB
 * Processor type to keep this module decoupled from DB schema.
 */
export interface OpportunitySupplier extends LatLng {
  /** Weekly capacity in lbs */
  capacity: number;
}

export interface OpportunityProcessor extends LatLng {
  /** Total weekly capacity in lbs */
  capacity: number;
  /** Current weekly throughput in lbs (utilization = throughput / capacity) */
  throughput: number;
}

export interface DemandPoint extends LatLng {
  /** Weekly demand in lbs */
  demand: number;
}

export interface OpportunityCell {
  /** Cell center */
  lat: number;
  lng: number;
  /** Cell anchor (top-left) and side length in degrees */
  lat0: number;
  lng0: number;
  size: number;
  /** Aggregated values within the cell's range */
  demand: number;
  processCap: number;
  supplierCap: number;
  customers: number;
  processors: number;
  suppliers: number;
  /** Derived */
  gap: number;
  ratio: number;
  density: number;
  opportunity: number;
  /** 0..1 normalized rank within the result set */
  oppNorm: number;
}

export interface OpportunityWeights {
  /** Importance of imbalance (demand / capacity ratio). Default 0.65. */
  ratioWeight: number;
  /** Importance of raw demand size. Default 0.35. */
  densityWeight: number;
}

export interface OpportunityBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /** Cell side length in degrees (1.5° ≈ ~100 mi at mid-latitude) */
  cellSize: number;
}

const DEFAULT_BOUNDS: OpportunityBounds = {
  minLat: 24,
  maxLat: 50,
  minLng: -125,
  maxLng: -66,
  cellSize: 1.5,
};

const DEFAULT_WEIGHTS: OpportunityWeights = {
  ratioWeight: 0.65,
  densityWeight: 0.35,
};

/**
 * Aggregate demand/supply/processing into spatial cells and score each cell
 * on opportunity. Distance falloff within each cell is linear (1 at center,
 * 0.5 at the edge of the radius).
 */
export function computeOpportunityCells(input: {
  suppliers: OpportunitySupplier[];
  processors: OpportunityProcessor[];
  demand: DemandPoint[];
  bounds?: Partial<OpportunityBounds>;
  weights?: Partial<OpportunityWeights>;
}): OpportunityCell[] {
  const b = { ...DEFAULT_BOUNDS, ...input.bounds };
  const w = { ...DEFAULT_WEIGHTS, ...input.weights };
  const cellSize = b.cellSize;
  const cells: OpportunityCell[] = [];

  for (let lat = b.minLat; lat < b.maxLat; lat += cellSize) {
    for (let lng = b.minLng; lng < b.maxLng; lng += cellSize) {
      const cLat = lat + cellSize / 2;
      const cLng = lng + cellSize / 2;
      const radiusMi = cellSize * 55; // ≈ miles per degree latitude

      let demand = 0;
      let processCap = 0;
      let supplierCap = 0;
      let customers = 0;
      let processors = 0;
      let suppliers = 0;

      for (const c of input.demand) {
        const d = distance({ lat: cLat, lng: cLng }, c);
        if (d < radiusMi) {
          demand += c.demand * (1 - (d / radiusMi) * 0.5);
          customers++;
        }
      }
      for (const p of input.processors) {
        const d = distance({ lat: cLat, lng: cLng }, p);
        if (d < radiusMi) {
          const headroom = Math.max(0, p.capacity - p.throughput);
          processCap += headroom * (1 - (d / radiusMi) * 0.5);
          processors++;
        }
      }
      for (const f of input.suppliers) {
        const d = distance({ lat: cLat, lng: cLng }, f);
        if (d < radiusMi) {
          supplierCap += f.capacity * (1 - (d / radiusMi) * 0.5);
          suppliers++;
        }
      }

      // Skip cells with no signal
      if (demand < 200 && processors === 0 && suppliers === 0) continue;

      const gap = Math.max(0, demand - processCap);
      const ratio = demand / Math.max(processCap, 1);
      const density = Math.log(demand + 1);
      const supplyAvail = Math.log(supplierCap + 1) / 14;
      const opportunity =
        gap *
        Math.pow(ratio, w.ratioWeight) *
        Math.pow(density, w.densityWeight) *
        supplyAvail;

      cells.push({
        lat: cLat,
        lng: cLng,
        lat0: lat,
        lng0: lng,
        size: cellSize,
        demand,
        processCap,
        supplierCap,
        customers,
        processors,
        suppliers,
        gap,
        ratio,
        density,
        opportunity,
        oppNorm: 0, // filled in below
      });
    }
  }

  const maxOpp = Math.max(...cells.map(c => c.opportunity), 1);
  for (const c of cells) c.oppNorm = c.opportunity / maxOpp;

  return cells;
}

/** Recommendation flag for a single cell — used in drill-down UI */
export type OpportunityRecommendation =
  | 'strong-fit'
  | 'thin-supply'
  | 'well-served'
  | 'mixed';

export function recommendForCell(c: OpportunityCell): OpportunityRecommendation {
  if (c.gap > 5000 && c.suppliers >= 2) return 'strong-fit';
  if (c.gap > 5000 && c.suppliers < 2) return 'thin-supply';
  if (c.processors >= 3 && c.ratio < 1) return 'well-served';
  return 'mixed';
}

export const RECOMMENDATION_COPY: Record<OpportunityRecommendation, string> = {
  'strong-fit':
    'Strong fit for hardware deployment — local supply exists and demand is unmet.',
  'thin-supply':
    'Demand is unmet but supplier capacity is thin — hardware would require supply chain rerouting.',
  'well-served':
    'Region is well-served — no hardware investment indicated.',
  mixed: 'Mixed signal — review supply chain before committing.',
};
