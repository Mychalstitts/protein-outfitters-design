# Processor SaaS — Roadmap

Source of truth for the roadmap published at `/processor-saas`. Rewritten 24 Jul 2026
after an audit-and-fix pass. Pair with `docs/10 Pricing — Source of Truth.md`.

Rule: nothing moves into **Shipped** on the public page until a processor can do it
end to end in production. Mockups with hardcoded data stay in **Building**.

## Shipped — live today

| Capability | Where it lives |
|---|---|
| Booking intake, double-book rejection, next-open-date suggestion | `api/bookings.js` POST |
| Drop-off check-in by 6-digit code → releases deposit, moves reservations to processing, emails every share buyer | `api/check-in.js` |
| **Plant-floor workflow: log weight → fabricating → ready → picked-up** | `api/bookings.js` PATCH *(new)* |
| **Hours, capacity and fees round-trip; plant sets its own animals-per-day** | `processor-schedule.html`, `processor-pricing.html` *(new)* |
| **Cut sheet accept / reject** | `api/cut-sheets.js` PATCH *(new)* |
| **Credential documents persist, PDFs accepted** | `api/processors.js`, `api/farms.js`, `api/upload.js` *(new)* |
| Buyer cut sheets rendered against the processor's own config | `api/cut-sheets.js`, `cut-sheet.html` |
| Stripe Connect onboarding, live balance, transfer to bank | `api/connect-onboarding.js`, `api/payouts.js` |
| Public plant profile at `/p/:slug` | `api/processors.js` |
| 20 automated lifecycle emails + daily cron | `api/_lib/email.js`, `api/email-tick.js` |
| Notification inbox + web push | `api/notifications.js` |
| **Billing dashboard reads real subscription state** | `processor-saas.html` → `GET /api/processor-subscription` *(new)* |
| Subscription billing: Checkout, 14-day trial, portal, cancel-at-period-end | `api/processor-subscription.js` |

## Building — now → Oct 2026

1. **Per-share pickup close-out.** A whole steer splits four ways; the ops queue
   currently closes the booking and offers one confirmation for all shares. Each
   buyer should be closed individually, which is what fires their own C19
   complaint-window email at the right moment.
2. **Invoice history in-app.** Needs `GET /api/processor-subscription?invoices=1`
   proxying `stripe.invoices.list`. Today the page honestly points at the portal.
3. **Utilization reporting** in the ops dashboard. The fake "43% utilization" tile
   was removed rather than left lying.
4. **Volume caps enforced.** Free 4 animals/mo, Standard 50 animals/mo, Premium
   unlimited (decided 25 Jul 2026 — the 50 ceiling is the upgrade trigger). Today
   `api/bookings.js` counts nothing against a tier, so both caps are contractual
   rather than technical. Every processor is on Free, so enforcement needs
   grandfathering before it is switched on. The count should be animals with a
   drop-off date in the calendar month, excluding cancelled and rejected — the
   same basis the billing page already displays.

## Next — Q4 2026 → 2027

- Staff seats, invitable and revocable (Standard 5 / Premium 25). No seats table exists.
- Multi-location (Premium). No location table; `processor-ops.js` scopes to one plant.
- Analytics + CSV/Excel export (Premium). Only `admin-analytics.js` exists, admin-gated.
- Processor replies to reviews. `api/reviews.js` still has no frontend caller.
- Real deposit money movement. `farmer_deposits` is bookkeeping only — no
  PaymentIntent, hold, capture or refund. Nothing actually pays the processor on a
  no-show, though the FAQ says it does. **This is a promise attached to money.**
- Public API (Premium). No api_key table, no token auth.
- Camera QR scanning. Nothing in the repo touches a camera; codes are typed.

## What the fix pass changed (24 Jul 2026)

Built: `PATCH /api/bookings` (the endpoint `po-api.js` had been calling into a 405
since it was written, which 405'd every floor-workflow button); `PATCH /api/cut-sheets`;
load paths on all three processor config pages; the live billing view.

Fixed: `processor-config.html` read the signed-in user from `/api/config`, which
never returned one — the page always said "no processor on your account".
`capabilities` was written by three pages with colliding key shapes, so the last
save wiped the others; jsonb columns now merge, with explicit `<col>__unset` for
deletions. `daily_capacity` was read by the booking capacity guard but written by
no page, capping every plant at one animal a day. `processor-pricing.html`
substituted its own suggested prices for blank fields and saved them as the
operator's real fees, including `per_lb_fees.processing`, which prices customer
checkouts. `credentials_docs` was PATCHed by the UI, absent from both allow-lists
and the schema, and silently discarded. `upload.js` rejected the PDFs its own file
input advertised. The ops scanner faked a successful check-in on any tap.

Also corrected: `migrate.js` had a missing comma that turned the statement array
into a tagged template — the whole migration endpoint threw before running a single
statement. `bookings` status CHECK was widened to the full floor sequence, and
`cut_sheets` / `credentials_docs` / `processors.address` and friends were declared;
several existed in production only because someone had made them by hand.

## Known residuals — deliberately not fixed

1. **`email_log.dedup_key` has an index, not a unique constraint.** Dedup is
   read-then-insert, so two truly concurrent senders can both pass. The common
   double-tap route is now closed structurally — every booking status write is
   conditional on the status that was read, so the loser writes nothing and sends
   nothing. Closing the rest means reworking the email claim protocol (insert-to-claim
   with `ON CONFLICT`), and a wrong move there breaks *all* transactional email.
   Worth doing deliberately, not in passing.
2. **Cancelling mid-process leaves buyers uninformed.** A booking cancelled after
   check-in leaves reservations at `processing`; buyers who got "your animal
   arrived" hear nothing further. Cancelling a paid share is a refund decision and
   belongs in `/api/reservations`, not in a plant-floor button.
3. **Legacy jsonb keys linger.** `per_lb_fees.smoking` / `vacuum_seal` and
   `capabilities.cutOptions` sit beside their canonical twins. Every reader is
   canonical-first with a legacy fallback, so nothing is broken; a one-off cleanup
   migration would be tidier than carrying the fallbacks forever.
