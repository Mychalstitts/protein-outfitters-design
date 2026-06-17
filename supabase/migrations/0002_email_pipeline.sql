-- Email pipeline schema additions
-- Run AFTER 0001_initial_schema.sql

-- ============================================================================
-- email_log — audit trail for every email we attempt to send.
-- We never modify the row after insert (status changes get new rows).
-- ============================================================================
create table if not exists public.email_log (
  id              uuid primary key default uuid_generate_v4(),
  -- What kind of email this is (request_to_processor, request_confirmation,
  -- claim_received, claim_approved, etc.)
  kind            text not null,
  -- Polymorphic foreign keys — set the one that applies
  request_id      uuid references public.processor_requests(id) on delete cascade,
  claim_id        uuid references public.processor_claims(id) on delete cascade,
  -- Recipients
  to_email        text not null,
  to_name         text,
  -- Resend assigns its own message_id; null until provider responds
  provider        text not null default 'resend',
  provider_id     text,
  status          text not null default 'queued'
                    check (status in ('queued','sent','failed','bounced','complaint')),
  error_message   text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists email_log_request_idx on public.email_log (request_id);
create index if not exists email_log_claim_idx   on public.email_log (claim_id);
create index if not exists email_log_status_idx  on public.email_log (status);

alter table public.email_log enable row level security;

-- Only service role writes to email_log; users never read it.
-- (No SELECT policy = no rows visible to anon/authed users)

-- ============================================================================
-- Database webhook trigger — fires the Edge Function on new request inserts.
-- Set up the actual webhook in the Supabase dashboard:
--   Database → Webhooks → Create
--     Name:   request_email_dispatch
--     Table:  processor_requests
--     Events: Insert
--     Type:   Supabase Edge Functions
--     Function: send-request-emails
-- The trigger below is a no-op marker so we can document the dependency.
-- ============================================================================
create or replace function public.note_request_email_dispatch()
returns trigger language plpgsql as $$
begin
  -- The actual dispatch is via the dashboard webhook to send-request-emails.
  -- This function exists so anyone reading the schema can see the dependency.
  return new;
end;
$$;

drop trigger if exists requests_email_marker on public.processor_requests;
create trigger requests_email_marker
  after insert on public.processor_requests
  for each row execute function public.note_request_email_dispatch();
