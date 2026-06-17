# Refund & Cancellation Policy

_Author: Claude (Cowork session) · Date: May 3, 2026 · Bias: customer-first within reason_

This document has two views. The first is what the customer sees at checkout, in confirmation emails, and at proteinoutfitters.com/policies/refunds. The second is the internal operational playbook for support reps and the engineering rules that make it work in code.

---

## VIEW 1 — Customer-facing policy

### The 10-second version

You can cancel for a full refund up to 21 days before your animal's drop-off date. After that, your 25% deposit covers the farmer and processor work that's already in motion. If anything goes wrong on our end — the animal is condemned, your processor cancels, the farmer no-shows — we make you whole. If your meat shows up and there's a quality problem, you have 7 days to tell us and we'll refund or replace it.

### How reservations work

When you reserve a share of an animal, three things happen:

1. **Your price is locked.** The per-pound price you see at reservation is the price you pay, even if market prices change before drop-off.
2. **A 25% deposit is captured.** This is what keeps your spot. The remaining 75% is captured 7 days before the animal's scheduled drop-off, after we've confirmed the schedule with the farmer and processor.
3. **The farmer and processor get to work.** The farmer schedules transport. The processor blocks calendar capacity. Costs start accruing immediately.

### Refund timeline

| When you cancel | What you get back |
|---|---|
| Anytime before 21 days from drop-off | Full refund, including deposit |
| 21–8 days from drop-off | Refund of everything except the 25% deposit |
| 7–1 days from drop-off | Refund of the balance only — the 25% deposit and any captured balance are non-refundable |
| Day of drop-off or after | No refund. Once the animal goes to the processor, the meat is yours. |

This policy reflects a real cost reality: once the farmer trucks the animal and the processor blocks the slot, those costs are real and irreversible. The 21-day window gives you a generous, no-questions-asked exit before then.

### When something goes wrong (and it isn't your fault)

You will not be left holding the bag for things outside your control. In each case below, you get a full refund or a free replacement at our cost.

| Situation | What happens |
|---|---|
| The animal is condemned at inspection (disease, injury, contamination) | Full refund of everything you paid. We absorb the kill fee through our condemnation insurance pool. |
| The animal dies before drop-off | Full refund. We help you find another animal at the same locked price if you want. |
| The processor cancels or shuts down | We re-route your share to another nearby processor with the same dates if possible. If not, full refund and we help you find another animal. |
| The farmer no-shows or backs out | Full refund. The farmer is flagged on the platform for review. |
| Your meat arrives off-spec — wrong cuts, missing items, freezer-burned, spoiled | Email us within 7 days of delivery with photos. We refund the value of the affected portion, replace it from another share, or issue platform credit — your choice. |
| You change your mind after delivery | We can't accept returns of perishable food, but if there's a real quality issue, see the row above. |

### Optional condemnation insurance ($X at checkout)

For roughly 2% of your share's price you can opt into our condemnation insurance pool. This isn't strictly necessary — we already cover full refunds on condemned animals — but it covers your platform fee and any non-refundable deposit if a private inspection issue happens between farms and processors. Many buyers skip it. Add it if you want belt-and-suspenders.

### Cut sheets and the "Processor's Choice" fallback

If you don't fill out a cut sheet by 7 days before drop-off, your processor will use a default "Processor's Choice" cut breakdown. That means a balanced mix of steaks, roasts, and ground. You will not be charged extra and you will not get a refund for not getting your way — picking your cuts is part of the deal.

### Payment method troubles

If your card declines at balance capture (7 days before drop-off), you have 72 hours to update payment. If we can't capture by 4 days before drop-off, your share is released back to the marketplace and your 25% deposit is forfeit.

### Disputes

Email support@proteinoutfitters.com or tap "Get help" inside the app. We aim for a same-business-day reply and a resolution within 5 business days. If you and we can't agree, the dispute can go to mediation under Minnesota law (where Protein Outfitters is incorporated).

### Force majeure

Wildfire, flood, large-scale animal disease outbreak, government order, or other events beyond our reasonable control may delay drop-off, processing, or delivery. In those cases we will offer a date change at no charge, a full refund, or platform credit — your choice. You will not be billed extra for events nobody could control.

---

## VIEW 2 — Internal operational policy & engineering rules

### Lifecycle states & money movement

Every reservation moves through these states. Stripe payment intents and transfers are tied to state changes.

| State | What the customer sees | Money movement |
|---|---|---|
| `reserved` | "Reserved!" confirmation page | Deposit (25%) captured. Balance held as `setup_intent` for later capture. |
| `cutsheet_pending` | Reminder emails day 14, day 7 | None. |
| `balance_captured` | Email "Balance captured — see you on {drop-off}" | Remaining 75% captured at T-7 days. |
| `awaiting_dropoff` | Map link to processor + drop-off date | None. Funds held in platform Stripe balance. |
| `dropped_off` | "Animal arrived at processor" notification | None. Kill fee transfer authorized. |
| `killed` | "Hanging weight: X lbs" | Kill fee + half processing fee released to processor. Farmer payout authorized but held until customer pickup/ship. |
| `processed` | "Ready for pickup on {date}" | Remaining processing fee released to processor. |
| `delivered` | "Delivered — 7 days to flag any issue" | Farmer payout released to farmer. Platform fee already taken. |
| `complete` | (no notification) | All settled. |

### Refund rules at each state (the engineering truth table)

| State | Customer-initiated cancel | Refund amount | Mechanic |
|---|---|---|---|
| `reserved` (≥21d) | Allowed | 100% | Reverse PaymentIntent, void setup_intent |
| `reserved` (8–20d) | Allowed | 75% (deposit forfeit) | Refund excess of deposit only |
| `cutsheet_pending` (≤7d) | Allowed | balance only if not yet captured | Refund balance, void cutsheet |
| `balance_captured` (1–7d) | Allowed but discouraged | 0% — no refund | UI displays "Within drop-off window — no refund." |
| `awaiting_dropoff` to `delivered` | Not allowed | 0% | UI hides cancel button |

### Platform-fault refunds (full, regardless of state)

These are bypass rules — they refund the customer regardless of timing.

```
TRIGGER → REFUND
  animal.status = 'condemned'        → 100% to customer; platform absorbs kill fee from insurance pool
  animal.status = 'died_pre_dropoff' → 100% to customer
  processor.status = 'cancelled'     → attempt re-route; if fail, 100% to customer
  farmer.status = 'no_show'          → 100% to customer; flag farmer
```

Each of these auto-creates a support ticket so a human can confirm and message the customer.

### Quality complaints (post-delivery, customer flag)

```
INPUT: customer flags within 7 days of delivered date
  - Photos uploaded
  - Cuts/items affected listed
SUPPORT REVIEW (SLA: 1 business day):
  - Verify against cut sheet
  - Decide: refund / replace / credit
  - Customer gets choice of three remedies
COST OWNER:
  - Cuts wrong vs cut sheet → processor eats it (deduct from next payout)
  - Spoiled in transit → platform eats shipping insurance
  - Quality (toughness, marbling, freezer burn from improper packing) → platform eats it; flag processor; recoup if pattern
```

### Card-decline cascade (T-7 balance capture)

```
T-7d: PaymentIntent.confirm
  on success → state = balance_captured
  on decline → email customer "Update payment in 72h"
  on still-declining at T-4d → release share back to marketplace
                              → forfeit 25% deposit
                              → notify farmer + processor
                              → animal pulled from "X% sold" UI
```

### Condemnation insurance pool

- Optional checkout add-on: 2% of total share price, customer opts in.
- Pool is a single platform-managed Stripe balance.
- When an animal is condemned: pool reimburses the platform for the kill fee + any farmer payout already disbursed.
- Pool target balance: 6 months of expected condemnations × estimated cost. Top up from new sales until reached.
- Spec the pool's reserve ratio with finance before launch. Default starting reserve: $25k.

### Dispute escalation ladder

1. **Tier 1 (support@)** — same-business-day reply, resolves cosmetic/admin issues, refund up to $250 platform credit at rep discretion.
2. **Tier 2 (CX lead)** — within 2 business days, can refund up to $1,500 against farmer or processor payout.
3. **Tier 3 (you, Mychal, or designated officer)** — within 5 business days, decides anything above $1,500 or pattern-of-issue cases.
4. **Mediation** — opt-in, MN-based, customer or platform may invoke.
5. **Court** — small-claims jurisdiction in Beltrami County, MN by default per Terms.

### Farmer & processor protections (so the policy is fair upstream)

The customer-friendly refund rules above assume we don't punish farmers and processors who did nothing wrong. Specifically:

- **Customer cancels in 8–20 day window** — deposit (25%) is split: farmer keeps their portion of the meat allocation if the animal hasn't moved; processor keeps any committed slot fee. Platform keeps the rest.
- **Customer cancels in 1–7 day window** — full deposit + captured balance distributed: farmer paid for animal as if sold (animal gets relisted or sold as commodity); processor paid kill fee for committed slot; platform keeps the platform fee.
- **Platform-fault refund** — platform absorbs the cost. Farmer and processor still get paid for work performed.

### Data/state model additions

```ts
type ReservationState =
  | 'reserved' | 'cutsheet_pending' | 'balance_captured'
  | 'awaiting_dropoff' | 'dropped_off' | 'killed'
  | 'processed' | 'delivered' | 'complete'
  | 'cancelled' | 'platform_fault_refund' | 'quality_refund';

type RefundDecision = {
  reservationId: string;
  reason: 'customer_cancel' | 'farmer_no_show' | 'processor_cancel'
        | 'animal_condemned' | 'animal_died' | 'quality_complaint'
        | 'card_decline' | 'force_majeure';
  amount: number;
  platformAbsorbs: number;
  farmerCharged: number;
  processorCharged: number;
  insurancePoolDraw: number;
  decidedBy: 'system' | UserId;
  decidedAt: ISO;
  customerCommunicatedAt?: ISO;
};
```

### What this policy closes on the Trello board

- ✅ Bug: "customer cancels card transaction" → cascade defined above
- ✅ Corner case: "animal killed and disease found" → condemnation refund rule
- ✅ Corner case: "customer doesn't fill cut sheet" → Processor's Choice (already in spec) + no refund for not getting your way
- ✅ Corner case: "farmer is no show at scheduled time" → full refund + farmer flag
- ✅ Corner case: "Farmer says animal dropped off, processor doesn't" → escalates to support tier 1 with both transcript-style state notifications, T-1 SLA
- ✅ For Myke decision: deposit % → 25% locked, becomes non-refundable at T-21 days
- ✅ For Myke decision: condemnation insurance — opt-in 2% pool

### What still needs your sign-off

1. **Free-cancel window**: 21 days proposed. Industry uses 14–30. Going generous favors customer-first stance. **Lock at 21 days?**
2. **Insurance opt-in price**: 2% of share price. Could be flat $50. **Pick one.**
3. **Quality-complaint window**: 7 days post-delivery. Some processors do 48 hours. **Lock at 7 days?**
4. **Tier 1 rep discretion cap**: $250 platform credit. **Reasonable?**
5. **Insurance pool starting reserve**: $25k seed. **Approve or adjust.**
6. **Jurisdiction & venue**: Beltrami County, MN small claims. **Confirm or change.**

Once you confirm those 6, the policy is publishable and the engineering can start wiring it.
