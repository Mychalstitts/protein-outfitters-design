# Reserve & Customize — 4-Step Flow Spec

_Author: Claude (Cowork session) · Date: May 3, 2026_

This spec defines the new consumer purchase flow that replaces the current Listing → Cut Sheet → Bag → Checkout sequence. Every screen lists the entry point, on-screen elements, every interactive element with its destination, the data written to backend, and edge-case behaviors. Designed so an engineer or another LLM can implement directly without re-asking questions.

---

## 0. Scope, principles, terminology

**Scope:** Consumer-side purchase of a fraction of a live animal listing. Everything from "tap a listing" to "Place Reservation". Does not cover farmer listing creation, processor calendar setup, or admin tools — those flows exist elsewhere.

**Principles:**
1. **Tesla 3-click rule.** A returning Apple Pay buyer who accepts smart defaults can complete in 3 taps from the listing detail page.
2. **No dead buttons.** Every CTA, link, icon, and tab has a destination, modal, action, or toast.
3. **Reverse-friendly.** Every step has a back arrow that preserves prior choices.
4. **Fallback always defined.** Every input has a "what happens if user skips" answer.
5. **Animal-aware.** The flow branches on `animal.species` to pick the right fractions, primals, and presets.

**Terminology:**
- `animal` — the listing record (`{ id, species, breed, liveWeightLbs, hangingWeightLbs, takeHomeLbs, pricePerLbHanging, farmerId, location, ... }`)
- `fraction` — one of `quarter | half | whole`. Constrained by species (see §1).
- `share` — the row written to Firestore: `{ id, animalId, fraction, buyerId, processorId, dropoffDate, cutSheetId, status, ... }`
- `cutSheet` — the customer's cut preferences for this share.
- `splitPayment` — three-way Stripe split: farmer / processor / platform.

---

## 1. Allowed fractions per species

| Species | ¼ | ½ | Whole | Notes |
|---|---|---|---|---|
| Beef | ✓ | ✓ | ✓ | ¼ is front- or hind-quarter; user picks at Step 1 |
| Hog | ✗ | ✓ | ✓ | "¼ portion at ~50 lbs hang weight isn't practical" |
| Lamb | ✗ | ✓ | ✓ | Same reason |
| Venison | ✗ | ✓ | ✓ | Same reason |
| Poultry | ✗ | ✗ | ✓ | Whole bird only, sold in lots of 6+ minimum |

If a fraction is unavailable because earlier buyers claimed it, the option shows greyed with "Sold" badge.

---

## 2. Step 0 — Listing Detail (entry point, mostly existing)

**Location:** `/listing/{animalId}`

**Existing elements to keep:** Hero image, breed tag, animal name, price-per-lb (hanging), Compliance Score, AI Yield Estimator, Animal Details, About this Animal, farm bio, photos.

**Changed elements:**
- Replace single "Add to Bag" button with a single primary CTA: **"Reserve a Share →"**.
- Remove the "Customize Cut Sheet →" secondary CTA (it moves into Step 3).

**Tap "Reserve a Share":** push to `/reserve/{animalId}/fraction` (Step 1).

---

## 3. Step 1 — Pick Fraction

**Location:** `/reserve/{animalId}/fraction`

**Header:** Back arrow (returns to listing) · Step indicator "1 of 4" · Page title "Choose your share"

**Body:**
- Mini summary card: animal photo, name, ranch, location, price/lb. (Single-line, sticky on scroll.)
- Three fraction cards stacked vertically, each:
  - Big label (¼ Beef · ½ Beef · Whole Beef)
  - Estimated take-home weight (e.g. "≈140 lbs take-home")
  - Estimated total cost (e.g. "≈$1,120 + processing")
  - Availability badge ("Available" / "Sold" / "1 left")
  - Front/Hind sub-toggle (only on ¼ Beef): Front Quarter (chuck, brisket, ribs, shank) / Hind Quarter (loin, sirloin, round) / Mixed (1/8 + 1/8). Shown inline only after ¼ is selected.
- Inline copy under cards: "Locks at $X/lb today. Processing fees vary by processor; you'll pick one next."

**CTAs:**
- Primary: "Continue →" (disabled until a fraction is selected). Pushes to `/reserve/{animalId}/processor?fraction={value}`.
- Secondary: "Need help deciding?" — opens a help drawer with a side-by-side weight/cost comparison and a "best for X people" guide. Drawer has "Got it" close button.

**Edge cases:**
- If only Whole is available: skip this step, auto-pick Whole, push directly to Step 2 with toast "Whole share selected — only option remaining."
- If nothing is available (100% sold): redirect back to listing with banner "This animal is fully reserved. Browse similar →".
- If user backs out: choice is preserved in URL params.

**Data written:** None yet. State held in URL/route params.

---

## 4. Step 2 — Pick Processor + Drop-off Date

**Location:** `/reserve/{animalId}/processor?fraction={value}`

**Header:** Back · "2 of 4" · "Pick processor & date"

**Body:**
- Sticky summary: animal · fraction · est. take-home lbs.
- Map view (default) of nearby processors centered on `farmer.location`. Pins colored by availability/distance/price.
  - Toggle: Map / List view.
- Selected processor card (slides up from bottom on tap):
  - Processor name, distance from farm, USDA inspected badge, Compliance Score
  - Price/lb hanging-weight processing fee
  - Kill fee
  - Available drop-off dates as a horizontal scrollable date row, next 90 days. Booked dates are disabled. Dynamic-pricing badge appears on dates within 14 days ("+$45 rush fee").
  - "Why this matters" expandable: explains processor sets the cut options available in Step 3.
- Empty state if no processors within range: "No processors nearby. Expand search radius?" with a 50/100/200 mile chooser and a "Suggest a processor" mailto link.

**CTAs:**
- Primary: "Continue →" (disabled until processor + date chosen). Push to `/reserve/{animalId}/cutsheet?fraction=&processorId=&date=`.
- Secondary: "First Purchaser?" info pill — pops a tooltip explaining that the first buyer of this animal picks the processor; subsequent buyers inherit it. (See §10.)

**Edge cases:**
- Animal already has a processor (subsequent buyer): skip this step. Display a non-blocking confirmation card on Step 3: "Your share will be processed at {Processor} on {Date}. [Why?]".
- Date passes a 30-day-out window the farmer hasn't approved yet: still selectable but flagged "Pending farmer confirmation".
- Animal age > 30 months at planned drop-off (OTM rule): warning banner on date row "OTM rules apply — additional handling fee may apply."

**Data written:**
- Lightweight reservation row in Firestore `reservations` collection holding `{ animalId, fraction, processorId, dropoffDate, expiresAt: now + 15 min, buyerSession }` so the slot is held while the buyer fills the cut sheet.

---

## 5. Step 3 — Customize Cut Sheet

**Location:** `/reserve/{animalId}/cutsheet?fraction=&processorId=&date=`

**Header:** Back · "3 of 4" · "Customize your cuts"

**Body has 4 sub-sections, in order:**

### 5a. Smart Preset (top)

Big horizontal card: 4 preset chips, single-select.
- **Premium Steaks** — "Maximize prime cuts. Less ground."
- **Family Pack** — "Balanced: roasts, steaks, ground for everyday cooking."
- **Restaurant Cuts** — "Steaks, tenderloin, brisket emphasized."
- **Budget Ground** — "Maximize ground beef and stew meat."
- **Custom** — opens advanced UI below (default if user scrolls past).

Tapping a preset auto-fills the rest of the form. Visible "Applied: Family Pack — tap any cut to tweak" banner appears.

### 5b. Order-Level Defaults

Single card with 4 dropdowns (these set per-cut defaults across the order):
- Roast Size: 2 lb · 3 lb · 4 lb (default 3 lb)
- Steak Thickness: ¾" · 1" · 1¼" · 1½" (default 1")
- Steaks per Pack: 1 · 2 · 4 (default 2)
- Ground Packaging: 1 lb · 1.5 lb · 2 lb (default 1 lb)
- Lean ratio (beef only): 80/20 · 85/15 · 90/10 (default 80/20)

Changing any default updates downstream cut cards in real time.

### 5c. Per-Sub-Primal Cuts

One card per sub-primal, organized by anatomy. **Animal-aware** — shows beef sub-primals for beef, pork primals for hog, etc.

Each card:
- Sub-primal name (e.g. "Chuck") with photo/illustration
- Toggle "Use this sub-primal" (on by default)
- If on: list of available cuts as toggles + counters. E.g. for Chuck:
  - Chuck Roast (toggle on, 2 roasts default — uses order-level Roast Size)
  - Chuck Steak (toggle on, 4 steaks default — uses order-level Steak Thickness)
  - Ground (toggle on — gets the trim automatically)
  - Stew Meat (toggle off, +$1/lb upcharge note)
- Bone-in / Boneless toggle where relevant
- "Tap for more" link → opens cut detail modal with photo + cooking method + typical weight per piece.

**Beef sub-primals shown:** Chuck · Brisket · Rib · Plate · Short Loin · Sirloin · Flank · Round · Shank.
**Hog primals shown:** Shoulder (Boston butt + picnic) · Loin (chops + tenderloin) · Belly (bacon + side) · Ham · Hocks · Spare Ribs.
**Lamb primals shown:** Shoulder · Rack · Loin · Leg · Shank · Breast.
**Venison primals shown:** Shoulder · Backstrap · Tenderloin · Hindquarter · Trim.
**Poultry:** Whole bird only, plus toggles for Spatchcock / Quartered / Cut-up-8-pieces / Whole.

### 5d. Specialty + Organs + Special Request

- Specialty Cuts (toggles): Bones for stock, Suet, Soup bones, Tallow, Smoked options ($X/lb upcharge).
- Organs (toggles, free or low-cost): Heart, Liver, Tongue, Kidneys, Oxtail.
- Customer Special Request: free-text box, 500 char max, placeholder "e.g. extra-thick ribeyes, save beef cheeks, no liver."

### 5e. Sticky Yield Meter (bottom of viewport, always visible)

```
Allocated: 482 lbs of 563 lbs           [progress bar]
81 lbs unallocated → routes to ground beef
12 packs of ground · 4 roasts · 18 steaks · 1 brisket
Estimated processing: $720
```

The meter updates on every interaction. If allocation exceeds yield, bar turns amber and copy says "Over by 8 lbs — reduce a category."

**CTAs:**
- Primary: "Save & Pay →" → push to `/reserve/{animalId}/pay?...`.
- Secondary (top-right): "Skip — Processor's Choice" → bypasses cut sheet entirely; sets `cutSheet.preset = 'processors_choice'`; toast "Got it. Your processor will use their default cuts." Push to Step 4.
- Tertiary: "Save Draft" → writes the cutSheet but doesn't advance.

**Auto-save:** Cut sheet writes to Firestore on every change, debounced 800 ms. (Closes the "make submit on cut sheets automatic" Trello bug.)

**Data written:** `cutSheets` document keyed by `share.id` placeholder, with `{ preset, defaults, perSubPrimal: {...}, specialty: {...}, organs: {...}, specialRequest, allocatedLbs, unallocatedLbs, estProcessingFee }`.

**Edge cases:**
- Reservation expires (15 min idle): banner "Your processor slot is about to expire — refresh to continue." Auto-refresh on next interaction.
- User picked a fraction whose primals overlap split (e.g. ¼ front-only): only show Chuck/Brisket/Rib/Plate/Shank; hide Loin/Sirloin/Round; explicit copy "You picked Front Quarter."

---

## 6. Step 4 — Pay (Reservation)

**Location:** `/reserve/{animalId}/pay?...`

**Header:** Back · "4 of 4" · "Reserve your share"

**Body:**
- Order summary card:
  - Animal · fraction · take-home lbs
  - Processor name · drop-off date
  - Cut sheet preset/custom · "View cut sheet" link (opens read-only modal)
- Investment Breakdown (real numbers, not the current $120 placeholder):
  - **Meat to farmer**: hanging weight × price-per-lb-hanging × fraction (e.g. ½ × 750 × $4.50 = $1,687.50)
  - **Processing**: hanging weight × processing-rate × fraction + (kill fee × fraction-of-kill-fee-allocated)
  - **Platform fee**: 3% of total
  - **Shipping** (if home-delivery option chosen on this screen): $X — show "Pickup at processor" as $0 alternative
  - **Total**
- Deposit toggle:
  - "Reserve with 25% deposit ($XXX)" — locks price, balance auto-charges 7 days before drop-off
  - "Pay in full now ($X,XXX)"
  - Default: 25% deposit (industry standard, lower friction)
- Payment Method (existing): Apple Pay default, Card, ACH
- Pickup vs Ship address (if Ship: existing address form)
- Disclaimer: "This is a reservation. Final weight & charge calculated post-processing. Refundable up to 30 days before drop-off; deposits non-refundable inside 30 days."
- Big primary CTA: **"Place Reservation"**. On tap:
  1. Confirm Apple Pay sheet
  2. Stripe Payment Intent created with `transfer_group = share.id` and three transfers configured: farmer (delayed until kill confirmed), processor (delayed until processed), platform (immediate).
  3. Write `share` row, write `cutSheet` finalized row, write `payment` row, fire notification to farmer + processor + buyer.
  4. Push to `/reserve/{animalId}/confirmation?shareId={shareId}` (Step 5).

**Edge cases:**
- Stripe error: stay on page, banner with retry, do not write anything.
- Buyer is "first purchaser" (only one or no other shares yet): Place Reservation also locks in the processor + drop-off date for all future buyers.
- Deposit option chosen: only the deposit + platform-fee-on-deposit captured now; balance is a Stripe `setup_intent` for later charge.

---

## 7. Step 5 — Confirmation (kept, lightly polished)

**Location:** `/reserve/{animalId}/confirmation?shareId={id}`

**Body:**
- Big checkmark · "Reserved!"
- Order summary card (same as Step 4)
- Timeline: drop-off date → processing window → ready-for-pickup window → ship date if applicable
- "What happens next" 3-bullet explainer
- CTAs: "View in My Reservations →" / "Track this Animal →" / "Share with a friend →"

---

## 8. Navigation map (every button wired)

```
ListingDetail
  Reserve a Share → Step1
  back → home
Step1 (Fraction)
  Continue → Step2 (with fraction in URL)
  back → ListingDetail
  Need help → drawer; Got it → close drawer
Step2 (Processor)
  Continue → Step3
  back → Step1 (preserve fraction)
  First Purchaser tooltip → in-place
  Map ↔ List toggle → in-place
  Suggest a processor → mailto
Step3 (CutSheet)
  Save & Pay → Step4
  Skip Processor's Choice → Step4 (cutSheet.preset = processors_choice)
  Save Draft → toast, stay
  back → Step2 (preserve)
  Cut detail modal → close → in-place
Step4 (Pay)
  Place Reservation → Step5 on success
  back → Step3 (preserve)
  View cut sheet → modal → close → in-place
  Apple Pay sheet → success/cancel → handle in-place
Step5 (Confirmation)
  View in My Reservations → /me/reservations
  Track this Animal → /listing/{animalId}/track
  Share → native share sheet
  Continue browsing → home
```

---

## 9. Data model additions

```ts
type Fraction = 'quarter_front' | 'quarter_hind' | 'half' | 'whole';

type Share = {
  id: string;
  animalId: string;
  buyerId: string;
  fraction: Fraction;
  processorId: string;
  dropoffDate: ISODate;
  cutSheetId: string;
  payment: {
    stripePaymentIntentId: string;
    method: 'apple_pay' | 'card' | 'ach';
    deposit: { amount: number; capturedAt: ISO };
    balance: { amount: number; setupIntentId: string; chargeAt: ISO };
    splits: { farmer: number; processor: number; platform: number; shipping: number };
  };
  status: 'reserved' | 'cutsheet_pending' | 'awaiting_dropoff' | 'in_processing' | 'ready' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  shipping: { mode: 'pickup' | 'ship'; address?: Address };
  createdAt: ISO;
};

type CutSheet = {
  id: string;
  shareId: string;
  preset: 'premium_steaks' | 'family_pack' | 'restaurant_cuts' | 'budget_ground' | 'custom' | 'processors_choice';
  defaults: { roastSizeLbs: number; steakThicknessIn: number; steaksPerPack: number; groundPackLbs: number; leanRatio: '80/20' | '85/15' | '90/10' };
  perSubPrimal: Record<string, SubPrimalChoice>;
  specialty: { bones: boolean; suet: boolean; soupBones: boolean; tallow: boolean; smokedItems: string[] };
  organs: { heart: boolean; liver: boolean; tongue: boolean; kidneys: boolean; oxtail: boolean };
  specialRequest: string;
  allocatedLbs: number;
  unallocatedLbs: number;
  estProcessingFee: number;
  updatedAt: ISO;
};

type SubPrimalChoice = {
  enabled: boolean;
  cuts: Record<string, { qty?: number; thicknessIn?: number; boneIn?: boolean; toggle?: boolean }>;
};
```

---

## 10. First-purchaser logic (the Trello pivot card)

The Trello card "First Purchaser picks processor. Cutsheet before payment!" maps to:

```
On Step 2 entry:
  if (existing share for this animal with processorId set) {
    skip Step 2;
    inherit processorId & dropoffDate;
    show banner on Step 3: "Inherited from first purchaser"
  } else {
    show Step 2;
    on Place Reservation in Step 4, set animal.processorId & animal.dropoffDate
  }
```

This is handled at the route-resolver level, not inside the screen.

---

## 11. Closes the following Trello cards on ship

- ✅ "First Purchaser picks processor. Cutsheet before payment!" — full reorder of the flow
- ✅ "Custom cutsheets based on processor and fraction" — Step 3 reads processor's available cuts; Step 1 fraction filters primals
- ✅ "make submit on cut sheets automatic" — auto-save in Step 3
- ✅ "Pig cut sheet" — animal-aware Step 3 includes hog primals
- ✅ "Beef cut sheet pictures" — cut detail modal includes photos
- ✅ "remove purchase options from view of animal if 100% is sold" — Step 1 handles availability
- ✅ "customer doesn't fill cut sheet" corner case — Skip → Processor's Choice CTA in Step 3
- ✅ "Stripe customization" — Step 4 split-payment integration
- ✅ "make it so animal has processor and their address on that" — Step 2 writes both
- ✅ "saving processor config (animals + prices)" — processor card rendering reads from this; spec relies on it being correct

Partially closes:
- "purchases above cart above search" — bag concept is replaced by reservation flow; revisit
- "Notifications--make links work" — confirmation step notifications

---

## 12. Open questions for Mychal

1. **Deposit %**: 25% industry standard. Lock or make configurable per farmer?
2. **First-purchaser locks processor for everyone** — confirm this is the desired behavior, or should subsequent buyers be able to override with a "different processor" request that reopens negotiation?
3. **Shipping pricing model**: flat per share? per lb? carrier-calculated? Out of scope for this spec — hand off to logistics later.
4. **Insurance pool / kill-fee protection** mentioned in Grok bible — toggle on Step 4 or separate post-purchase upsell?
5. **Donation flow** (Producer Partnership 75/25 hybrid from Apr 1 Grok thread): should this share Step 1's fraction selector with a "Donate this fraction" toggle, or stay a separate flow?
