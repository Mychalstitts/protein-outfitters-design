-- ============================================================================
-- 0003_viewport_search.sql
--
-- Adds bbox-aware processor lookup so the map can fetch only what's visible.
-- Uses the existing GIST index on processors.location — sub-100ms even at
-- 50k rows. Without this, find-suppliers and find-processors fetch the entire
-- table on mount, which doesn't scale past a few thousand records.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- processors_in_bounds(north, south, east, west, role_filter, claimed_only,
--                      services_any, max_results)
--
-- Returns processors whose location falls inside the lat/lng box. Optionally
-- filters by role ('processor' / 'supplier' / null = both), claim status, and
-- service overlap.
--
-- Why ST_MakeEnvelope: it builds a geometry box once and intersect against
-- our GIST-indexed location column. Postgres optimizer picks the index.
-- ----------------------------------------------------------------------------
create or replace function public.processors_in_bounds(
  north         double precision,
  south         double precision,
  east          double precision,
  west          double precision,
  role_filter   text default null,
  claimed_only  boolean default false,
  services_any  text[] default null,
  max_results   integer default 500
)
returns setof public.processors
language sql
stable
security invoker
as $$
  select *
  from public.processors p
  where st_intersects(
    p.location,
    st_makeenvelope(west, south, east, north, 4326)::geography
  )
    and (role_filter is null or p.role = role_filter)
    and (not claimed_only or p.claim_status = 'claimed')
    and (services_any is null or p.services && services_any)
  -- Centroid distance ordering keeps the first N results biased toward the
  -- middle of the viewport — useful when we hit max_results
  order by st_distance(
    p.location,
    st_setsrid(
      st_makepoint(
        (east + west) / 2.0,
        (north + south) / 2.0
      ),
      4326
    )::geography
  )
  limit max_results
$$;

comment on function public.processors_in_bounds is
  'Viewport search: returns up to max_results processors whose location intersects the bbox. Backed by processors_location_gix.';

grant execute on function public.processors_in_bounds(
  double precision, double precision, double precision, double precision,
  text, boolean, text[], integer
) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Quick count helper — show "1,247 in this area" before paging full rows.
-- ----------------------------------------------------------------------------
create or replace function public.processors_count_in_bounds(
  north         double precision,
  south         double precision,
  east          double precision,
  west          double precision,
  role_filter   text default null
)
returns bigint
language sql
stable
security invoker
as $$
  select count(*)
  from public.processors p
  where st_intersects(
    p.location,
    st_makeenvelope(west, south, east, north, 4326)::geography
  )
    and (role_filter is null or p.role = role_filter)
$$;

comment on function public.processors_count_in_bounds is
  'Cheap count of processors inside a bbox. Use to display "N in this area" without paging the rows.';

grant execute on function public.processors_count_in_bounds(
  double precision, double precision, double precision, double precision, text
) to anon, authenticated;
