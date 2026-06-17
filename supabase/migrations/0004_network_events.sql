-- ============================================================================
-- 0004_network_events.sql
--
-- Real activity feed — replaces the deterministic mock generator in the
-- web ActivityTicker once events start landing here. Web subscribes via
-- Supabase Realtime; the ticker prefers DB events and falls back to mock
-- when the table is empty so the discover loop is never broken.
-- ============================================================================

create table if not exists public.network_events (
  id              uuid primary key default uuid_generate_v4(),
  kind            text not null
                    check (kind in (
                      'booking',
                      'claim',
                      'capacity-up',
                      'capacity-down',
                      'new-listing',
                      'price-drop'
                    )),
  -- Subject — the processor or supplier the event is about. Nullable so
  -- system-level events ("new feature") can also live here.
  processor_id    text references public.processors(id) on delete set null,
  -- Denormalized for cheap reads — the ticker doesn't have to join on every fetch
  subject_name    text not null,
  subject_city    text,
  subject_state   text,
  subject_lat     double precision,
  subject_lng     double precision,
  -- Display extras
  detail          text not null,                 -- e.g. "Booked 3,250 lbs"
  numeric_detail  numeric,                       -- structured for analytics
  created_at      timestamptz not null default now()
);

create index if not exists network_events_created_idx
  on public.network_events (created_at desc);
create index if not exists network_events_kind_idx
  on public.network_events (kind);
create index if not exists network_events_processor_idx
  on public.network_events (processor_id);

alter table public.network_events enable row level security;

-- Anyone can read the public network feed
create policy "network_events: public read"
  on public.network_events for select
  using (true);

-- Only service role / admins can insert directly. Most rows will come from
-- triggers on processor_requests, processor_claims, etc.
create policy "network_events: admin insert"
  on public.network_events for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- ----------------------------------------------------------------------------
-- Trigger: when a new processor_request lands, write a 'booking' event.
-- ----------------------------------------------------------------------------
create or replace function public.network_events_after_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  proc public.processors;
begin
  select * into proc from public.processors where id = new.processor_id;
  if not found then
    return new;
  end if;
  insert into public.network_events (
    kind, processor_id, subject_name, subject_city, subject_state,
    subject_lat, subject_lng, detail
  )
  values (
    'booking',
    proc.id,
    proc.name,
    proc.city,
    proc.state,
    proc.lat,
    proc.lng,
    'New ' || replace(new.service_requested::text, '_', ' ') || ' request'
  );
  return new;
end;
$$;

drop trigger if exists on_request_created on public.processor_requests;
create trigger on_request_created
  after insert on public.processor_requests
  for each row execute function public.network_events_after_request();

-- ----------------------------------------------------------------------------
-- Trigger: when a claim is approved (claim_status flips to 'claimed'), event.
-- ----------------------------------------------------------------------------
create or replace function public.network_events_after_claim()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.claim_status is distinct from new.claim_status
     and new.claim_status = 'claimed' then
    insert into public.network_events (
      kind, processor_id, subject_name, subject_city, subject_state,
      subject_lat, subject_lng, detail
    )
    values (
      'claim',
      new.id,
      new.name,
      new.city,
      new.state,
      new.lat,
      new.lng,
      'Just claimed'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_processor_claimed on public.processors;
create trigger on_processor_claimed
  after update on public.processors
  for each row execute function public.network_events_after_claim();

-- ----------------------------------------------------------------------------
-- Realtime publication — make the table available over websockets.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
  -- Add the table to the publication if it isn't already
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'network_events'
  ) then
    alter publication supabase_realtime add table public.network_events;
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- Cheap read helper — keeps the ticker query simple from the client.
-- ----------------------------------------------------------------------------
create or replace function public.recent_network_events(limit_count integer default 24)
returns setof public.network_events
language sql
stable
security invoker
as $$
  select * from public.network_events
  order by created_at desc
  limit greatest(limit_count, 1)
$$;

grant execute on function public.recent_network_events(integer) to anon, authenticated;

comment on table public.network_events is
  'Public live activity feed. Append-only. Powers the ActivityTicker; subscribe via supabase realtime.';
