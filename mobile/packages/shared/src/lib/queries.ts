/**
 * High-level data access functions used by both apps. Wraps Supabase
 * so platform code never deals with raw SQL or table names.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Processor } from '../types/processor';
import type { ProcessorRequest } from '../types/request';
import type { LatLng } from './geo';

/** Get all processors. Fine for our 509-row dataset; paginate later. */
export async function getAllProcessors(
  supabase: SupabaseClient,
): Promise<Processor[]> {
  const { data, error } = await supabase
    .from('processors')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Processor[];
}

/** Server-side geo query — much faster than pulling everything client-side */
export async function getProcessorsNear(
  supabase: SupabaseClient,
  center: LatLng,
  radiusMiles: number,
): Promise<Processor[]> {
  const { data, error } = await supabase.rpc('processors_within', {
    center_lat: center.lat,
    center_lng: center.lng,
    radius_miles: radiusMiles,
  });
  if (error) throw error;
  return (data ?? []) as Processor[];
}

/**
 * Bounding-box geo query for the map. Returns up to `maxResults` rows whose
 * location intersects the box, ordered by distance from the bbox center so
 * if we cap at 500, we keep the middle of the viewport densely populated.
 * Backed by GIST index — sub-100ms even at 50k+ rows.
 */
export interface BBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ProcessorsInBoundsOptions {
  /** 'processor' or 'supplier' — null means both */
  role?: 'processor' | 'supplier' | null;
  /** Restrict to claimed listings only */
  claimedOnly?: boolean;
  /** Match if any of the given services overlap with row.services */
  servicesAny?: string[] | null;
  /** Max rows returned. Defaults to 500. */
  maxResults?: number;
}

export async function getProcessorsInBounds(
  supabase: SupabaseClient,
  bbox: BBox,
  options: ProcessorsInBoundsOptions = {},
): Promise<Processor[]> {
  const { data, error } = await supabase.rpc('processors_in_bounds', {
    north: bbox.north,
    south: bbox.south,
    east: bbox.east,
    west: bbox.west,
    role_filter: options.role ?? null,
    claimed_only: options.claimedOnly ?? false,
    services_any: options.servicesAny ?? null,
    max_results: options.maxResults ?? 500,
  });
  if (error) throw error;
  return (data ?? []) as Processor[];
}

/**
 * Cheap count for "1,247 listings in this area" — much faster than fetching
 * the rows just to compute length.
 */
export async function getProcessorsCountInBounds(
  supabase: SupabaseClient,
  bbox: BBox,
  role?: 'processor' | 'supplier' | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('processors_count_in_bounds', {
    north: bbox.north,
    south: bbox.south,
    east: bbox.east,
    west: bbox.west,
    role_filter: role ?? null,
  });
  if (error) throw error;
  // RPC returning bigint comes back as a string in some PG drivers
  return typeof data === 'string' ? parseInt(data, 10) : Number(data ?? 0);
}

export async function getProcessorBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<Processor | null> {
  const { data, error } = await supabase
    .from('processors')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data as Processor | null;
}

export async function submitRequest(
  supabase: SupabaseClient,
  payload: Omit<ProcessorRequest, 'id' | 'status' | 'created_at' | 'updated_at'>,
): Promise<ProcessorRequest> {
  const { data, error } = await supabase
    .from('processor_requests')
    .insert({ ...payload, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data as ProcessorRequest;
}

export interface ClaimSubmission {
  processor_id: string;
  /** Required — must match an authenticated user */
  claimant_user_id: string;
  /** What relationship the claimant has to the business */
  role_at_business: 'owner' | 'manager' | 'employee' | 'other';
  /** URL to a license, business page, or other proof */
  evidence_url: string | null;
  evidence_notes: string | null;
}

export async function submitClaim(
  supabase: SupabaseClient,
  payload: ClaimSubmission,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('processor_claims')
    .insert({
      processor_id: payload.processor_id,
      claimant_user_id: payload.claimant_user_id,
      evidence_url: payload.evidence_url,
      evidence_notes: payload.evidence_notes
        ? `[role: ${payload.role_at_business}] ${payload.evidence_notes}`
        : `[role: ${payload.role_at_business}]`,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}
