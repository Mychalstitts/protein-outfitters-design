-- ============================================================================
-- 0005_photos.sql
--
-- Adds cover photo + gallery support. Real photos are stored in a public
-- Supabase Storage bucket; the URL is denormalized onto the row so the
-- listing query stays a single SELECT. When a row has no cover, the
-- frontend falls back to procedurally-generated cover art (see
-- packages/shared/src/lib/cover-art.ts).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema additions
-- ----------------------------------------------------------------------------
alter table public.processors
  add column if not exists cover_photo_url text,
  add column if not exists gallery_urls    text[] not null default '{}',
  add column if not exists photos_updated_at timestamptz;

-- Useful for the home page hero "with photos" carousel
create index if not exists processors_has_cover_idx
  on public.processors ((cover_photo_url is not null));

-- Trigger to bump photos_updated_at when cover/gallery changes
create or replace function public.touch_photos_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.cover_photo_url is distinct from old.cover_photo_url
     or new.gallery_urls is distinct from old.gallery_urls then
    new.photos_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_processor_photos_change on public.processors;
create trigger on_processor_photos_change
  before update on public.processors
  for each row execute function public.touch_photos_updated_at();

-- ----------------------------------------------------------------------------
-- Storage bucket — public read, authenticated write (claimants only)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('processor-photos', 'processor-photos', true)
on conflict (id) do nothing;

-- Public read
drop policy if exists "processor-photos: public read" on storage.objects;
create policy "processor-photos: public read"
  on storage.objects for select
  using (bucket_id = 'processor-photos');

-- Authenticated users can upload to their claimed processor's folder
-- Object names follow convention: <processor_id>/<filename>
drop policy if exists "processor-photos: claimant write" on storage.objects;
create policy "processor-photos: claimant write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'processor-photos'
    and (
      -- Owner of the claimed processor
      exists (
        select 1 from public.processors p
        where p.id = (storage.foldername(name))[1]
          and p.claimed_by = auth.uid()
      )
      -- Or admin
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    )
  );

-- Same rule for delete + update (replace existing photo)
drop policy if exists "processor-photos: claimant update" on storage.objects;
create policy "processor-photos: claimant update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'processor-photos'
    and (
      exists (
        select 1 from public.processors p
        where p.id = (storage.foldername(name))[1]
          and p.claimed_by = auth.uid()
      )
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    )
  );

drop policy if exists "processor-photos: claimant delete" on storage.objects;
create policy "processor-photos: claimant delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'processor-photos'
    and (
      exists (
        select 1 from public.processors p
        where p.id = (storage.foldername(name))[1]
          and p.claimed_by = auth.uid()
      )
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    )
  );

comment on column public.processors.cover_photo_url is
  'Public URL of the cover photo. NULL → frontend generates procedural cover art keyed by processor id.';

comment on column public.processors.gallery_urls is
  'Additional photos. Frontend shows count badge and lightboxes them.';
