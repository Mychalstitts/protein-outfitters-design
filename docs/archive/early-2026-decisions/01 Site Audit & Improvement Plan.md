# Protein Outfitters — Site Audit & Improvement Plan

_Author: Claude (Cowork session) · Date: May 3, 2026_

This is a snapshot of the live site (proteinoutfitters.com) compared against the Trello backlog and the Grok project bible, with prioritized opportunities and a recommended workstream.

---

## 1. What's actually live on proteinoutfitters.com

### Landing → Marketplace
Polished, on-brand. Live pricing ticker: Pork $9.25 · Lamb $14.50 · Venison $18.00 · Poultry $4.20 · Beef $13.75/lb. KPI cards: "Active Shares: 12,842 (+12.4% this week)" and "Avg. Price/lb: $13.75 — Beef Live". Search + Map button. Animal-type pill filters (All / Beef / Pork / Lamb / Venison / Poultry). Featured listings.

### Listing detail (sample: Premium Angus Steer #402, Rolling Hills Ranch, Billings MT)
- Hero photo with heart icon + back button
- Black Angus tag · "Premium Angus Steer #402"
- Price per lb: $4.50
- Add to Bag CTA
- Compliance Score 92 — "Excellent · USDA Certified · Grass-Fed · Non-GMO"
- AI Yield Estimator: 1,250 lb live → 750 lb dressed → 563 lb take-home (60% yield)
- Animal Details: Black Angus / Steer / Grain + Grass / Available May 2025
- Customize Cut Sheet CTA

### Cut Sheet
Three sections, +/- counters with starting defaults:
- **Steak Cuts**: Ribeye (1" thickness, default 2), NY Strip (1.25", default 2), Filet Mignon (1.5", default 1)
- **Ground & Stew**: Ground Beef (80/20 lean — 1 lb packs, default 10), Stew Meat (1" cubes — 1 lb packs, default 4)
- **Specialty Cuts** (toggles): Brisket (whole, 8–12 lbs) ON, Short Ribs (3-bone slabs) OFF
- Save Cut Sheet & Continue CTA

### Bag
- Premium Angus Steer #402 line item ($4.50/lb, Remove)
- Order Summary:
  - Subtotal: $3,375.00
  - Platform Fee (3%): $101.25
  - Processing Est.: $120.00
  - Total: $3,596.25
- "Cut sheet saved!" toast
- Proceed to Checkout CTA

### Checkout
- Pre-filled demo data: "Jake Morrison · 142 Prairie Road · Bemidji MN"
- Payment Method: Apple Pay (default) / Credit-Debit Card (Visa, MC, Amex) / ACH Bank Transfer
- Investment Breakdown: Live Weight Purchase $3,375 / Processing Fee $120 / Platform 3% $101.25
- Reserve Now: $3,596.25
- Place Reservation CTA · 256-bit SSL note

---

## 2. Gap analysis vs Trello + Grok bible

| Source | Spec'd | Built? |
|---|---|---|
| Grok bible | Fraction selector (¼ / ½ / Whole on beef; ½/Whole on hog/lamb) | ❌ Missing — only whole animal in Bag |
| Grok bible | "Take Back Unsold Fractions" for farmer | Unknown — gated behind login |
| Grok bible | Processor calendar (Airbnb-style booking + dynamic pricing) | Unknown — gated |
| Grok bible | Hardware catalog (PS1 modular processing units) | Not on public site |
| Grok bible | Admin command center | Hidden |
| Trello "changing functionality" | First Purchaser picks processor → Cutsheet → Pay | ❌ Order is wrong today (animal → cutsheet → pay, no processor pick) |
| Trello "changing functionality" | Custom cutsheets based on processor + fraction | ❌ Cut sheet is generic |
| Trello bug | "make submit on cut sheets automatic" | Currently requires explicit Save |
| Trello bug | Stripe customization | Checkout looks mock — needs Stripe split routing |
| Trello bug | "saving processor config (animals + prices)" | Gated |
| Trello feat | Pig cut sheet | Cut sheet is hard-coded beef |
| Trello feat | Beef cut sheet pictures | ❌ No photos anywhere on cut sheet |
| Trello feat | Notifications make links work | Bell icon shown, behavior unverified |
| Trello corner case | Animal killed and disease found → refund flow | Not in main path |
| Trello corner case | Customer doesn't fill cut sheet → "processor's choice" fallback | Not visible in flow |

---

## 3. What's working well (keep these)

- AI Yield Estimator on listing detail is best-in-class — way ahead of every competitor surveyed
- Compliance Score (92, "Excellent") with badges is a unique trust signal nobody else has
- Live pricing ticker reads like a Bloomberg terminal — strong differentiator
- "Reserve Now" / "Place Reservation" framing fits the marketplace better than "Buy Now"
- Apple Pay default is the right call for one-tap checkout

---

## 4. Patterns from best-in-class competitors

Across Bare Bones Butchering, Half a Cow Club, Friesla's own guide, Lind's Custom Meats, Curly's Custom Meats, and Down Home Processing, seven patterns recur:

1. **Two-tier structure** — top-level "Order Preferences" (roast size, steak thickness, steaks per pack, ground packaging) applied as defaults across the order, then per-sub-primal selection underneath. Yours has no top-level layer.
2. **Sub-primal organization** — cuts are grouped by where they came from (Chuck, Rib, Short Loin, Sirloin, Round, Brisket, Plate, Flank). Yours skips the anatomy and groups by category, which is friendlier but loses the trade-off picture.
3. **Explicit trade-off transparency** — Bare Bones literally tells the customer that picking roasts means less for steaks. Yours hides this entirely.
4. **Fallback default logic** — "Unchecked = butcher's designation (extra ground or steaks)." This is what the Trello "customer doesn't fill cut sheet" corner case asks for.
5. **Customer Special Request free-text box** — every single one has it. Yours doesn't.
6. **Value-added upcharges visible inline** — stew meat +$1/lb, jerky, snack sticks, summer sausage. Yours flattens everything into one $120 "Processing Est."
7. **Organs / byproducts as a separate opt-in section** — heart, liver, tongue, oxtail, soup bones, fat for tallow. Missing from yours.

---

## 5. Top 10 prioritized opportunities

| # | Opportunity | Why it matters | Trello cards covered |
|---|---|---|---|
| 1 | Add fraction selector (¼/½/Whole for beef, ½/Whole for hog/lamb, whole-only poultry) on listing detail | Biggest gap vs project bible. Today the only option is "buy the whole $3,596 cow" — filters out 90% of buyers. | Long Features card; "remove purchase options if 100% sold" |
| 2 | Reorder flow: pick processor → cut sheet → pay | The "First Purchaser picks processor. Cutsheet before payment!" pivot. Closes 4 cards in one motion. | "First Purchaser picks processor"; "make submit on cut sheets automatic"; "Custom cutsheets based on processor and fraction"; processor calendar |
| 3 | Two-tier cut sheet with order-level defaults + per-sub-primal cut selection | Catches up to industry norm; reduces clicks because defaults pre-fill 80% of the form | Pig cut sheet, Beef cut sheet pictures, Custom cutsheets per processor |
| 4 | Real-time yield meter on cut sheet ("482 lbs of 563 lbs allocated · 81 lbs auto-routes to ground") | Solves trade-off transparency and the "did I do this right?" anxiety. Pairs with AI Yield Estimator. | Pig cut sheet, Beef cut sheet pictures |
| 5 | Animal-aware cut sheet (beef vs pork vs lamb vs venison vs poultry with the right primals) | Today's UI is hard-coded to beef cuts; a hog can't have ribeye. | Pig cut sheet |
| 6 | Fix the checkout math + add real Stripe split | "Processing Est. $120" is unrealistic — actual processing on a 750 lb hanging weight is roughly $675 + $95 kill fee. Builds trust, also closes Stripe ticket. Show farmer payout / processor payout / platform fee separately. | "Stripe customization", "saving processor config (animals + prices)" |
| 7 | Smart-default presets — "Premium Steaks", "Family Pack", "Restaurant Cuts", "Budget Ground" — one-tap | Tesla 3-click goal. Presets collapse the cut sheet to one decision. Pair with the per-cut UI as "advanced". | Long Features spec card |
| 8 | Cut photos + primal diagram on the cut sheet | Customers don't know what a tri-tip is. Photos remove most support questions. Hits the Trello card head-on. | "Beef cut sheet pictures" |
| 9 | CSR box + Organs/Byproducts section + bone-in/out + fat trim toggle | Industry-standard fields you're missing | "make it so animal has processor and their address on that"; "steer vs heifer vs bull"; "saving processor config" |
| 10 | Fallback "processor's choice" handling — explicit message at order time | Closes the hardest corner case ("customer doesn't fill cut sheet") by design instead of by mishap | "customer doesn't fill cut sheet" corner case |

---

## 6. Recommendation: bundle into one workstream

**Items 1, 2, 3, 4, 5, 7, 8 → "Reserve & Customize" flow.**

That's the Tesla 3-click pivot, the project bible's biggest unbuilt feature, and 8+ Trello cards in a single shipped feature. Items 6, 9, 10 ride along inside it without expanding scope.

```
Listing Detail
  → Step 1: Pick Fraction (¼ / ½ / Whole)
  → Step 2: Pick Processor + Date from calendar
  → Step 3: Customize Cut Sheet (presets + advanced, animal-aware, photos, yield meter, CSR box)
  → Step 4: Pay with Apple Pay (real Stripe split: farmer, processor, platform)
```

Skip-button on Step 3 sets "Processor's Choice" defaults so the lazy path is fully covered.

---

## 7. Sources

- [Bare Bones Butchering — Cut Sheet Instructions](https://barebonesbutchering.com/cut-sheet-instructions)
- [Friesla — Beef Cut Sheet Guide](https://friesla.com/blog/beef-cut-sheet-guide-tips-for-consumers-processors/)
- [Half a Cow Club — Beef Cuts Chart](https://halfacowclub.com/guides/beef-cuts-chart)
- [Lind's Custom Meats — Order Form Cut Sheets](https://www.lindscustommeats.com/order-form-cut-sheets)
- [Down Home Processing — Beef Cut Sheet](https://www.downhomeprocessing.com/beef-cut-sheet/)
- [Curly's Custom Meats — Custom Beef Processing](https://www.curlysmeats.com/custom-processing/beef-processing/)
- [Windy N Ranch — Cut Sheets](https://www.windynranch.com/cut-sheets)
- [Lea Natural Beef — Custom Cut Beef](https://leannaturalbeef.com/custom-cut-beef/)
- [Protein Outfitters Trello board](https://trello.com/b/6WWCWSp0/protein-outfitters)
- [Protein Outfitters / MeatMatch project on Grok](https://grok.com/project/ea068be5-c9b0-46c0-b04d-04fb7165492e)
