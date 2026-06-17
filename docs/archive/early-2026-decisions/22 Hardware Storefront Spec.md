# Hardware Storefront Spec — Friesla MPUs

_Author: Claude (Cowork session) · Date: May 3, 2026 · Pairs with `22 hardware-storefront-prototype.html`_

Decision Log #14 affirmed hardware sales as a secondary revenue line. The Friesla modular processing unit (MPU) catalog gets a dedicated storefront on `proteinoutfitters.com/hardware`. This is **not** a direct e-commerce checkout. MPUs are six-figure capital purchases with delivery lead times in months, custom configurations, and financing conversations. The web flow's job is to (a) educate the buyer, (b) qualify the lead, and (c) get them into a sales conversation with you, Mychal.

---

## 1. Why this isn't a Stripe checkout

A PS1 MPU starts in the low six figures. Buyers need:
- A site visit (does this fit the buyer's location, power, water?)
- Custom configuration (cut & wrap room? aging cooler? smoking?)
- Financing arrangements (USDA loans, equipment leases, owner-financing)
- Permitting consultation (state inspections, local zoning)

None of that compresses into "tap Apple Pay." The web flow is a lead funnel, not a checkout. We optimize for **qualified meetings booked**, not transactions completed.

---

## 2. Three product lines

| SKU | Lead price | Footprint | Throughput | Best for |
|---|---|---|---|---|
| **PS1 Mobile Harvest Unit** | $145k | 36' trailer | 4 beef/day · 8 hog/day · 20 lamb/day | Farms wanting on-site harvest, lockers expanding capacity, mobile co-ops |
| **PS1 Cut & Wrap Module** | $85k | 24' trailer | Pairs with PS1 or stand-alone | Existing harvest operations adding finishing capacity |
| **PS1 Aging + Cold Storage Module** | $65k | 16' module | 1,200 cu ft · 60 day capacity | Adds aging capacity to existing facilities |

All prices are **starting at**. Custom configuration adds:
- Smoke/cure room: +$28k
- Brine injection station: +$12k
- Extra aging cooler bay: +$18k
- Extended floor plan (40' or 48'): +$12-22k
- USDA upgrade package: +$15k
- Integration with PO marketplace booking: included
- 12 months Standard SaaS: included on any purchase ≥ $50k

Bundle: **PS1 + Cut & Wrap + Aging** as "Full Pipeline Package" — $260k bundled (~12% off) plus 18 months of Standard SaaS included.

---

## 3. The lead funnel

```
1. /hardware (catalog page)
     ↓ [Browse all]
2. /hardware/ps1 (product detail page)
     ↓ [Configure your MPU]
3. /hardware/configure (custom configurator — sliders + options)
     ↓ [Get a quote]
4. /hardware/quote (lead capture form: name, role, location, timeline, financing interest)
     ↓ [Submit]
5. Email D1 fires, lead lands in CRM, sales calendar invite link sent
     ↓
6. /hardware/scheduled (confirmation + next steps)
```

Lead-quality scoring (server-side):

| Signal | Score |
|---|---|
| Has existing facility | +30 |
| Timeline 0–6 months | +25 |
| Has farm/processor account on PO platform | +20 |
| Configured a Full Pipeline Package | +15 |
| Has location address with feasible utilities (zip lookup) | +10 |
| Asked about financing | +10 |
| Browsed three+ product detail pages | +5 |

Score ≥ 70 → "hot lead" → Mychal calls within 24h.
Score 40–69 → "warm" → automated nurture sequence (4 emails over 14 days), Mychal calls in week 2 if no inbound.
Score <40 → "cold" → drip newsletter, no direct outreach.

---

## 4. Pages spec

### 4a. Catalog (`/hardware`)

Hero with PS1 photography (placeholder gradient until real photo). Below: three product cards (PS1 Harvest, Cut & Wrap, Aging) in equal-weight tiles. Each tile shows lead price, footprint badge, throughput, and "Learn more →".

A "Full Pipeline Package" callout block below the three tiles, framed as the recommended path for new operators.

Sections:
- Hero (positioning + 2 CTAs)
- 3-tile catalog
- Full Pipeline bundle callout
- Customer stories (3 cards: "How Stittsworth Meats deployed PS1 in 90 days")
- Specs at a glance comparison table
- FAQ + financing section
- Big CTA: book a 30-minute discovery call

### 4b. Product detail (`/hardware/ps1`)

- Hero with photo carousel placeholder
- Stats panel (footprint, throughput, USDA, power requirements)
- "What's included" expandable
- "Customize" CTA → configurator
- Customer story tile
- Specs deep-dive
- Sticky bottom bar on mobile: "Get a quote starting at $145k"

### 4c. Configurator (`/hardware/configure`)

Step-by-step configurator:

```
Step 1 of 4 · Pick your base
  ◯ PS1 Harvest only ($145k)
  ◯ Cut & Wrap only ($85k)
  ◉ Full Pipeline Package ($260k bundled)

Step 2 of 4 · Add modules
  ☐ Smoke/cure room (+$28k)
  ☐ Brine injection station (+$12k)
  ☐ Extra aging bay (+$18k)
  ☐ USDA upgrade package (+$15k)

Step 3 of 4 · Floor plan
  ◯ Standard 36' trailer (included)
  ◯ Extended 40' trailer (+$12k)
  ◯ Extended 48' trailer (+$22k)

Step 4 of 4 · Operations
  Estimated weekly throughput: ___ animals
  Operating state: [dropdown]
  USDA inspection desired: ◯ Yes ◯ No
  Want to integrate with PO marketplace booking? ◉ Yes ◯ No
```

Live total updates as the user configures. Sticky "Get a quote" CTA at the bottom.

### 4d. Quote / lead form (`/hardware/quote`)

Single-page form, ~10 fields. Pre-filled with config from previous step. Submit → server validates → lead stored in CRM + email D1 fires.

```
Your configuration: [summary card from configurator]
Estimated total: $XXX,XXX

Tell us about you:
  Full name *
  Email *
  Phone *
  Role: [Farm owner / Processor / Locker operator / Co-op / Investor / Other]
  Operating state *
  Existing facility?  ◯ Yes  ◯ No, planning new
  Timeline:  ◯ 0–3 months  ◯ 3–6 months  ◯ 6–12 months  ◯ 12+ months  ◯ Just exploring
  Financing:  ☐ Need help with financing options
  Anything else? [textarea]

  [Submit & schedule a call]
```

Right rail (desktop): "What happens next" 3-step explainer + Mychal's photo + bio + "Why I built this."

### 4e. Scheduled confirmation (`/hardware/scheduled`)

```
Got it — Mychal will call you within 24 hours.
Or skip the wait: book a 30-minute discovery call now.
[Calendly inline booking widget — Mychal's calendar]

What we'll discuss:
- Your current operation and goals
- The right configuration for your throughput
- Site visit logistics
- Financing options + USDA loan partners
```

---

## 5. Email sequences (H-series)

Append to file 06 or new file. Six templates.

| ID | Trigger | Purpose |
|---|---|---|
| H1 | Lead form submit | Confirmation — what to expect, calendar link |
| H2 | Day 1, no scheduled call yet | Soft nudge — book the discovery call |
| H3 | Day 4 (warm leads only) | Customer story — Stittsworth Meats deployment timeline |
| H4 | Day 7 | Financing 101 — USDA FSA loans, equipment leasing options |
| H5 | Day 14 | Last touch — "Should I take you off the list?" with single yes/no reply |
| H6 | Post-discovery call | Recap of the call + next steps + proposal timeline |

Voice: warm, not pushy. The buyer's spending six figures; they hate sales pressure.

---

## 6. Data model

### `hardwareSku` collection
```ts
interface HardwareSku {
  id: string;
  name: string;
  baseLeadPrice: number;
  footprintFt: number;
  throughputBeefPerDay?: number;
  throughputHogPerDay?: number;
  throughputLambPerDay?: number;
  customizations: HardwareCustomization[];
  hero: { photoUrls: string[]; videoUrl?: string };
  description: string;
  whatsIncluded: string[];
  utilities: { kw: number; gpmWater: number; sqftPad: number };
  certifications: ('USDA'|'state-inspected'|'custom-exempt')[];
}

interface HardwareCustomization {
  id: string;
  label: string;
  upcharge: number;
  group: 'module' | 'floor-plan' | 'inspection-package';
}
```

### `hardwareLeads` collection
```ts
interface HardwareLead {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: 'farm-owner' | 'processor' | 'locker-operator' | 'coop' | 'investor' | 'other';
  state: string;
  existingFacility: boolean;
  timeline: '0-3' | '3-6' | '6-12' | '12+' | 'exploring';
  financingInterest: boolean;
  configuration: HardwareConfigSnapshot;
  estimatedTotal: number;
  leadScore: number; // 0–100
  status: 'new' | 'contacted' | 'qualified' | 'proposal-sent' | 'won' | 'lost' | 'unsubscribed';
  scheduledCallAt?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}
```

### `hardwareConfigSnapshots` collection
Used to render the quote summary later if the lead hasn't submitted but you want to send a "still interested?" follow-up. Stored on configure-step exit.

---

## 7. Cloud Functions

```ts
export const submitHardwareLead = onCall<HardwareLead>({}, async (req) => {
  const lead = req.data;
  if (!lead.email || !lead.fullName) throw new HttpsError('invalid-argument', 'Missing required fields.');

  // Compute lead score
  const score = computeLeadScore(lead);

  // Persist
  const ref = await db.collection('hardwareLeads').add({
    ...lead,
    leadScore: score,
    status: 'new',
    notes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Fire email + CRM webhook
  await fireEmailEvent('hardware_lead_submitted', { leadId: ref.id, score });
  await postToHubspot(lead, score);    // or your CRM of choice

  // If hot, page Mychal
  if (score >= 70) {
    await fireEmailEvent('hot_lead_alert', { leadId: ref.id, score });
  }
  return { ok: true as const, leadId: ref.id };
});

function computeLeadScore(lead: any): number {
  let score = 0;
  if (lead.existingFacility) score += 30;
  if (lead.timeline === '0-3' || lead.timeline === '3-6') score += 25;
  if (lead.financingInterest) score += 10;
  if (lead.configuration?.bundleType === 'full-pipeline') score += 15;
  // ...etc
  return Math.min(100, score);
}
```

---

## 8. Public-facing pages on the master site

The hardware storefront integrates with the master site at:

- **`/hardware`** — catalog (linked from main nav as "For processors" → "Hardware" submenu, and from the master site's footer "Sell" column)
- **`/hardware/ps1`** + **`/hardware/cut-wrap`** + **`/hardware/aging`** — product detail
- **`/hardware/configure`** — configurator
- **`/hardware/quote`** — lead form
- **`/hardware/scheduled`** — confirmation + Calendly inline

The hardware nav lives in the master site's main nav so a buyer arriving at `proteinoutfitters.com` sees the hardware revenue line on equal footing with the marketplace.

---

## 9. Closes the following Trello cards

- ✅ Decision Log #14 — hardware (Friesla MPUs) affirmed in scope; this spec gives it shape
- ✅ "Hardware sales storefront design" gap from file 19 — now specced
- 🟡 Open: photography for the storefront (placeholder gradients in prototype until real shoot)

---

## 10. Open questions for Mychal

1. **Pricing**: $145k / $85k / $65k — confirm or override.
2. **Bundle discount**: 12% off Full Pipeline Package — confirm.
3. **CRM**: HubSpot, Pipedrive, Salesforce, or your existing setup? Lead routing depends on this.
4. **Calendly account**: pull from your existing calendar?
5. **Photography**: half-day shoot of an MPU (interior + exterior + close-ups + "in operation"). Hire a Bemidji-area commercial photographer? Budget ~$2-3k.
6. **Financing partners**: USDA Farm Service Agency loans, Compeer Financial, Stearns Bank — pre-vet a partner list to feature in H4 email and on the financing FAQ?
