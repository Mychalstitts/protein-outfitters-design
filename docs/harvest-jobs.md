# Harvest jobs — Stittsworth Smokehouse trailer desk (Phase A1)

Shared calendar for Jeff Campbell at Turtle River. Online farm requests and phone call-ins are the same rows.

## Where it lives

| Piece | Path |
| --- | --- |
| Table | `harvest_jobs` (Neon / Postgres) |
| Schema | `deploy/db/schema.sql` |
| Migrate | `POST /api/migrate` (also `CREATE TABLE IF NOT EXISTS` on first `/api/harvest-jobs` call) |
| API | `deploy/api/harvest-jobs.js` → `/api/harvest-jobs` |
| Helpers | `deploy/lib/harvest-jobs.js` (quotes + leftover-head math) |
| Plant desk | `/plant-desk` (alias `/smokehouse/schedule`) |
| Farm request | `/harvest` → `POST /api/harvest-jobs` with `source=app` |

`processor_slug` is always `stittsworth-smokehouse`. This is not a national multi-processor desk.

## Job fields

- farm name, town (from the Smokehouse `TOWNS` list), species, heads 1–4, share kind
- trailer day (Tue–Thu harvest weekdays)
- source = `app` \| `phone`
- status = `requested` \| `confirmed` \| `capacity_used` \| `cancelled`
- kill + trip + total (server-quoted; Turtle River trip is $0)
- optional phone / notes / listing_id

Cancelled jobs do not count toward the day’s 4-head leftover. Checkout is not involved. Listing 123 is never published from this flow.

## Who can do what

- `GET ?view=capacity` — public leftover heads by day (no farm names)
- `GET` job list — processor or admin
- `POST source=app` — any signed-in user (farmer request)
- `POST source=phone` / `PATCH` — processor or admin

## Out of this PR

Payment capture, animal ID / cut sheets, 60-mile listing gate, mobile, Connect, checkout, publishing listing 123.
