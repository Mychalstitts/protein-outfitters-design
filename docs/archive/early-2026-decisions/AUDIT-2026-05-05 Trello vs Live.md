# Trello vs. Live — Coverage Audit

**Date:** May 5, 2026
**Author:** Claude (Cowork)
**Sources:** Trello board `Protein Outfitters` (b/6WWCWSp0), live deploy at `proteinoutfitters.com`, deploy/ folder, db/schema.sql

---

## TL;DR

| Bucket | Captured in code/UI | Scaffolded in spec only | Trello wishlist |
|---|---:|---:|---:|
| Reserve & Customize | 12 | 0 | 0 |
| Cut sheet | 9 | 1 (processor.cutOptions read) | 2 |
| Refund/cancel/condemnation | 5 | 6 | 1 |
| Lifecycle emails | 0 (templates done, ESP unwired) | 22 customer + 23 farmer/processor | 1 ESP decision |
| Processor ops (queue, QR, deposit) | 2 (HTML stubs) | 4 (real impl) | 0 |
| Disputes / chargebacks | 0 | 1 (admin view) | 1 (playbook) |
| Donations | 4 (page + API + schema) | 4 (deed PDF, tax PDF, ledger, institution side) | 1 (this revamp) |
| Hardware | 1 (full page live) | 3 (lead scoring, CRM webhook, Calendly embed) | 1 (photoshoot) |
| Bugs | resolved 5, open 18 | 0 | 0 |
| Policy decisions | 1 of 30 locked | 0 | 29 |

**Headline:** Most of the user-facing pages exist, but the connective tissue (ESP wiring, Stripe split routing, processor config dashboard, institution side of donations, chargeback admin, lead scoring) is still in spec docs.

---

## ✅ DEPLOYED & WORKING

### Pages
- `/` (master index)
- `/reserve-flow` — 4-step flow scaffolding (step-1, step-2, step-4 sections present)
- `/cut-sheet` — two-tier UI, animal-aware branching, presets, CSR box, organs/offal toggles, skip-to-processor's-choice
- `/listing` — fraction selector, inherit-processor logic
- `/checkout` — buyer flow shell
- `/farmer` — empty-state dashboard (real DB)
- `/processor` — empty-state dashboard, Activity feed hidden
- `/processor-ops` — queue scaffolding
- `/processor-schedule` — schedule scaffolding
- `/processor-pricing`, `/processor-saas` — pricing + billing dashboard scaffolding
- `/admin-overview` — real DB counts + Stripe balance + recent payments + edge timeout-resilient
- `/finance` — wired to /api/admin-metrics
- `/hardware` — Tesla-Energy flow, real photography, integration thesis (10K→2,300), zero Friesla branding
- `/donation-flow` — farmer side, confirm sheet, tax letter preview, admin queue, impact dashboard
- `/discover`, `/map`, `/producers`, `/farm-profile`
- `/admin-fsis-import`, `/admin-ams-import` — partner discovery
- `/invite-partner`

### API endpoints (Edge runtime, Neon Postgres)
`/api/{admin-metrics, ams-import, apollo-import, checkout, concierge, config, discover-nearby, donations, eatwild-import, farms, fsis-import, ics, invite-partner, listing, listings, migrate, parse-search, processors, reservations, reviews, seed-processors-from-fsis, stripe-webhook, upload}`

### Schema (Neon)
`users, auth_tokens, sessions, farms, listings, reservations, processors, reviews, donations, saved_searches`

### Trello cards confirmed shipped
- Reserve & Customize 4-step flow ✅
- Animal-aware cut sheet branching ✅
- Smart-default cut sheet presets ✅
- CSR free-text on cut sheet ✅
- Organs/offal toggles ✅
- Skip → Processor's Choice button ✅
- Front/Hind quarter sub-toggle ✅
- Inherit-processor logic ✅
- Donations table + /api/donations ✅
- Stripe customization ✅
- Login flows (http_only cookie tokens) ✅
- Search improvements ✅
- Make prices show 2 decimals on FE ✅
- DB fill script ✅
- 422s show payload + error ✅
- Cutsheet redirect ✅
- Calendar view for processor (`/processor-schedule`) ✅
- Pig cut sheet ✅
- Start/end dates on listings ✅
- Add blackout dates to UI ✅
- Pie chart → status bar ✅
- Processor profile changes ✅
- Processor market ✅

---

## 🟡 SCAFFOLDED IN SPECS BUT NOT WIRED

### Processor operations (spec 10)
- **Processor Queue View (Outlook-style)** — TSX exists (`ProcessorQueueScreen.tsx`), HTML page exists at `/processor-ops` but not connected to real bookings. Admin see of all daily flow.
- **QR check-in (processor-only)** — TSX (`CheckInScannerScreen.tsx`) + Cloud Function spec. Replaces farmer self-report. **Not deployed.**
- **Dropoff deposit** — `bookProcessor()` Cloud Function spec, deposit table in spec. **Not deployed; static schema doesn't have deposits table yet.**
- **Auto-flag farmer no-show** — Firestore trigger spec. **Not deployed (also we're on Postgres, not Firestore — this needs translation).**

### Disputes / chargebacks (spec 09)
- **Disputes admin view** — TSX (`DisputesAdminScreen.tsx`) + Cloud Functions spec'd. Static prototype at `/admin` redirects to `/admin-overview` which doesn't have disputes yet.
- **Chargeback evidence packet builder** — spec'd, not built.
- **Stripe webhook handlers for `charge.dispute.*`** — `/api/stripe-webhook.js` exists but doesn't handle dispute events yet (verify).

### Cut sheet hardening
- **Processor config dashboard** — Per-processor cut options, smoking, grinding, upcharges. Not built.
- **Cut sheet reads `processor.cutOptions`** — Currently still hard-coded list.
- **Cut detail modal with photo + cooking method + recipe** — Trello says photos + recipe link missing.
- **Cut sheet AI for description from attributes** — Bug column.

### Refund / condemnation
- **Card-decline cascade at T-7 balance capture** — spec'd, not enforced.
- **Customer-facing refund timeline visualization** — spec'd, not built.
- **Quality complaint flow (7-day post-delivery)** — spec'd, not built.
- **Optional condemnation insurance pool 2% checkbox** — spec'd, not in checkout.
- **Pool transparency widget on /policies/refunds** — spec'd, no /policies page.
- **Pool admin tile on dashboard** — spec'd, not built.
- **Ante-mortem condemnation handling variant** — spec'd (emails A1/A2/A3 in file 12), not deployed.

### Donations (this is what we're reworking now)
- **Deed of Gift PDF generator** — preview shown in HTML, no real PDF.
- **Tax letter PDF generator with EIN lookup** — preview shown in HTML, no real PDF.
- **Donation funding ledger** — schema doesn't model grants/sponsors/individual donations yet.
- **Institution onboarding/qualification side** — **MISSING ENTIRELY.** This is the rework.

### Lifecycle emails (specs 05, 06)
- **22 customer email templates** — written, ESP unwired.
- **23 farmer/processor email templates** — written, ESP unwired.
- **State-machine → email trigger map** — spec'd, not coded.
- **ESP integration (Klaviyo / Postmark / Customer.io)** — Trello policy decision still open.

### Stripe
- **Stripe split routing** (farmer / processor / platform / shipping) — Bug card. Not wired.
- **Stripe Subscriptions + Customer Portal** for processor SaaS — Trello says scaffolded but not deployed.
- **Stripe webhook secret** — env var still missing (per audit v3).

### Hardware
- **Lead scoring** (existing facility + timeline + financing + bundle)
- **CRM webhook** (HubSpot/Pipedrive)
- **Calendly inline embed on /hardware/scheduled** — currently just a `mailto:`

---

## 🔴 NOT BUILT (bug + feature carryover from Trello)

### Bugs
- Login issues (still on board)
- Saving processor config which animals and prices
- Booking conflict with existing booking 1 of type animal_dropoff
- "Make it so animal has processor and their address on that"
- "Purchases above cart above search"
- Make submit on cut sheets automatic
- AI for description from attributes
- Add "feed type" and "subbreed" to animal
- Steer vs heffer vs bull selector
- Add ratings (reviews exist, but no rating UI on listing tiles)
- Make animal tiles smaller/sleeker
- FAQ page
- Icons on "tell us who you are" picker
- CSS animation polish
- Emojis on "I am a farmer/processor/customer" cards
- Affiliate links
- **Fix processing-fee math** — currently $120 placeholder, should be hanging-weight × $0.90/lb + kill fee, allocated by fraction
- **"Live Weight Purchase" label uses dressed-weight math** — relabel or fix the calc

### Features (Trello)
- Notifications — make links work
- Beef cut sheet pictures (real photos)
- Remove purchase options from view of animal if 100% sold
- "ABS — animals on home page" (decode this with James)
- Customer-by-default if coming from buying-an-animal flow
- Remove "Available Animals" section from farmer dashboard
- Voice features (DeepFilterNet, PlayHT) — phase 2
- Sameday.ai integration eval
- Photography shoot for master site (~$2-4k budget — hardware now done, rest pending)
- Add "outside scheduled animal" (todo column)
- Referral link for signup (todo column)
- mamponline.com / aamp directory scrape (scrape column)

---

## 🔴 SECURITY GAP

**Lights On column** still shows the sameday.ai credentials in plaintext:
```
https://app.sameday.ai/ user: pruhland@watscoventures.com password: Haggarty86
```

That's a third-party email + password sitting on a board with multiple members. Move to 1Password/Bitwarden, replace card content with vault link, and rotate the password.

---

## 📌 OPEN POLICY DECISIONS (29 of 30)

Trello "For Myke" column is mostly unanswered. The ones that block engineering work:

| # | Decision | Blocks |
|---|---|---|
| 1 | Deposit % — 25% locked or per-farmer configurable? | Reservation flow |
| 2 | First-purchaser locks processor — confirm or build override? | Step 2 flow |
| 3 | Free-cancel window — 21 days from drop-off? | Refund state machine |
| 4 | Condemnation insurance — 2% of share or flat $50? | Pool implementation |
| 5 | Quality complaint window — 7 days post-delivery? | Complaint flow |
| 6 | Tier-1 rep credit cap — $250? | Support ops |
| 7 | Pool starting reserve — $25k seed? | Treasury |
| 8 | Dispute jurisdiction — Beltrami County MN? | Terms of Service |
| 9 | ESP — Klaviyo / Postmark / Customer.io? | Lifecycle email wiring |
| 10 | Pool default ON or OFF at checkout? | Checkout UI |
| 11 | Pool legal structure — operating reserve / captive cell / reinsurance? | Treasury + Legal |
| 12 | Dropoff deposit default — $100 flat or 10% (whichever greater)? | Processor ops |
| 13 | Allow processors to raise deposit per-slot, capped at $300? | Processor ops |
| 14 | QR medium — digital default + optional printed? | Processor ops |
| 15 | 6-digit fallback for desktop processors? | Processor ops |
| 16 | Deposit escrow — platform-held or Stripe Connect? | Stripe routing |
| 17 | SaaS prices — $79/$199 annual, $99/$249 monthly? | Processor SaaS launch |
| 18 | Free tier booking cap — 4/month? | SaaS gating |
| 19 | First-25-processors lifetime $49/mo discount? | Launch promo |
| 20 | Donation: partner with Producer Partnership directly OR set up MN sister 501(c)(3)? | Donation legal |
| 21 | Default cut sheet for donated fractions — 100% ground? | Donation flow |
| 22 | MPU prices $145k/$85k/$65k — confirm? | (No — replaced w/ "Quote on request" already, so this is closed) |
| 23 | Full Pipeline bundle 12% off? | Hardware (n/a now) |
| 24 | CRM choice — HubSpot / Pipedrive / Salesforce? | Hardware leads |
| 25 | Calendly account for sales calls? | Hardware booking |
| 26 | Financing partner pre-vet list (USDA FSA, Compeer, Stearns)? | Hardware sales |
| 27 | Freemium cutsheets? | SaaS pricing |
| 28 | How to make money without farmers/customers (chicken-egg)? | Strategy |
| 29 | Additional info for farmers and processor? | Onboarding |

---

## 🎯 WHAT WE'RE FIXING THIS SESSION

1. **/donation-flow rework** — depot model: donors get tax form, qualified institutions (schools, government, food banks) register and request. Adding "Apply as institution" + "Institution dashboard" tabs.

## 🎯 WHAT BELONGS NEXT (proposed sprint order)

1. Fix processing-fee math + Live Weight Purchase label (Bugs — affects every checkout calculation, easy win)
2. Wire ESP (decide #9 first) and trigger 22+23 lifecycle emails
3. Stripe split routing — without this, money flow doesn't work
4. Processor config dashboard → cut sheet reads it (Trello changing-functionality #2)
5. Disputes admin view → Stripe webhook for `charge.dispute.*`
6. Dropoff deposit table + processor-only QR check-in (deposits need Postgres translation from Firestore spec)
7. Institution side of donations (this session covers the UI; backend still needs work)
8. Hardware lead scoring + CRM webhook + Calendly embed
9. Photography shoot for master site (rest of pages still on placeholder gradients)
10. Farmer reputation / strike system (after deposit is in)
