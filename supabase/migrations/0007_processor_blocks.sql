-- Protein Outfitters — processor_blocks (external-animal calendar)
-- Run AFTER 0006_affiliate_attribution.sql
--
-- A processor needs to mark their week with three kinds of time:
--   * 'platform' — a booked job that came through Protein Outfitters
--   * 'external' — a booked job from their own walk-in book (no cutsheet here,
--                  but it should still appear on their calendar)
--   * 'closed'   — vacation / maintenance / hunting trip etc.
--
-- Anyone can READ blocks (so consumers see availability on a profile page).
-- Only the claimed processor can write their own.

create table if not exists public.processor_blocks (
  id            uuid primary key default uuid_generate_v4(),
  processor_id  text not null references public.processors(id) on delete cascade,

  starts_at     timestamptz not null,
  ends_at       timestamptz not null check (ends_at > starts_at),

  kind          text not null
                  check (kind in ('platform','external','closed')),

  -- Optional metadata — populated for 'platform' from the request, optional
  -- for 'external', irrelevant for 'closed'.
  animal_type   text,
  notes         text,

  -- Set when kind = 'platform' and we know which request booked this block.
  request_id    uuid references public.processor_requests(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists processor_blocks_processor_time_idx
  on public.processor_blocks (processor_id, starts_at);
create index if not exists processor_blocks_request_idx
  on public.processor_blocks (request_id) where request_id is not null;

drop trigger if exists processor_blocks_touch on public.processor_blocks;
create trigger processor_blocks_touch
  before update on public.processor_blocks
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.processor_blocks enable row level security;

create policy "processor_blocks: anyone can read"
  on public.processor_blocks for select
  using (true);

create policy "processor_blocks: claimed owner can insert"
  on public.processor_blocks for insert
  with check (
    exists (
      select 1 from public.processors p
      where p.id = processor_id and p.claimed_by = auth.uid()
    )
  );

create policy "processor_blocks: claimed owner can update own"
  on public.processor_blocks for update
  using (
    exists (
      select 1 from public.processors p
      where p.id = processor_id and p.claimed_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.processors p
      where p.id = processor_id and p.claimed_by = auth.uid()
    )
  );

create policy "processor_blocks: claimed owner can delete own"
  on public.processor_blocks for delete
  using (
    exists (
      select 1 from public.processors p
      where p.id = processor_id and p.claimed_by = auth.uid()
    )
  );
