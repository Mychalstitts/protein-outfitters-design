# Protein Outfitters — Pre-Launch Compliance Brief
*Pre-read for May 6 insurance/regulatory counsel call. Updated May 3, 2026.*

## What this document is
A working map of every regulatory surface the Protein Outfitters platform touches, with severity flags, current state, and the questions counsel needs to answer. Not legal advice. Source of truth for "what could block launch."

---

## 1 · Food safety & meat handling — RED (launch-blocking)

### USDA / FSIS — federal meat inspection
- **Surface:** Every animal sold for human consumption that crosses state lines must be slaughtered at a USDA-inspected plant. Plants on the platform must hold a current Grant of Inspection.
- **Current state:** All processor partners we've onboarded are USDA-inspected. No state-only "Talmadge-Aiken" or custom-exempt processors are listed.
- **Risk vector:** A producer ships an animal to a custom-exempt plant and a buyer is in a different state. Federal violation; PO is the listing platform.
- **Mitigation in code:** Processor record has `inspectionType: 'USDA' | 'state' | 'custom-exempt'`. The marketplace UI hides custom-exempt processors from cross-state listings. Need to verify this enforcement is in `bookProcessor` Cloud Function.
- **Counsel question:** Is the platform a "responsible connection" under FMIA? Do we need our own FSIS registration for selling listings of inspected products?

### State Department of Agriculture (MN, WI, ND, SD)
- **Surface:** Each state has a meat inspection arm. State-inspected plants can sell within state. MN has Equal-To status with USDA, allowing some interstate.
- **Counsel question:** Confirm Equal-To shipping rules for MN-inspected plants — what disclosure is required to the buyer?

### FDA — labeling, packaging, allergens
- **Surface:** Custom-cut packages need processor's establishment number, weight, and (for retail) nutritional facts.
- **Current state:** The cut sheet UI captures customer's labeling preferences. The processor handles the actual label.
- **Counsel question:** When PO ships finished cuts (vs. processor pickup), does PO become a "distributor" with its own labeling obligations?

### State cottage food / direct-from-farm exemptions
- **Out of scope:** PO doesn't list raw milk, raw eggs, or other cottage-food categories. Don't open this door without counsel.

---

## 2 · Payments & financial services — RED (launch-blocking)

### Stripe Connect — marketplace status
- **Surface:** PO is a "marketplace" under Stripe's classification. Every processor and producer needs a Connected Account (Express or Custom).
- **Current state:** Stripe Connect is wired into Cloud Functions. KYC is handled by Stripe. PO holds funds briefly in transit.
- **Counsel question:** Confirm we are NOT a Money Services Business (MSB) under FinCEN. Stripe's marketplace flow is purpose-built to keep us out of MSB territory, but we should have a written opinion on file.

### Insurance pool — the open question
- **Surface:** Every purchase carries a small fee that goes into a pool. The pool pays out to buyers when USDA condemnation or processor-caused loss occurs.
- **Risk vector:** State insurance regulators may classify this as unauthorized insurance. Triggers vary by state — Texas, NY, CA are aggressive.
- **Open questions for May 6 call:**
  1. Custodial account vs. deferred liability vs. self-insurance retention?
  2. Need a third-party trustee?
  3. State-by-state surplus lines triggers — at what claim size does this become "selling insurance"?
  4. Do we need a captive insurance entity (e.g., Vermont LLC) before any state crosses a threshold?
  5. What disclosure language goes in the buyer's purchase confirmation?

### PCI-DSS
- **Current state:** Stripe Elements handles all card data. PO never touches PAN. SAQ-A applies.
- **Action:** File annual self-assessment. Keep Stripe webhook signatures verified.

### Chargebacks
- **Current state:** `acceptChargeback` and `submitChargebackEvidence` Cloud Functions exist. Need an SOP for which path to take per dispute reason code (4853 vs 4855 vs 4863).
- **Counsel question:** Recommended evidence package for "merchandise quality" disputes (the most likely PO category).

---

## 3 · Marketplace law — YELLOW

### CDA Section 230 — third-party content
- **Surface:** Producer-written animal descriptions, photos, lineage claims. PO is a platform, not a publisher — Section 230 protects us, but only if we don't materially edit content.
- **Mitigation:** Add a producer-facing TOS clause that they own and warrant their listing content.

### Lanham Act / FTC — "grass-fed," "organic," "regenerative"
- **Surface:** Marketing claims on listings. "Organic" requires USDA NOP certification. "Grass-fed" has FTC guidance but no federal standard since USDA withdrew theirs in 2016.
- **Risk vector:** A producer claims "100% grass-fed" without proof; a buyer sues PO and producer.
- **Mitigation:** Each claim term in the listing builder must be either tied to a verifiable certification (USDA Organic, AGA Grass-Fed) OR carry a disclaimer that it's the producer's claim.
- **Action item:** Audit current `/listing` page for unsubstantiated claims.

### Resale & secondary market
- **Out of scope at launch:** No buyer-to-buyer resale. Fraction shares cannot be transferred. Lock this in TOS.

---

## 4 · Privacy & data — YELLOW

### CCPA / CPRA (California buyers)
- **Surface:** PO will likely cross 100k CA consumer threshold within 12 months of launch.
- **Current state:** Privacy policy exists at /privacy on the marketplace. Not yet audited against CPRA.
- **Action:** Privacy policy refresh before crossing threshold. Add do-not-sell toggle on /account.

### GDPR (EU buyers)
- **Out of scope:** No EU shipping, no EU-targeted marketing. Add geo-block on signup if traffic appears.

### COPPA
- **Mitigation:** TOS requires age 18+. Klaviyo welcome flow should re-confirm.

### Klaviyo + email
- **CAN-SPAM:** Every template includes `{% unsubscribe %}` and physical address. Confirmed in templates created today.

---

## 5 · Tax — YELLOW (CPA call May 7)

### Sales tax
- **Surface:** Most states tax retail meat purchases. Some have grocery exemptions (MN: yes). Marketplace facilitator laws (in 45 states) make PO the collector, not the producer.
- **Action:** Stripe Tax or TaxJar integration before launch. Don't build this ourselves.

### 1099-K
- **Surface:** Each producer/processor gets a Stripe-issued 1099-K. Threshold dropping to $5,000 in 2025, $2,500 in 2026.
- **Current state:** Stripe handles. Confirm payee fields are captured at Connect onboarding.

### Insurance pool tax treatment
- **Counsel question:** See May 7 CPA event description for the full list.

---

## 6 · Liability — YELLOW

### Product liability (foodborne illness)
- **Surface:** Buyer gets sick from a listed product. Strict liability applies to anyone in the chain of distribution.
- **Mitigation:** TOS limitation of liability + indemnification from producers and processors. Carry product liability insurance — minimum $2M aggregate.
- **Open:** Get producer indemnification language reviewed by counsel.

### Animal welfare
- **Surface:** Farm visit / harvest conditions claims. Activist litigation risk.
- **Mitigation:** Don't make humane-handling claims that aren't audited (e.g., GAP step-rated). Site-visit reports must be factual, not promotional.

---

## 7 · Hardware (Friesla MPU) — GREEN

- **Surface:** Lead capture only. No equipment financing or sale yet.
- **Trigger to revisit:** When we accept payment for an MPU, this becomes equipment finance + commercial lease + UCC filings + state contractor licensing.

---

## Severity legend
- **RED** — Launch-blocking. Cannot go live without resolution.
- **YELLOW** — Resolve in first 90 days post-launch.
- **GREEN** — Backlog, monitor.

## Bring to the May 6 call
1. This document.
2. Stripe Connect platform agreement (export from Stripe Dashboard).
3. Current TOS draft (if it exists; if not, that's a finding).
4. Insurance pool spec from `/16 Implementation Summary v3.md`.
5. List of processor partners with inspection types.

## Bring to the May 7 call
1. This document, sections 2 and 5.
2. Stripe payout sample report.
3. Firestore schema for `shares`, `bookings`, `donations`, `insurancePool`.
4. Donation Cloud Function spec.
