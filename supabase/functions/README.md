# Supabase Edge Functions

These run on Supabase's Deno runtime, triggered by either:
- HTTP calls from our apps (rare — most app logic uses RLS-protected RPCs)
- Database webhooks on insert/update/delete events
- Scheduled cron jobs (Supabase pg_cron)

## Functions

| Function                | Trigger                                       | Purpose                                                |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `send-request-emails`   | DB webhook on `processor_requests` INSERT     | Email the processor + confirmation to the consumer    |
| `send-claim-emails`     | DB webhook on `processor_claims` INSERT       | Notify admin + acknowledge the claimant                |

## Required env vars (set in Supabase dashboard → Edge Functions → Secrets)

```
RESEND_API_KEY            re_xxx (from resend.com)
EMAIL_FROM_ADDRESS        Protein Outfitters <noreply@proteinoutfitters.com>
EMAIL_REPLY_TO_FALLBACK   support@proteinoutfitters.com
PUBLIC_URL                https://proteinoutfitters.com
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase — don't set them manually.

## Local development

Functions hit Resend's real API in production. Locally, leave `RESEND_API_KEY`
unset and the function falls into "dev mode" — it logs what *would* have been
sent and writes a `failed` row to `email_log` so you can inspect the payload.

```bash
# Run a function locally
npx supabase functions serve send-request-emails --no-verify-jwt

# Trigger it manually
curl -X POST http://localhost:54321/functions/v1/send-request-emails \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "INSERT",
    "table": "processor_requests",
    "record": {
      "id": "00000000-0000-0000-0000-000000000001",
      "processor_id": "mamp-565",
      "contact_name": "Test User",
      "contact_email": "you@example.com",
      "contact_phone": null,
      "contact_zip": "55104",
      "animal_type": "beef",
      "service_requested": "whole_animal_processing",
      "preferred_date": null,
      "notes": "Half steer, T-bones at 1.25\""
    }
  }'
```

## Deploy

```bash
npx supabase functions deploy send-request-emails --no-verify-jwt
```

Then set up the webhook in **Database → Webhooks → New**:
- Table: `processor_requests`
- Events: Insert
- Type: Supabase Edge Functions
- Function: `send-request-emails`

## Why not just `pg_net` from a trigger?

Two reasons. (1) Edge Functions can do real HTTP with retries, JSON parsing,
and proper error handling — `pg_net` is fire-and-forget. (2) Webhooks are
event-sourced: replays are easy, debugging is easy, and we keep raw HTTP logic
out of SQL where it doesn't belong.
