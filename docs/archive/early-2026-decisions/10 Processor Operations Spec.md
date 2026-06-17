# Processor Operations Spec

_Author: Claude (Cowork session) · Date: May 3, 2026 · Closes Trello "changing functionality" cards: queue view, only processor does check-in, dropoff deposit for farmer._

These three features are tightly coupled. The processor queue view is the daily workflow. The processor-only check-in is the authoritative data event. The farmer dropoff deposit is the financial commitment that makes the check-in trustworthy. Together they solve the "farmer says dropped off, processor doesn't" dispute by making it impossible.

---

## 1. The problem they solve, in one paragraph

Today the platform has no enforced, authoritative truth about whether an animal actually arrived at a processor. Farmers self-report drop-offs, processors self-report check-ins, and the two records can diverge. Customers are downstream of that ambiguity. Meanwhile, farmer no-shows cost processors a wasted slot and the platform a refund hit. These three features replace self-reporting with one event: the processor scans a QR code on the animal at arrival, and that event triggers everything downstream — payment release, customer notifications, calendar updates. Farmers post a refundable deposit when they book the slot, which they get back when the processor confirms. The deposit eliminates the casual no-show and the QR-code event eliminates the dispute.

---

## 2. Feature A — Processor Queue View (Outlook-style)

### Why a queue view

Today processors are juggling bookings across emails, paper notes, and the platform UI. They need a single screen that tells them: who's coming today, who's coming tomorrow, who's overdue, what's hanging in the cooler, what's ready for pickup. Outlook's calendar/inbox hybrid is the right mental model — bookings are time-blocked events with state.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Hilltop Custom Meats               [Today | Week | Month]      │
│                                                                 │
│  ┌─ Today, June 21 ─────────────────────────────────────────┐  │
│  │ ●  9:00 AM    Angus Steer #402   Sterling Trust Farms     │  │
│  │              ½ buyer + 2 quarters | Cut sheet: Family Pak │  │
│  │              [QR scan to check in]                        │  │
│  │                                                           │  │
│  │ ○ 11:30 AM    Hereford #339      Rolling Hills Ranch      │  │
│  │              Whole | Cut sheet: pending                   │  │
│  │              [Booking details]                            │  │
│  │                                                           │  │
│  │    1:00 PM    [LUNCH BLOCK]                               │  │
│  │                                                           │  │
│  │ ○  2:00 PM    Wagyu Cross #102   Agri-Credit Union        │  │
│  │              ¼ + ¼ + ½ | Cut sheet: Premium Steaks        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ This week's hanging cooler (3) ─────────────────────────┐  │
│  │  Steer #402 — day 3 of 14 dry-age  [Log weight]          │  │
│  │  Hog #88  — day 7, ready for cut/wrap  [Start fab]        │  │
│  │  Lamb #L20 — day 5 of 7  [—]                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ Ready for pickup (4) ────────────────────────────────────┐  │
│  │  Hog #87 — Sarah J. — pickup window ends Fri  [Notify]    │  │
│  │  ...                                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Three states per booking

| Icon | Meaning |
|---|---|
| ● Filled circle | Active now — animal arriving today, scan available |
| ○ Empty circle | Scheduled — future booking |
| ✓ Green check | Checked in (animal physically at processor) |
| ⚠ Amber | Overdue — booking time passed, no check-in |
| ✗ Red | No-show flagged |

### Tabs

- **Today** (default) — chronological list of today's bookings + active hanging + ready-for-pickup
- **Week** — Outlook-style 7-day grid, drag to reschedule (subject to farmer + customer notification rules)
- **Month** — capacity overview, color-coded by load
- **Inbox** — customer/farmer messages threaded per `share.id`, separate from email

### Engineering scope

- New screen: `ProcessorQueueScreen.tsx` (replaces or supplements existing dashboard)
- Backend: scheduled job that re-computes today's queue + state at midnight + on every check-in event
- Real-time updates via Firestore listeners (animal state changes, new bookings, customer messages)
- Drag-to-reschedule triggers a confirmation modal listing affected farmer + buyers, sends notifications, records audit

**Effort:** ~10 dev-days for v1.

---

## 3. Feature B — Processor-Only Check-In (single source of truth)

### Why processor-only

Today both farmers and processors can mark a drop-off complete in their respective dashboards. When they disagree, the platform has to play referee. The fix is simple: only the processor's check-in event counts. Farmers can mark "in transit" or "arrived at gate" — those are notifications, not authoritative state changes.

### The check-in event

The processor's queue view (above) shows a `[QR scan to check in]` button per booking. Tapping it:

1. Opens the device camera
2. Reads a QR code that the farmer presents (printed sticker on the trailer, or shown on the farmer's phone)
3. The QR encodes `share.id` + `expected_drop_off_date` + signed token (so it can't be faked)
4. Server validates the token + that the booking is for this processor today
5. State transition: `awaiting_dropoff` → `dropped_off`
6. Triggers cascade:
   - Farmer notification (F5 email)
   - Customer notification (file 05 email 16)
   - Farmer dropoff deposit released (Feature C below)
   - Kill-fee payout authorized
   - GPS + photo captured at moment of scan (audit log)

### Why a QR code (not just a button)

A button can be tapped from anywhere — including the farmer's couch. A QR code requires the processor to physically point a camera at the farmer's animal trailer at the processor's facility. That's the proof.

The QR code is unique per booking and time-boxed (valid only on the booked drop-off date ± 24h grace). After check-in, the QR is invalidated.

### Fallback for processors without smartphones

A 6-digit code per booking, displayed on the farmer's phone and entered by the processor on a desktop. Less elegant, same auditability if both farmer and processor independently produce the same code (the farmer's phone is the source of the code).

### What farmers can still do

- Mark "Departed for processor" → notification only, no state change
- Mark "Arrived at processor gate" → notification only, no state change
- Both signals show on the processor queue view as an upcoming line, but `awaiting_dropoff` doesn't flip until the QR scan happens

### Engineering scope

- QR generation backend (per-booking, signed tokens)
- Mobile camera scan flow in the processor app
- 6-digit fallback flow
- Server-side validation + state machine update
- GPS + timestamp capture
- Audit log

**Effort:** ~5 dev-days. Critical that the auth/validation is right — this is the linchpin event for payout release.

---

## 4. Feature C — Dropoff Deposit for Farmer

### Why a farmer-side deposit

The customer pays a 25% deposit. The processor commits a calendar slot (real cost). The farmer commits nothing — and that's the source of the no-show problem. Adding a refundable farmer-side deposit creates symmetry: every party at the table has skin in the game.

### Mechanics

| Event | Money movement |
|---|---|
| Farmer books a processor slot for an animal | Farmer is charged a refundable deposit. Default: $100 flat OR 10% of estimated total processing fee, whichever is higher. Held in platform Stripe escrow. |
| Processor confirms drop-off via QR scan | Deposit released back to farmer (Stripe refund or credit toward processing fee). |
| Farmer cancels ≥ 7 days before drop-off | Full deposit refund. |
| Farmer cancels 3–6 days before | 50% deposit refund (covers processor's lost-slot opportunity cost). |
| Farmer cancels < 72 hours before | 0% refund — full forfeit. Processor keeps the deposit as compensation for the wasted slot. |
| Farmer no-show on day-of | 0% refund + farmer flagged + customer auto-refunded by platform. |
| Farmer-fault force majeure (animal died, vet emergency) | Full refund with vet documentation. Tier-2 review. |

### Sizing the deposit

Default at $100 OR 10% of estimated total processing — whichever is greater — covers most scenarios:

- Steer with $750 expected processing → $100 deposit (~13% of slot cost)
- Hog with $250 expected processing → $100 deposit (40% of slot cost)
- Whole 4-day processing job at $1,500 → $150 deposit (10%)

Should it be configurable by processor? Likely yes (some high-demand processors will want more skin in the game). Default platform-wide, processor can raise within bounds.

### What the farmer sees at booking

```
You're booking Hilltop Custom Meats for Thu, Jun 21.
   Expected processing fee: $720
   Refundable booking deposit: $100
                                ─────
   Charged today: $100

This deposit is refunded automatically when the processor checks in your animal.
If you cancel ≥7 days out, you get the full $100 back. Inside 7 days the deposit
covers the processor's lost slot. Read full terms.
```

### Edge cases

- **Farmer dispute over deposit forfeit**: Tier-2 escalation, processor must show the slot was wasted (not re-filled). If processor backfilled the slot from the marketplace, deposit returns to farmer.
- **First-purchaser is also the farmer (rare)**: e.g. farmer buying their own remaining 25% per the donation flow. Deposit waived since farmer is on both sides.
- **Multi-animal booking**: deposit per animal, not per booking.
- **Animal dies pre-drop-off**: full refund of deposit upon vet documentation.

### Engineering scope

- New Stripe payment intent at booking time (separate from customer-side reservation)
- New `farmerDeposits` Firestore collection, linked to `booking.id`
- Integration with check-in event (auto-release on QR scan)
- Cancel timing logic (≥7d / 3-6d / <72h / no-show)
- Farmer-facing deposit explainer in booking flow
- Farmer dashboard line item: "Deposits in escrow: $X"

**Effort:** ~6 dev-days.

---

## 5. How the three features compose

```
Day 1: Farmer books slot for Steer #402 at Hilltop, Thu June 21.
       → $100 deposit charged to farmer
       → Booking appears on processor's queue view as "○ scheduled"
       → Customer reservations can pile in

Day 14 (Jun 7): T-14 reminder to farmer.
                → No deposit movement.

Day 18 (Jun 11): Farmer transports animal.
                → Farmer marks "departed" → notification only
                → Booking on processor queue still "○ scheduled"

Day 18 (later): Farmer arrives at Hilltop. Pulls up trailer.
                → Farmer pulls up QR code on phone (or printed sticker)
                → Processor opens queue view, taps booking
                → Processor scans QR with phone camera
                → State flips to "✓ checked in"
                → Server triggers:
                     - F5 email to farmer ("Hilltop confirmed drop-off")
                     - Customer email 16 to all buyers ("Animal arrived")
                     - $100 deposit refunded to farmer
                     - Kill fee payout authorized to processor
                     - Audit log: GPS coords, photo, timestamp
                → Farmer leaves; processor moves to next item on queue.
```

```
Alternate: Farmer no-shows on Day 18.
       → 24-hour grace window (rare reasons: late arrival)
       → Booking shows "⚠ overdue" on processor queue
       → Hour 25: state flips to "✗ no-show"
       → Customer auto-refund triggered
       → Farmer flagged
       → Farmer's $100 deposit forfeit; transferred to processor
       → F11 "we didn't see your animal" email to farmer
```

---

## 6. What this closes

- ✅ "Queue view (Outlook-style) for processor" — Feature A
- ✅ "Only processor does check-in" — Feature B
- ✅ "Dropoff deposit for farmer" — Feature C
- ✅ "Farmer says animal dropped off, processor doesn't" corner case — eliminated by Feature B
- ✅ "Farmer is no-show at scheduled time" corner case — structurally addressed by Feature C
- 🟡 Partial: "Stripe customization" bug — adds a new payment-intent flavor (farmer deposit), needs implementation

---

## 7. Open questions for Mychal

1. **Deposit amount default**: $100 flat OR 10% of estimated processing — whichever is greater. **Lock at this default?**
2. **Processor configurability**: should processors be able to raise the deposit (within bounds) for their high-demand slots? Recommend: yes, capped at $300.
3. **QR code display medium**: physical sticker mailed to farmer with the booking, OR digital QR shown on farmer's phone? Recommend: digital with optional sticker for farmers who don't carry smartphones.
4. **6-digit fallback**: confirm we want this for desktop-only processors. Recommend: yes, low cost.
5. **Should the dropoff deposit go through Stripe Connect with the processor, or platform-held escrow?** Recommend: platform-held escrow. Cleaner accounting; processor sees the credit only on forfeit/refund events.

Once those five are locked, engineering can sequence the work.

### Sequence recommendation

Build in this order:

1. **Feature B (check-in)** first. ~5 days. Without this, A and C don't have a reliable trigger.
2. **Feature A (queue view)** second. ~10 days. Daily-use UX for processors. Pays back the most operational pain.
3. **Feature C (dropoff deposit)** third. ~6 days. Builds on B's check-in event for refund automation.

Total: ~21 dev-days for the full processor operations stack.
