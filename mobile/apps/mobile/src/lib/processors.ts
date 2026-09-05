/**
 * Resilient processor loader (API-SWAP PR A+B + auth-bridge cleanup).
 *
 * Strategy:
 *   1. Paint bundled JSON immediately (caller uses loadBundledProcessors).
 *   2. Prefer live Neon via GET /api/map-data (national pin set ~2.3k).
 *   3. On failure → keep bundled.
 *
 * Detail by slug: API → bundled.
 * Supabase is no longer on the read path (writes: request screen only).
 */

import type { Processor } from '@protein-outfitters/shared';
import { apiGet } from './api';
import {
  processorFromMapDataRow,
  processorFromNeonRow,
  type MapDataProcessorRow,
  type NeonProcessorRow,
} from './neonAdapter';
import bundled from '../data/processors.bundled.json';

const BUNDLED: Processor[] = bundled as Processor[];

export type DataSource = 'api' | 'bundled';

export interface LoadResult {
  processors: Processor[];
  source: DataSource;
  error?: string;
}

/** Synchronous — always returns instantly. Used as the initial render. */
export function loadBundledProcessors(): Processor[] {
  return BUNDLED;
}

export function findBundledBySlug(slug: string): Processor | null {
  return BUNDLED.find((p) => p.slug === slug) ?? null;
}

async function fetchFromMapData(): Promise<Processor[]> {
  const data = await apiGet<{ processors?: MapDataProcessorRow[] }>(
    '/api/map-data',
    { auth: false },
  );
  const rows = Array.isArray(data.processors) ? data.processors : [];
  const out: Processor[] = [];
  for (const row of rows) {
    const p = processorFromMapDataRow(row);
    if (p) out.push(p);
  }
  return out;
}

/** Async list — Neon map-data first, then bundled. */
export async function loadProcessors(): Promise<LoadResult> {
  try {
    const apiRows = await fetchFromMapData();
    if (apiRows.length > 0) {
      return { processors: apiRows, source: 'api' };
    }
  } catch (e) {
    const apiErr = e instanceof Error ? e.message : 'map-data unreachable';
    return {
      processors: BUNDLED,
      source: 'bundled',
      error: `${apiErr} — showing cached data.`,
    };
  }

  return { processors: BUNDLED, source: 'bundled' };
}

/** Detail by slug — API, then bundled. */
export async function loadProcessorBySlug(slug: string): Promise<{
  processor: Processor | null;
  source: DataSource;
  error?: string;
}> {
  if (!slug) {
    return { processor: null, source: 'bundled', error: 'Missing slug.' };
  }

  try {
    const data = await apiGet<{ processor?: NeonProcessorRow }>(
      `/api/processors?slug=${encodeURIComponent(slug)}`,
      { auth: false },
    );
    if (data.processor) {
      const p = processorFromNeonRow(data.processor);
      if (p) return { processor: p, source: 'api' };
    }
  } catch {
    /* try bundled */
  }

  const bundledHit = findBundledBySlug(slug);
  if (bundledHit) {
    return { processor: bundledHit, source: 'bundled' };
  }

  return { processor: null, source: 'bundled', error: 'Processor not found.' };
}
