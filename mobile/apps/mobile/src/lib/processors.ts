/**
 * Resilient processor loader (API-SWAP PR A+B).
 *
 * Strategy:
 *   1. Paint bundled JSON immediately (caller uses loadBundledProcessors).
 *   2. Prefer live Neon via GET /api/map-data (national pin set ~2.3k).
 *   3. Optional tertiary: Supabase if still configured.
 *   4. On any failure → keep bundled.
 *
 * Detail by slug: API → last map-data set (in memory) → bundled → Supabase.
 * Synthetic `neon-*` slugs are served from the map-data set only.
 */

import type { Processor } from '@protein-outfitters/shared';
import {
  getAllProcessors,
  getProcessorBySlug,
} from '@protein-outfitters/shared';
import { supabase, isSupabaseConfigured } from './supabase';
import { apiGet } from './api';
import {
  isSyntheticSlug,
  processorFromMapDataRow,
  processorFromNeonRow,
  type MapDataProcessorRow,
  type NeonProcessorRow,
} from './neonAdapter';
import bundled from '../data/processors.bundled.json';

const BUNDLED: Processor[] = bundled as Processor[];

/**
 * Last successful /api/map-data result, keyed by slug. ~60% of Neon rows
 * have no slug (we synthesize `neon-<uuid>`), and `/api/processors?slug=`
 * 404s for those — so the detail screen falls back to this set rather than
 * dead-ending on "Processor not found".
 */
const apiBySlug = new Map<string, Processor>();

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
  if (out.length > 0) {
    apiBySlug.clear();
    for (const p of out) apiBySlug.set(p.slug, p);
  }
  return out;
}

/** In-memory hit from the last map-data load (no network). */
export function findApiBySlug(slug: string): Processor | null {
  return apiBySlug.get(slug) ?? null;
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

/** Detail by slug — API, then in-memory map-data, then bundled, then Supabase. */
export async function loadProcessorBySlug(slug: string): Promise<{
  processor: Processor | null;
  source: DataSource;
  error?: string;
}> {
  if (!slug) {
    return { processor: null, source: 'bundled', error: 'Missing slug.' };
  }

  // Synthetic `neon-<uuid>` slugs only exist in the map-data set: the
  // slug lookup route 404s and bundled/Supabase never contain them.
  if (isSyntheticSlug(slug)) {
    let hit = findApiBySlug(slug);
    if (!hit) {
      // Deep link / cold start before the map has loaded — warm the cache.
      try {
        await fetchFromMapData();
        hit = findApiBySlug(slug);
      } catch {
        /* fall through */
      }
    }
    return hit
      ? { processor: hit, source: 'api' }
      : { processor: null, source: 'bundled', error: 'Processor not found.' };
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

  const apiHit = findApiBySlug(slug);
  if (apiHit) {
    return { processor: apiHit, source: 'api' };
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

/**
 * Claim / request writes still go to Supabase (API-SWAP PRs D–F pending),
 * and Supabase keys `processor_claims` / `processor_requests` by the
 * directory id (`mamp-*`), NOT the Neon UUID. When a screen loaded its
 * processor from the API, resolve the Supabase-side id by slug before
 * writing — never send a Neon UUID into a Supabase table.
 *
 * Returns null when the listing has no Supabase counterpart (e.g. a
 * synthetic `neon-*` slug), so the caller can refuse the write instead of
 * inserting an orphan row.
 */
export async function resolveSupabaseProcessorId(
  proc: Processor,
): Promise<string | null> {
  if (proc.source !== 'neon') return proc.id;
  if (isSyntheticSlug(proc.slug)) return null;

  const bundledHit = findBundledBySlug(proc.slug);
  if (bundledHit) return bundledHit.id;

  if (isSupabaseConfigured()) {
    try {
      const data = await getProcessorBySlug(supabase, proc.slug);
      if (data?.id) return data.id;
    } catch {
      /* treat as not found */
    }
  }
  return null;
}
