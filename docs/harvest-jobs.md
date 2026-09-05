# Harvest jobs — Stittsworth Smokehouse trailer desk (Phase A2)

Shared calendar for Jeff Campbell at Turtle River. Online farm requests and phone call-ins are the same rows.

## Where it lives

| Piece | Path |
| --- | --- |
| Table | `harvest_jobs` (Neon / Postgres) |
| Schema | `deploy/db/schema.sql` |
| Migrate | `POST /api/migrate` (also `CREATE TABLE IF NOT EXISTS` + `ALTER` on first `/api/harvest-jobs` call) |
| API | `deploy/api/harvest-jobs.js` → `/api/harvest-jobs` |
| Helpers | `deploy/lib/harvest-jobs.js` (quotes + leftover-head math + pay_status) |
| Plant desk | `/plant-desk` (alias `/smokehouse/schedule`) |
| Farm request | `/harvest` → `POST /api/harvest-jobs` with `source=app` |

`processor_slug` is always `stittsworth-smokehouse`. This is not a national multi-processor desk.

## Job fields

- farm name, town (from the Smokehouse `TOWNS` list), species, heads 1–4, share kind
- trailer day (Tue–Thu harvest weekdays)
- source = `app` \| `phone`
- status = `requested` \| `confirmed` \| `capacity_used` \| `cancelled`
- kill + trip + total (server-quoted; Turtle River trip is $0)
- **pay_status** = `unpaid` (default) \| `cash` (collected on site) \| `app` (collected through Protein Outfitters — **flag only**)
- optional `paid_at`, `paid_note`, phone / notes / listing_id

Cancelled jobs do not count toward the day’s 4-head leftover. Checkout is not involved. Listing 123 is never published from this flow. Setting `pay_status=app` does **not** charge a card or open Stripe Checkout.

## Who can do what

- `GET ?view=capacity` — public leftover heads by day (no farm names)
- `GET` job list — processor or admin (includes pay fields)
- `POST source=app` — any signed-in user (farmer request). New jobs are always `unpaid`.
- `POST source=phone` / `PATCH` — processor or admin
- `PATCH pay_status` — processor or admin only

## Out of this PR

Actual Stripe charge, animal ID / cut sheets, 60-mile listing gate, mobile, Connect, checkout, publishing listing 123.
