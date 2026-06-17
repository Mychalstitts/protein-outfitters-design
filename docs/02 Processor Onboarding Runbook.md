# Processor Onboarding Runbook
*The exact sequence to bring a new USDA-inspected processor onto the platform. Owner: Operations. Updated May 3, 2026.*

## Purpose
Take a processor from "interested" to "first booking accepted on platform" in 14 calendar days, with no compliance gaps.

## Roles
- **Ops lead** — drives the sequence. Default: Mychal.
- **Processor primary** — usually the plant manager or owner.
- **Engineering on-call** — for Stripe Connect onboarding bugs.
- **Counsel** — for the Processor Agreement signature.

## Pre-flight
Before scheduling the kickoff call, the processor must:
- [ ] Hold a current USDA Grant of Inspection (request copy via email).
- [ ] Be in operation 12+ months OR have processed 100+ animals OR carry $1M+ general liability.
- [ ] Operate within the launch geo (MN, WI, ND, SD).
- [ ] Have at least one named primary contact with email and direct phone.

If any of these fail, decline politely. Save the contact in HubSpot as `disqualified - [reason]`.

## Day 0 — Kickoff call (60 min)
**Agenda:**
1. Plant capacity overview — animals/week by species.
2. Walk through the live site at proteinoutfitters.com — show /processor dashboard, /site-visit, /processor-saas pricing.
3. Pricing — confirm SaaS tier (Starter / Standard / Premium) and per-animal cut.
4. SaaS contract — send Processor Agreement via DocuSign right after the call.
5. Site visit — book within 7 days.

**Outputs:**
- HubSpot deal moved to `Onboarding · Day 0`.
- Site visit on calendar.
- Processor Agreement out for signature.

## Day 1–3 — Stripe Connect onboarding
1. Send the processor a Stripe Connect onboarding link via the platform admin tool.
2. They complete KYC + bank linking on Stripe-hosted form.
3. Engineering verifies `connectedAccountId` lands in Firestore `processors/{id}`.
4. Test a $1 transfer using Stripe Test mode.

**If KYC stalls:** Most common issue is EIN mismatch with bank records. Have the processor pull their IRS EIN letter; the legal entity name on the Stripe form must match exactly.

## Day 3–7 — Site visit
**Bring:**
- Tablet with the /site-visit Stitch screen open.
- Camera (phone is fine — photos go into the report).
- The plant's USDA establishment number.

**Check:**
- HACCP plan posted and current.
- Walk-in cooler temperatures within range.
- Sanitation log up to date.
- Customer-cut staging area separate from inspected-product flow.
- Vehicle access for our QR check-in process — confirm a phone-readable display location.

**Output:** Site visit report submitted via the /site-visit form. Stored in Firestore. Visible to admin only.

If anything fails, the processor doesn't go live. Document the gap. Schedule re-visit.

## Day 7–10 — SaaS subscription + dashboard training
1. Trigger `createProcessorSubscription` Cloud Function — moves them from `pending` to `active`.
2. Hand them their `/processor` dashboard login.
3. 30-minute training call covering:
   - Reading the queue.
   - Booking incoming animals.
   - QR check-in flow at the gate.
   - Updating cut sheets the buyer submitted.
   - Marking an animal "ready for pickup" — fires the buyer email.
   - Submitting chargeback evidence.

## Day 10–14 — Soft launch
- Add the processor to the live `/producers` and `/map` views.
- Limit visibility to admin-flagged test producers initially. After 5 successful bookings, lift the flag.
- Klaviyo flow: trigger PO · 02 to any waitlisted buyer in the processor's geo.

## Day 14 — Go live
- Processor is publicly bookable.
- Ops lead sends a Slack to #launch-watch confirming.
- HubSpot deal moves to `Active · Tier [N]`.

## Ongoing — every 90 days
- Site re-visit.
- USDA Grant of Inspection renewal check.
- Reconcile their Stripe payouts against platform revenue.
- Review any chargebacks they're a party to.

## Escalation paths
- **Stripe KYC blocked** → Stripe support + post in #stripe-help.
- **USDA suspension on a partner plant** → Pause their listings immediately via admin tool. Contact counsel.
- **Buyer dispute escalating** → Open in /admin disputes triage. Tag #cs-escalation.
- **Plant goes dark for 7+ days** → Auto-pause via existing health-check function. Ops lead reaches out.

## Templates available
- Welcome email (Klaviyo, to be authored).
- Processor Agreement (counsel-drafted, in DocuSign templates folder).
- Site visit report (live at /site-visit).
- 30-day check-in script (to be authored).

## Definition of done
A processor is fully onboarded when:
- USDA inspection verified ✅
- Stripe Connect account live + tested ✅
- Site visit report submitted, no open findings ✅
- Processor Agreement signed ✅
- SaaS subscription active ✅
- Dashboard training completed ✅
- 5 successful test bookings ✅
- HubSpot deal in `Active` ✅
