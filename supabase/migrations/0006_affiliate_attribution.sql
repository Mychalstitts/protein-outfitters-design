-- Protein Outfitters — affiliate codes + attribution events
-- Run AFTER 0002_email_pipeline.sql
--
-- Why this exists:
--   Farms and processors can hand out share links like
--   https://proteinoutfitters.com/r/{code}. We log every landing and tie it
--   to the eventual processor_request, so:
--     - owners (farm or processor) see who they sent us
--     - admin can compute who's owed what at the end of the month
--     - the customer-facing pricing UI knows whether to apply a markdown
--
--   `owner_processor_id` references public.processors(id) — note that table
--   already holds BOTH processors and suppliers (farms) via the `role` column,
--   so there's no separate `farms` table. NULL = a platform/admin code.
--
--   `converted_request_id` references public.processor_requests(id) — the
--   existing requests table from 0001.

-- ============================================================================
-- affiliate_codes — one row per share link
-- ============================================================================
create table if not exists public.affiliate_codes (
  id                      uuid primary key default uuid_generate_v4(),
  code                    text not null unique
                            check (char_length(code) between 3 and 32
                                   and code ~ '^[a-z0-9_-]+$'),

  -- NULL = platform/admin code (e.g. a launch promo).
  -- Otherwise = the farm or processor that owns this code.
  owner_processor_id      text references public.processors(id) on delete cascade,

  -- 0–50% — caps any one affiliate at half the total. Adjust later if needed.
  default_percent         numeric(5,2) not null
                            check (default_percent between 0 and 50),

  -- Who eats the cost of the discount/commission.
  --   'platform'  — platform absorbs (cleanest at MVP)
  --   'processor' — processor agrees to be billed for the markdown
  --   'shared'    — split 50/50 between platform and processor
  paid_by                 text not null default 'platform'
                            check (paid_by in ('platform','processor','shared')),

  -- Whether the customer sees a marked-down price on the request flow.
  -- If false: customer sees gross price; affiliate gets percent of platform commission.
  -- If true:  customer sees discounted price; same accounting on the back end.
  customer_sees_discount  boolean not null default false,

  active                  boolean not null default true,
  notes                   text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists affiliate_codes_owner_idx
  on public.affiliate_codes (owner_processor_id);
create index if not exists affiliate_codes_active_idx
  on public.affiliate_codes (active) where active;

drop trigger if exists affiliate_codes_touch on public.affiliate_codes;
create trigger affiliate_codes_touch
  before update on public.affiliate_codes
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- attribution_events — one row per landing through an /r/{code} URL
-- ============================================================================
create table if not exists public.attribution_events (
  id                      uuid primary key default uuid_generate_v4(),
  code_id                 uuid not null references public.affiliate_codes(id) on delete restrict,

  -- SHA-256(visitor_id) — visitor_id is a stable opaque cookie value (po_vid).
  -- We never store the raw cookie or anything that lets us re-identify the user
  -- across sessions outside of this table.
  visitor_token           text not null,

  landed_at               timestamptz not null default now(),
  landing_path            text not null,

  -- Stored without IP. UA helps us spot bots; ip_country is server-side derived
  -- by the route handler (NOT by storing the raw IP) for coarse geo rollups.
  user_agent              text,
  ip_country              text,

  -- Set when the visitor eventually submits a request with the matching po_aff
  -- cookie. The request-create Edge Function does this stamp.
  converted_request_id    uuid references public.processor_requests(id) on delete set null,
  converted_at            timestamptz
);

create index if not exists attribution_events_code_landed_idx
  on public.attribution_events (code_id, landed_at desc);
create index if not exists attribution_events_converted_idx
  on public.attribution_events (converted_request_id)
  where converted_request_id is not null;
create index if not exists attribution_events_visitor_idx
  on public.attribution_events (visitor_token, landed_at desc);

-- ============================================================================
-- affiliate_stats_30d — rolling 30-day rollup view, used by the dashboard
-- ============================================================================
create or replace view public.affiliate_stats_30d as
select
  c.id                                                              as code_id,
  c.code,
  c.owner_processor_id,
  c.default_percent,
  c.paid_by,
  c.active,
  count(distinct e.visitor_token)
    filter (where e.landed_at > now() - interval '30 days')         as visitors,
  count(e.id)
    filter (where e.landed_at > now() - interval '30 days')         as landings,
  count(distinct e.converted_request_id)
    filter (where e.converted_at > now() - interval '30 days')      as conversions
from public.affiliate_codes c
left join public.attribution_events e on e.code_id = c.id
group by c.id, c.code, c.owner_processor_id, c.default_percent, c.paid_by, c.active;

-- ============================================================================
-- RLS — affiliate_codes
--   * anyone can read ACTIVE codes (so /r/{code} can resolve via anon key)
--   * claimed processor can read all their own codes (incl. inactive)
--   * admin can read all
--   * service role writes (admin tooling)
-- ============================================================================
alter table public.affiliate_codes enable row level security;

create policy "affiliate_codes: anyone reads active"
  on public.affiliate_codes for select
  using (active = true);

create policy "affiliate_codes: owner reads own"
  on public.affiliate_codes for select
  using (
    owner_processor_id is not null
    and exists (
      select 1 from public.processors p
      where p.id = owner_processor_id and p.claimed_by = auth.uid()
    )
  );

create policy "affiliate_codes: admin reads all"
  on public.affiliate_codes for select
  using (
    exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

create policy "affiliate_codes: admin writes"
  on public.affiliate_codes for all
  using (
    exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

-- ============================================================================
-- RLS — attribution_events
--   * NO anon reads — these are owner/admin-only
--   * claimed owner reads events tied to their own codes
--   * admin reads all
--   * writes go through the service role (the /r/{code} route handler and the
--     request-create Edge Function), never directly from a user.
-- ============================================================================
alter table public.attribution_events enable row level security;

create policy "attribution_events: owner reads own"
  on public.attribution_events for select
  using (
    exists (
      select 1
      from public.affiliate_codes c
      join public.processors p on p.id = c.owner_processor_id
      where c.id = code_id and p.claimed_by = auth.uid()
    )
  );

create policy "attribution_events: admin reads all"
  on public.attribution_events for select
  using (
    exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

-- ============================================================================
-- RPC: convert_attribution(visitor_token, request_id)
-- Called by the request-create Edge Function (or a database webhook) after a
-- processor_request is inserted, to attach attribution if the visitor had a
-- matching po_aff cookie within the last 30 days.
--
-- Strategy: find the most recent unconverted event for this visitor inside
-- the 30-day window and stamp it. One event per request.
-- ============================================================================
create or replace function public.convert_attribution(
  p_visitor_token  text,
  p_request_id     uuid
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if p_visitor_token is null or p_request_id is null then
    return null;
  end if;

  update public.attribution_events
     set converted_request_id = p_request_id,
         converted_at         = now()
   where id = (
     select id
       from public.attribution_events
      where visitor_token = p_visitor_token
        and converted_request_id is null
        and landed_at > now() - interval '30 days'
      order by landed_at desc
      limit 1
   )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.convert_attribution(text, uuid) from public;
grant execute on function public.convert_attribution(text, uuid) to service_role;
