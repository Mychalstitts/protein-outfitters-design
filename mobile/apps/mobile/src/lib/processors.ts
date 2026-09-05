/**
 * Resilient processor loader.
 *
 * Apple's reviewer often opens the app on a flaky office Wi-Fi or with
 * VPNs that block third-party domains. If we hit Supabase and fail, the
 * map should still show something useful — bundled data from the last
 * known-good ingest. This is the difference between "review approved"
 * and "we can't see any content, rejected."
 *
 * Strategy:
 *   1. If Supabase is configured AND we can reach it → server data wins.
 *   2. If anything fails → use the bundled JSON.
 *   3. Server data is never blocked behind the network; we kick it off
 *      after we've already shown the bundled set.
 */

import type { Processor } from '@protein-outfitters/shared';
import { getAllProcessors } from '@protein-outfitters/shared';
import { supabase, isSupabaseConfigured } from './supabase';
import bundled from '../data/processors.bundled.json';

const BUNDLED: Processor[] = bundled as Processor[];

export type DataSource = 'server' | 'bundled' | 'merged';

export interface LoadResult {
  processors: Processor[];
  source: DataSource;
  error?: string;
}

/** Synchronous — always returns instantly. Used as the initial render. */
export function loadBundledProcessors(): Processor[] {
  return BUNDLED;
}

/** Async — tries the server, falls back. */
export async function loadProcessors(): Promise<LoadResult> {
  if (!isSupabaseConfigured()) {
    return { processors: BUNDLED, source: 'bundled' };
  }
  try {
    const data = await getAllProcessors(supabase);
    if (!data || data.length === 0) {
      return { processors: BUNDLED, source: 'bundled' };
    }
    return { processors: data, source: 'server' };
  } catch (e) {
    return {
      processors: BUNDLED,
      source: 'bundled',
      error:
        e instanceof Error ? e.message : 'Server unreachable — showing cached data.',
    };
  }
}
