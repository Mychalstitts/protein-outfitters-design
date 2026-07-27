# Pricing — Source of Truth

Last reconciled: 24 Jul 2026. If a number appears in two places, this file wins;
fix the other place rather than forking the number.

## Processor SaaS (`/processor-saas`)

| Tier | Monthly | Annual | Free-tier limit |
|---|---|---|---|
| Free | $0 | — | 4 animals/mo · 1 staff seat |
| Standard | **$79/mo** | **$758/yr** ($63/mo, 20% off) | Up to 50 animals/mo · 5 seats |
| Premium | **$199/mo** | **$1,910/yr** ($159/mo, 20% off) | Unlimited animals · 25 seats |

Decision, 24 Jul 2026: $79/$199 are the **monthly list** prices. The earlier
spec (`docs/archive/early-2026-decisions/20 Processor SaaS Spec.md`) proposed
$99/$249 list with $79/$199 as the annual rate — that model is superseded.
Annual is 20% off the monthly rate, rounded to the dollar.

### Stripe (live mode)

Two products, two prices each. Code resolves prices by `lookup_key`, so a
reprice is: create the new price → move the lookup key → archive the old one.
No deploy, no env var edit.

| Lookup key | Amount | Price id |
|---|---|---|
| `po_processor_standard_monthly` | $79/mo | `price_1TwrQpAEMYhoRW98DJZT2Ehh` |
| `po_processor_standard_annual` | $758/yr | `price_1TwrQrAEMYhoRW98CLE5gv0g` |
| `po_processor_premium_monthly` | $199/mo | `price_1TwrQsAEMYhoRW9861FX72Y1` |
| `po_processor_premium_annual` | $1,910/yr | `price_1TwrQuAEMYhoRW98SFyLzp34` |

Products: `prod_Uwkww77wEYHwU8` (Standard), `prod_Uwkwz57RV3l0g1` (Premium).

The four `STRIPE_PRICE_*` env vars still override the lookup keys if set. They
are optional now — leave them unset unless pinning a specific price id.

**Archived 24 Jul 2026** (were live at $49/$499/$149/$1,499, never matched the
page, zero subscriptions attached): products `prod_UWl4fuTSCMwHi8`,
`prod_UWl5UZDWTFrZm7`, `prod_UWl5ctaSFOYVKh`, `prod_UWl5WrZAbVRPr7`.

## Map Insights (`/map`)

| Tier | Price | Stripe product |
|---|---|---|
| Free | $0 | — |
| Pro | $29/mo | `prod_UT9LUecopqZ9Mk` |
| Hardware | $199/mo | `prod_UT9MIGAMqJcsG2` |

Gated in `api/map-data.js` via `users.map_tier`.

## Marketplace fees

| Item | Amount | Stripe product |
|---|---|---|
| Reservation deposit | 10% of est. meat cost, $50–500 cap | `prod_USSVhZDnkZakBC` |
| Processing fee | $225 one-time per reservation | `prod_USSV0Rge5VBkzO` |
| Condemnation insurance pool | $18 one-time | `prod_USSVkS595ofRw5` |

## Hardware (`/hardware`)

MHU from $437,000 · PS-1 from $2.45M · PS-2 from $3.5M · PS-3 from $4.5M ·
consultation $40,000 (credits toward purchase).

## Where these numbers appear

- `deploy/processor-saas.html` — tier cards, compare table, billing sample
- `deploy/processor.html` — "Plan + billing" quick action
- `deploy/api/processor-subscription.js` — lookup keys + checkout
- Stripe live mode
- This file

## Open, not yet resolved

1. **Free-tier cap is not enforced.** `api/bookings.js` has no tier check, so
   "Up to 4 bookings/mo" on Free is marketing copy only. Every processor on the
   platform is currently on Free — switching enforcement on without
   grandfathering would break active plants mid-season.
2. **Founding-25 offer.** `/processor-saas` FAQ promises the first 25
   processors Standard at $49/mo for life. No Stripe price backs it. Either
   create a `po_processor_standard_founding` price at $49/mo or drop the claim.
3. **Hardware bundle.** FAQ promises 12 months of Standard with any Friesla MPU
   ≥ $50k. No coupon or code path exists for it yet.
4. **14-day trial** is set in code (`trial_period_days: 14`) and matches the
   page. Keep them together if either moves.

## Tier limits — decided 25 Jul 2026

Free 4 animals/mo · **Standard up to 50 animals/mo** · Premium unlimited. The
50-animal ceiling is the upgrade trigger: a plant that outgrows Standard moves to
Premium. Standard was briefly published as "unlimited bookings", which left
Premium with no volume story at all. Reflected on `/processor-saas`, in the
compare tables, `/faq`, and both Stripe product descriptions.

**Not yet enforced in software** — see open item 1. Until it is, the 50-animal
cap is a contractual number, not a technical one.
