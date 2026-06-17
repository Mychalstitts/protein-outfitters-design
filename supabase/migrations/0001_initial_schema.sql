-- Protein Outfitters — initial schema
-- Run via `npx supabase db push` after `supabase init` and linking your project.

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "postgis";  -- enables real distance/within queries

-- ============================================================================
-- profiles — joined to auth.users by id
-- ============================================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  home_zip      text,
  role          text not null default 'consumer'
                  check (role in ('consumer','processor_owner','admin')),
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner can read own row"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: owner can update own row"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-insert a profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- processors — the directory. Public read, admin/owner write.
-- ============================================================================
create table if not exists public.processors (
  id                          text primary key,                  -- e.g. "mamp-564"
  slug                        text not null unique,
  name                        text not null,
  role                        text not null
                                check (role in ('processor','supplier')),
  contact_name                text,
  phone                       text,
  email                       text,
  website                     text,

  -- Address — flat columns for easy SQL filtering, plus a generated `full`
  street                      text,
  city                        text,
  state                       text,                              -- 2-letter
  zip                         text,
  address_full                text,

  lat                         double precision not null,
  lng                         double precision not null,
  -- PostGIS column auto-derived from lat/lng. This is what we query against.
  location                    geography(Point, 4326)
                                generated always as
                                  (st_setsrid(st_makepoint(lng, lat), 4326)::geography)
                                stored,

  geocode_source              text,
  services                    text[] not null default '{}',
  inspection_status           text,
  usda_establishment_number   text,

  source                      text not null,
  source_url                  text,

  claim_status                text not null default 'unclaimed'
                                check (claim_status in ('unclaimed','pending','claimed')),
  claimed_by                  uuid references public.profiles(id) on delete set null,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- pg_trgm must exist before the trigram index that uses gin_trgm_ops
create extension if not exists pg_trgm;  -- for fast ILIKE / fuzzy name search

create index if not exists processors_location_gix on public.processors using gist (location);
create index if not exists processors_state_idx    on public.processors (state);
create index if not exists processors_claim_idx    on public.processors (claim_status);
create index if not exists processors_name_trgm    on public.processors using gin (name gin_trgm_ops);

alter table public.processors enable row level security;

create policy "processors: anyone can read"
  on public.processors for select
  using (true);

create policy "processors: claimed owner can update own listing"
  on public.processors for update
  using (auth.uid() = claimed_by)
  with check (auth.uid() = claimed_by);

-- Touch updated_at automatically
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists processors_touch on public.processors;
create trigger processors_touch
  before update on public.processors
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- processor_requests — consumer asks a processor for work
-- ============================================================================
create table if not exists public.processor_requests (
  id                  uuid primary key default uuid_generate_v4(),
  processor_id        text not null references public.processors(id) on delete cascade,
  user_id             uuid references public.profiles(id) on delete set null,

  contact_name        text not null,
  contact_email       text not null,
  contact_phone       text,
  contact_zip         text,

  animal_type         text not null,
  service_requested   text not null,
  preferred_date      date,
  notes               text,

  status              text not null default 'pending'
                        check (status in
                          ('pending','accepted','declined','needs_info','completed','cancelled')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists requests_processor_idx on public.processor_requests (processor_id);
create index if not exists requests_user_idx      on public.processor_requests (user_id);
create index if not exists requests_status_idx    on public.processor_requests (status);

alter table public.processor_requests enable row level security;

create policy "requests: anyone can submit"
  on public.processor_requests for insert
  with check (true);

create policy "requests: submitter can read own"
  on public.processor_requests for select
  using (auth.uid() = user_id);

create policy "requests: claimed processor can read theirs"
  on public.processor_requests for select
  using (
    exists (
      select 1 from public.processors p
      where p.id = processor_id and p.claimed_by = auth.uid()
    )
  );

create policy "requests: claimed processor can update theirs"
  on public.processor_requests for update
  using (
    exists (
      select 1 from public.processors p
      where p.id = processor_id and p.claimed_by = auth.uid()
    )
  );

drop trigger if exists requests_touch on public.processor_requests;
create trigger requests_touch
  before update on public.processor_requests
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- processor_claims — processor owner asserts ownership, admin reviews
-- ============================================================================
create table if not exists public.processor_claims (
  id                uuid primary key default uuid_generate_v4(),
  processor_id      text not null references public.processors(id) on delete cascade,
  claimant_user_id  uuid not null references public.profiles(id) on delete cascade,
  evidence_url      text,
  evidence_notes    text,
  review_status     text not null default 'pending'
                      check (review_status in ('pending','approved','denied')),
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (processor_id, claimant_user_id)
);

alter table public.processor_claims enable row level security;

create policy "claims: claimant can insert"
  on public.processor_claims for insert
  with check (auth.uid() = claimant_user_id);

create policy "claims: claimant can read own"
  on public.processor_claims for select
  using (auth.uid() = claimant_user_id);

-- ============================================================================
-- RPC: processors_within(lat, lng, radius_miles) — used by the map
-- ============================================================================
create or replace function public.processors_within(
  center_lat    double precision,
  center_lng    double precision,
  radius_miles  double precision
)
returns setof public.processors
language sql
stable
as $$
  select *
  from public.processors
  where st_dwithin(
    location,
    st_setsrid(st_makepoint(center_lng, center_lat), 4326)::geography,
    radius_miles * 1609.344  -- meters
  )
  order by location <-> st_setsrid(st_makepoint(center_lng, center_lat), 4326)::geography
$$;

-- ============================================================================
-- ACCOUNT DELETION — required by Apple App Store guideline 5.1.1(v)
-- Calling this from the mobile app fully removes the user.
-- ============================================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
