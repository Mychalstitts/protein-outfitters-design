# Protein Outfitters — Roadmap
*Now / Next / Later. Updated May 3, 2026.*

## Now — ship in the next 14 days

### LAUNCH-BLOCKING ENGINEERING (~9 dev-days)
- **Wire Cloud Functions to React app** — `createShare`, `bookProcessor`, `processorCheckIn`, `donateFraction`, `submitHardwareLead`, `stripeWebhook`. Spec exists. Pickup plan in file 23.
- **Deploy Firestore rules** — `firestore-rules-additions.txt` to prod. Audit for over-permissive reads.
- **Stripe Connect onboarding flow** — Producer + processor accounts. Test with Stripe Test mode before live.
- **QR check-in plumbing** — Issue token → display → scan. Already in TSX scaffold; needs route wiring.
- **Klaviyo trigger events** — Fire `Reservation Confirmed`, `Drop-off Window Opens` from Cloud Functions. Templates already created (TKiLur, SfnUcZ, TMV2Fi).
- **Sales tax** — Stripe Tax integration. Don't ship without this.

### LAUNCH-BLOCKING LEGAL (May 6 + May 7 calls)
- Insurance pool legal structure — outcome of May 6 call.
- TOS + Privacy Policy refresh — counsel-reviewed before first paid transaction.
- Producer + Processor agreements — counsel-reviewed templates.
- Sales tax position — outcome of May 7 call.

### LAUNCH READINESS
- [ ] Brand mark decision (May 4 — see /deploy/brand.html for Option B).
- [ ] OG image meta tags on every deployed page.
- [ ] Production Firebase project — separate from dev.
- [ ] Sentry or equivalent error tracking on the React app + Cloud Functions.
- [ ] One end-to-end test with a real animal, real producer, real processor. Synthetic, not for sale.

---

## Next — 30 to 90 days post-launch

### PRODUCT
- **Cut sheet v2** — animal-aware branching is currently hard-coded. Move to a config-driven model so adding lamb/venison/poultry templates is an admin task, not a deploy.
- **Producer dashboard self-serve** — current dashboard is read-only. Producers need to create new listings, edit availability, mark animals as harvested.
- **Processor capacity calendar** — currently free-text scheduling. Move to slot-based booking with explicit capacity limits per day.
- **Ratings & reviews** — buyer leaves a rating after pickup. Fuel for marketplace trust.

### MARKETPLACE GROWTH
- **Producer acquisition** — Apollo prospecting list of MN/WI/ND/SD ranches. Outbound sequence in Apollo. Goal: 12 paying producers in 60 days.
- **Buyer acquisition** — Klaviyo drip + paid social (Meta + Google) to local zip codes. Goal: 50 paying buyers in 60 days.
- **Friesla MPU storefront** — convert /hardware lead form into actual sale flow once the legal/finance side is reviewed (currently GREEN in compliance brief).

### OPERATIONS
- **Processor onboarding runbook** — see `/docs/02 Processor Onboarding Runbook.md`.
- **Dispute SOP** — playbook for the 4 chargeback reason codes most likely to hit. Tied to `acceptChargeback` / `submitChargebackEvidence` functions.
- **Site visit cadence** — every processor visited once per quarter. Use the existing /site-visit Stitch screen as the reporting template.

### INFRASTRUCTURE
- **48 more Klaviyo templates** — order shipped, ready for pickup, post-purchase nurture, processor SaaS dunning, donation tax letter, hardware lead nurture, win-back, etc. (Spec in file 16.)
- **Privacy policy CPRA refresh** — before crossing 100k CA consumer threshold.
- **Sentry → Slack alerts** — for any 5xx in Cloud Functions.

---

## Later — beyond 90 days

### PRODUCT EXPANSION
- **B2B wholesale** — restaurants and grocery stores buying full animals. Different TOS, different pricing, different cut sheet.
- **Subscription** — "monthly mystery box" of cuts from rotating producers. Different reservation model.
- **Lamb, venison, poultry depth** — currently the marketplace skews beef-heavy. Add breed-specific imagery and cut sheet templates.
- **Producer Partnership 501(c)(3)** — currently the donation flow donates to a placeholder. Stand up the actual nonprofit entity. CPA-led.

### PLATFORM EXPANSION
- **Multi-state rollout** — start with MN core. Iowa, Nebraska, Wisconsin next. Each state needs sales tax + meat inspection mapping.
- **Friesla MPU sale flow** — full equipment finance + lease + state contractor licensing. Trigger from compliance section 7.
- **Captive insurance entity** — if any state crosses the surplus-lines threshold (counsel determines).

### MOATS
- **Producer reputation graph** — multi-listing producers with consistent ratings become the brand. Surface this on /producers.
- **Cut sheet AI** — buyer takes a photo of their freezer and PO suggests an optimal cut sheet for their cooking style.
- **Geographic exclusivity tiers** — premium listing slots within a 25-mile radius. SaaS upsell for processors.

---

## Out of scope (don't build)
- **Live animal trading** — buyer buys the live cow, takes possession. Different regulatory regime (livestock auction). Not what PO does.
- **Vegan / lab-grown** — different brand, different category. PO is for ranchers and the people who eat what ranchers raise.
- **International shipping** — adds CITES, country-of-origin labeling, customs. Not within 12 months.

## Decisions made this cycle
- ✅ Verdant Monolith design system (locked May 2026).
- ✅ Tesla 3-tap reserve flow (locked May 2026).
- ✅ Insurance pool model (mechanism agreed; legal structure pending May 6 call).
- ✅ First-purchaser locks processor pattern (locked).
- ✅ 23 designed screens deployed; brand mark pending May 4.
