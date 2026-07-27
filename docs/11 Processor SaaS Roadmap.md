# Processor SaaS — Roadmap

Source of truth for the roadmap published at `/processor-saas`. Written 24 Jul 2026
from a line-by-line audit of `deploy/` — every "Shipped" item below was verified
against real code paths, not against a page that claims it. Pair with
`docs/10 Pricing — Source of Truth.md`.

Rule: nothing moves into **Shipped** on the public page until a processor can do it
end to end in production. Mockups with hardcoded data stay in **Building**.

## Shipped — live today

| Capability | Where it lives |
|---|---|
| Booking intake, double-book rejection, next-open-date suggestion | `api/bookings.js` (POST) |
| Drop-off check-in by 6-digit code → releases deposit row, flips reservations to processing, emails every share buyer | `api/check-in.js` |
| Buyer cut sheets rendered against the processor's own cut/upcharge config | `api/cut-sheets.js`, `cut-sheet.html` |
| Stripe Connect onboarding, live balance, transfer to bank | `api/connect-onboarding.js`, `api/payouts.js` |
| Public plant profile at `/p/:slug` | `api/processors.js`, `vercel.json` rewrite |
| 20 automated lifecycle emails + daily cron sweep | `api/_lib/email.js`, `api/email-tick.js` |
| Notification inbox + web push | `api/notifications.js` |
| Subscription billing: Checkout, 14-day trial, portal, cancel-at-period-end | `api/processor-subscription.js`, `api/stripe-webhook.js` |
| Ops queue read path — today / week / month / inbox / cooler / earnings | `api/processor-ops.js` |

## Building — now → Sept 2026

Ranked by how much they hurt a real plant today.

1. **Floor workflow actions.** `po-api.js` calls `PATCH /api/bookings`, which **does
   not exist** — `api/bookings.js` handles GET and POST only. Every action button in
   `processor-ops.html` (log weight, start fabrication, mark ready, picked up) 405s.
   `bookings.status` therefore dead-ends at `checked-in`, so the "ready" view is
   permanently empty. **This one endpoint is the single largest gap in the product.**
2. **Schedule + fee pages load what was saved.** Both are write-only; a processor
   sees defaults on every visit (`processor-schedule.html:409` hardcodes the week).
3. **Daily capacity the processor controls.** `bookings.js` reads
   `capabilities.daily_capacity`, which no UI writes — every plant is capped at one
   animal per day. `processor-pricing.html` sends `booking.capacity_per_day`, a
   different key, and it's dropped by the allow-list anyway.
4. **Cut sheet accept/reject.** `api/cut-sheets.js` has no PATCH; status is only ever
   `submitted`, so the inbox never clears.
5. **Credential docs persist.** `credentials_docs` is PATCHed by the UI but is absent
   from both the `processors.js` allow-list and `migrate.js` — silently discarded.
   `upload.js` also rejects PDFs while the input advertises them.
6. **`processor-config.html` is dead.** It reads user id from `/api/config`, which
   returns only `{mapsKey, geminiAvailable}` — always renders "no processor on your
   account." Should call `/api/auth/me` like `processor-checkin.html` does.
7. **`capabilities` column collision.** Config writes `{species, cutOptions, …}`,
   schedule writes `{beef:[…], pork:[…]}` — same column, last save clobbers the other.

## Next — Q4 2026

- Staff seats, invitable and revocable (Standard 5 / Premium 25). No seats table exists.
- Multi-location (Premium). No location table; `processor-ops.js` hardcodes `LIMIT 1`.
- Analytics + CSV/Excel export (Premium). Only `admin-analytics.js` exists, admin-gated.
- Processor replies to reviews. `api/reviews.js` has zero frontend callers today.
- **Tier entitlements actually enforced.** Nothing outside `processor-subscription.js`
  reads `processor_subscriptions`. Needs grandfathering — every processor is on Free.
- **Real deposit money movement.** `farmer_deposits` is bookkeeping only: no
  PaymentIntent, hold, capture or refund. Nothing pays the processor on a no-show,
  though `/faq` says it does.

## Later — 2027

- Public API (Premium). No api_key table, no token auth, no public surface.
- Camera QR scanning. Nothing in the repo touches a camera; the code is typed today.
- Geographic exclusivity slots — premium listing radius, from the marketplace roadmap.

## Claims corrected on 24 Jul 2026

The pricing page and FAQ were selling several things that don't exist. Fixed rather
than left to be discovered by a paying processor:

| Claim | Reality | Action |
|---|---|---|
| "52 templates" | 20 in the registry | Corrected to 20 on both pages |
| "Scan their booking QR code" | 6-digit code typed by hand | Reworded; camera scan moved to 2027 |
| Staff seats / multi-location / API / analytics-export | No code | Kept as tier differentiators, tagged with ship quarters |

Anything still promised without code is listed under Next or Later above — the
roadmap is now where unbuilt promises live, instead of the feature list.
