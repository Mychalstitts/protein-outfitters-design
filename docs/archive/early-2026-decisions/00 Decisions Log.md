# Decisions Log — Locked

_Captured May 3, 2026, by Mychal Stittsworth via walkthrough with Claude (Cowork session)._

This is the authoritative answer to every "For Myke" decision card on the Trello board as of today. All spec docs in this folder defer to these answers. If a decision changes, update this file first; spec docs follow.

---

## Refund & cancellation policy

| # | Decision | Locked answer | Source spec |
|---|---|---|---|
| 1 | Free-cancel window before drop-off | **21 days** (full refund inside this window) | 04 Refund Policy §3 |
| 2 | Deposit % | **25% locked platform-wide** (no per-farmer config) | 04 Refund Policy §3 |
| 3 | Quality complaint window after delivery | **7 days** | 04 Refund Policy §6 |
| 4 | Customer cancels inside no-refund window (1–7 days) | **Three alternatives offered**: pickup at processor / ship-and-donate-with-tax-letter / transfer to friend | 04 Refund Policy §6, customer email 10 |
| 5 | Tier-1 support rep discretion cap | **$250 platform credit** (above that, escalate) | 04 Refund Policy §11 |
| 6 | Default dispute jurisdiction | **Beltrami County, MN small claims** (mediation first) | 04 Refund Policy §11 |

---

## Condemnation insurance pool

| # | Decision | Locked answer | Source spec |
|---|---|---|---|
| 7 | Pricing model | **2% of share value** (revisit annually after 12 months data) | 07 Pool Spec §8 |
| 8 | Default at checkout | **Default ON, easy uncheck** (clearly disclosed) | 07 Pool Spec §9 |
| 9 | Starting reserve seed | **$25,000** | 07 Pool Spec §3d |
| 10 | Legal structure | **Operating reserve inside Protein Outfitters LLC** (deferred liability on balance sheet, not revenue) | 07 Pool Spec §4 |
| 10a | Required before launch | 30-min insurance lawyer call + CPA accounting memo | 07 Pool Spec §10 |

---

## Reserve & Customize flow + processor lock

| # | Decision | Locked answer | Source spec |
|---|---|---|---|
| 11 | First-purchaser locks processor | **Yes, no override** — subsequent buyers inherit processor + drop-off date | 02 Reserve Flow Spec §10 |

---

## Lifecycle emails

| # | Decision | Locked answer | Source spec |
|---|---|---|---|
| 12 | ESP for all 45 lifecycle templates | **Klaviyo** — bundles transactional + marketing on one customer profile | 05 Customer Emails §implementation, 06 Farmer/Processor Emails §implementation |

---

## Product strategy

| # | Decision | Locked answer | Notes |
|---|---|---|---|
| 13 | Freemium cutsheets | **Free for everyone** | Cut sheet customization is core product, not a feature. Differentiation comes from yield calculator, processor calendar, hardware sales. Don't paywall what competitors do for free. |
| 14 | Early-stage revenue priority | **Processor SaaS subscription** as primary | Charge processors $X/mo for calendar + booking + comms tools. Revenue independent of marketplace volume. Hardware (Friesla MPUs) and donation-flow tax letters are the secondary revenue lines. Listing fees on farmers and paid placement explicitly out of scope. |
| 15 | Producer-Partnership donation flow | **Share Step 1 fraction selector with a "Donate this fraction" toggle** | Reuses 95% of reservation pipeline. Donation goes through same processor scheduling; checkout becomes a tax-letter receipt instead of a customer payment. Keeps marketplace and donation operationally linked. |

---

## What this means for the next sprint

The decisions above unblock everything in the spec docs. Engineering can now build to a fixed target. Open implementation cards in Trello → Features that are now unblocked:

- Reserve & Customize 4-step flow (umbrella card 02)
- Refund state machine + Stripe refund cascade (card from 04)
- Card-decline cascade at T-7 (card from 04)
- Customer-facing refund timeline visualization (card from 04)
- Lifecycle email templates → Klaviyo wiring (cards from 05, 06)
- Condemnation insurance pool: dedicated Stripe account + 2% line item + draw automation (card from 07)
- Public pool transparency widget (card from 07)
- Admin dashboard tile for pool (card from 07)
- Donation toggle on fraction selector (Step 1) — net new card

Still requires external sign-off before code:
- 30-min insurance-lawyer call before pool launches (decision #10a)
- CPA accounting memo for pool deferred-liability treatment

Still requires Mychal product-thinking, not blocked by today's walkthrough:
- Pricing on the processor SaaS subscription (decision #14 set the strategy; the dollar figure is a separate exercise)
- Hardware-sales storefront design (decision #14 affirmed it but didn't scope it)
