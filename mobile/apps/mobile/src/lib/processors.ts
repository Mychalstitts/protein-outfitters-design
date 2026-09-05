/**
 * Resilient processor loader (API-SWAP PR A+B).
 *
 * Strategy:
 *   1. Paint bundled JSON immediately (caller uses loadBundledProcessors).
 *   2. Prefer live Neon via GET /api/map-data (national pin set ~2.3k).
 *   3. Optional tertiary: Supabase if still configured.
 *   4. On any failure → keep bundled.
 *
 * Detail by slug: API → bundled → Supabase.
 */

import type { Processor } from '@protein-outfitters/shared';
import {
  getAllProcessors,
  getProcessorBySlug,
} from '@protein-outfitters/shared';
import { supabase, isSupabaseConfigured } from './supabase';
import { apiGet } from './api';
import {
  processorFromMapDataRow,
  processorFromNeonRow,
  type MapDataProcessorRow,
  type NeonProcessorRow,
} from './neonAdapter';
import bundled from '../data/processors.bundled.json';

const BUNDLED: Processor[] = bundled as Processor[];

export type DataSource = 'api' | 'server' | 'bundled' | 'merged';

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
  );
  const rows = Array.isArray(data.processors) ? data.processors : [];
  const out: Processor[] = [];
  for (const row of rows) {
    const p = processorFromMapDataRow(row);
    if (p) out.push(p);
  }
  return out;
}

/** Async list — Neon map-data first, then Supabase, then bundled. */
export async function loadProcessors(): Promise<LoadResult> {
  try {
    const apiRows = await fetchFromMapData();
    if (apiRows.length > 0) {
      return { processors: apiRows, source: 'api' };
    }
  } catch (e) {
    const apiErr = e instanceof Error ? e.message : 'map-data unreachable';
    if (isSupabaseConfigured()) {
      try {
        const data = await getAllProcessors(supabase);
        if (data?.length) {
          return {
            processors: data,
            source: 'server',
            error: `API unavailable (${apiErr}); using Supabase.`,
          };
        }
      } catch (e2) {
        return {
          processors: BUNDLED,
          source: 'bundled',
          error:
            e2 instanceof Error
              ? e2.message
              : 'Servers unreachable — showing cached data.',
        };
      }
    }
    return {
      processors: BUNDLED,
      source: 'bundled',
      error: `${apiErr} — showing cached data.`,
    };
  }

  if (isSupabaseConfigured()) {
    try {
      const data = await getAllProcessors(supabase);
      if (data?.length) return { processors: data, source: 'server' };
    } catch {
      /* bundled below */
    }
  }

  return { processors: BUNDLED, source: 'bundled' };
}

/** Detail by slug — API, then bundled, then Supabase. */
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
    );
    if (data.processor) {
      const p = processorFromNeonRow(data.processor);
      if (p) return { processor: p, source: 'api' };
    }
  } catch {
    /* try fallbacks */
  }

  const bundledHit = findBundledBySlug(slug);
  if (bundledHit) {
    return { processor: bundledHit, source: 'bundled' };
  }

  if (isSupabaseConfigured()) {
    try {
      const data = await getProcessorBySlug(supabase, slug);
      if (data) return { processor: data, source: 'server' };
    } catch (e) {
      return {
        processor: null,
        source: 'server',
        error: e instanceof Error ? e.message : 'Failed to load.',
      };
    }
  }

  return { processor: null, source: 'bundled', error: 'Processor not found.' };
}
