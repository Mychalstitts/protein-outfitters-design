/**
 * Resilient processor loader (API-SWAP PR A+B + auth-bridge cleanup).
 *
 * Strategy:
 *   1. Paint bundled JSON immediately (caller uses loadBundledProcessors).
 *   2. Prefer live Neon via GET /api/map-data (national pin set ~2.3k).
 *   3. On failure → keep bundled.
 *
 * Detail by slug: API → last map-data set (in memory) → bundled.
 * Synthetic `neon-*` slugs are served from the map-data set only.
 * Supabase is no longer on the read path (writes: request screen only until Slice F).
 */

import type { Processor } from '@protein-outfitters/shared';
import { getProcessorBySlug } from '@protein-outfitters/shared';
import { apiGet } from './api';
import {
  isSyntheticSlug,
  processorFromMapDataRow,
  processorFromNeonRow,
  type MapDataProcessorRow,
  type NeonProcessorRow,
} from './neonAdapter';
import { supabase, isSupabaseConfigured } from './supabase';
import bundled from '../data/processors.bundled.json';

const BUNDLED: Processor[] = bundled as Processor[];

/**
 * Last successful /api/map-data result, keyed by slug. ~60% of Neon rows
 * have no slug (we synthesize `neon-<uuid>`), and `/api/processors?slug=`
 * 404s for those — so the detail screen falls back to this set rather than
 * dead-ending on "Processor not found".
 */
const apiBySlug = new Map<string, Processor>();

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

/** Detail by slug — API, then in-memory map-data, then bundled. */
export async function loadProcessorBySlug(slug: string): Promise<{
  processor: Processor | null;
  source: DataSource;
  error?: string;
}> {
  if (!slug) {
    return { processor: null, source: 'bundled', error: 'Missing slug.' };
  }

  // Synthetic `neon-<uuid>` slugs only exist in the map-data set: the
  // slug lookup route 404s and bundled never contains them.
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
      { auth: false },
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

  return { processor: null, source: 'bundled', error: 'Processor not found.' };
}

/**
 * Request submit still goes to Supabase until Slice F (`POST /api/processor-requests`).
 * Supabase keys by directory id (`mamp-*`), not the Neon UUID. Resolve by slug
 * before writing; return null when there is no Supabase counterpart (e.g. synthetic).
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
