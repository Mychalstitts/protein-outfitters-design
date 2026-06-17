# Supabase — Data Collection Sidecar

**Purpose:** Capture warm-lead processor requests, processor claim submissions, and serve the public processor directory. This is *not* the marketplace database — that lives in the Firestore / Neon stack the main app uses. Supabase is the public-facing data layer for the directory wedge + email-driven lead capture.

Originally built inside the `Protein Outfitters (1)/` Next.js rebuild. As of May 15, 2026 we're keeping the Supabase project alive but freezing `(1)` — the schema, Edge Functions, and seed scripts moved here so the primary app (this folder) can call into them.

---

## What's deployed in the cloud right now

- **Supabase project ref:** `unybunaqyqrxhfyhvhfo`
- **Project URL:** `https://unybunaqyqrxhfyhvhfo.supabase.co`
- **Region:** us-west-2 (Free tier)
- **Dashboard:** https://supabase.com/dashboard/project/unybunaqyqrxhfyhvhfo

### Schema (7 migrations applied)

| # | Name | What it adds |
|---|------|---|
| 0001 | `initial_schema` | `processors`, `processor_claims`, `processor_requests`, `processor_photos` tables + PostGIS + pg_trgm indexes |
| 0002 | `email_pipeline` | `email_log` table for delivery tracking, `delete_my_account()` RPC |
| 0003 | `viewport_search` | RPC for bounded-box processor search |
| 0004 | `network_events` | `network_events` view for the live activity feed |
| 0005 | `photos` | Storage bucket + gallery photo schema |
| 0006 | `affiliate_attribution` | `affiliate_codes`, `affiliate_stats_30d` view, attribution RPC |
| 0007 | `processor_blocks` | External-animal calendar + capacity blocks |

### Seed data

- **472 processors loaded** (from 509 raw — 37 un-geocoded rows skipped). Source: state meat-processor associations + EatWild scrape. See `seed/processors.bundled.json`.

### Edge Functions deployed

| Function | URL | JWT verify |
|---|---|---|
| `send-request-emails` | `https://unybunaqyqrxhfyhvhfo.supabase.co/functions/v1/send-request-emails` | OFF (webhook-triggered) |
| `send-claim-emails` | `https://unybunaqyqrxhfyhvhfo.supabase.co/functions/v1/send-claim-emails` | OFF (webhook-triggered) |

Source in `functions/send-request-emails/` and `functions/send-claim-emails/`. Bundled single-file versions (no relative imports) in `functions/_bundled/` for the dashboard editor.

### Edge Function secrets

| Name | Purpose |
|---|---|
| `RESEND_API_KEY` | Sending-only Resend key, scoped to proteinoutfitters.com domain |
| `EMAIL_FROM_ADDRESS` | `Protein Outfitters <hello@proteinoutfitters.com>` |
| `EMAIL_REPLY_TO_FALLBACK` | `hello@proteinoutfitters.com` |
| `PUBLIC_URL` | `https://protein-outfitters-app1.vercel.app` — **update once we point proteinoutfitters.com at the new build** |

Plus the default secrets every project has: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

### Database webhooks

| Webhook | Table | Event | Function |
|---|---|---|---|
| `send-request-emails-on-insert` | `processor_requests` | INSERT | `send-request-emails` |
| `send-claim-emails-on-insert` | `processor_claims` | INSERT | `send-claim-emails` |

### Resend (the email sender)

- Domain `proteinoutfitters.com` is **verified** in Resend (GoDaddy DNS records live)
- Region: North Virginia (us-east-1)
- Sender: `hello@proteinoutfitters.com`
- End-to-end pipeline verified May 15 — test insert produced two emails marked `sent` in `email_log` with Resend provider IDs

---

## How to use this from the main app

### From React/Firebase frontend

```ts
import { createClient } from '@supabase/supabase-js';

// PUBLIC anon key only — never the service role
const supabase = createClient(
  'https://unybunaqyqrxhfyhvhfo.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// Read processors near a point (uses RPC from migration 0003)
const { data } = await supabase.rpc('processors_in_viewport', {
  min_lat: 41.0, max_lat: 42.0,
  min_lng: -94.0, max_lng: -93.0,
});

// Submit a warm lead — webhook fires send-request-emails automatically
await supabase.from('processor_requests').insert({
  processor_id: 'impa-27',
  contact_name: 'Jane Doe',
  contact_email: 'jane@example.com',
  animal_type: 'beef',
  service_requested: 'half_animal_processing',
  preferred_date: '2026-06-15',
});
```

### From a Node.js script (e.g. background data import)

Use the **service role** key (Supabase dashboard → API Keys → secret key). That bypasses RLS — keep server-side only. See `seed/seed-supabase.mjs` for the pattern.

### Where to get the keys (you, the human)

1. **Anon (publishable) key:** Supabase Dashboard → API Keys page → copy `sb_publishable_*`. Safe to expose in frontend bundles.
2. **Secret (service-role) key:** Same page → click *Create new secret key* → copy the `sb_secret_*` value (shown once). Keep in 1Password / your secrets manager. Never commit.

Both old-style JWT keys (`eyJ...`) were revoked May 15. Always use the new prefixed keys.

---

## Layout of this folder

```
supabase/
├── README.md                        ← you are here
├── .env.example                     ← env template
├── migrations/                      ← 7 SQL migrations, applied in order
│   ├── 0001_initial_schema.sql
│   ├── 0002_email_pipeline.sql
│   ├── 0003_viewport_search.sql
│   ├── 0004_network_events.sql
│   ├── 0005_photos.sql
│   ├── 0006_affiliate_attribution.sql
│   └── 0007_processor_blocks.sql
├── functions/                       ← Edge Function source
│   ├── _shared/
│   │   ├── cors.ts
│   │   └── email-templates.ts
│   ├── send-request-emails/index.ts
│   ├── send-claim-emails/index.ts
│   └── _bundled/                    ← single-file versions for dashboard deploy
│       ├── send-request-emails.ts
│       └── send-claim-emails.ts
└── seed/
    ├── seed-supabase.mjs            ← fetch-based loader, no SDK dep
    └── processors.bundled.json      ← 509 raw rows (472 with lat/lng)
```

---

## Operations playbook

**Apply a new migration:** open Supabase Dashboard → SQL Editor → paste contents → Run. Then check it landed under Database → Tables. (No `supabase db push` from CLI required.)

**Re-seed processors:** copy a fresh `processors.bundled.json` into `seed/`, then run from this folder:
```bash
SUPABASE_URL=https://unybunaqyqrxhfyhvhfo.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx \
node seed/seed-supabase.mjs
```

**Update an Edge Function:** edit the source under `functions/<name>/index.ts`. To deploy via the dashboard editor: paste the matching `functions/_bundled/<name>.ts` into Supabase Dashboard → Edge Functions → the function → Code tab → Deploy. Then ensure *Verify JWT with legacy secret* is **OFF** under Settings (webhooks don't send JWTs).

**Add an Edge Function secret:** Dashboard → Edge Functions → Secrets → Add new → Save.

**Wire a new webhook:** Dashboard → Database → Webhooks → Create a new hook → name it, pick table, pick event (INSERT/UPDATE/DELETE), pick `Type = Supabase Edge Functions`, pick the function. The function receives `{ type, table, record }` payload on every event.

**Check email delivery:** Dashboard → SQL Editor:
```sql
SELECT id, kind, to_email, status, provider_id, error_message, created_at
FROM email_log
ORDER BY created_at DESC LIMIT 20;
```

---

## What lives in `(1)` that we're NOT bringing over

The `Protein Outfitters (1)/` folder also has a complete Next.js 14 + App Router scaffold including a Leaflet map UI, Tailwind-free CSS design system, ActivityBubble + AskAI floating components, and SiteHeader/SiteFooter. None of that ports cleanly to this folder's Vite/React/Firebase stack — different bundler, different routing, different state model. If you want any of those *visual* components, they'd need to be rewritten as React/Vite components against this folder's design tokens. Don't blindly copy files.

The Supabase backend itself (this folder) is portable because it's just SQL + HTTP — anything can call it.
