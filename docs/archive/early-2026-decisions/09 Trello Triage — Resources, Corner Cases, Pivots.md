# Trello Triage — Cool Things, Corner Cases, Changing Functionality

_Author: Claude (Cowork session) · Date: May 3, 2026_

This document triages three Trello columns that hadn't been touched in the earlier policy walkthrough: **Cool things to know about**, **Corner Cases**, and **changing functionality**. For each item: what it is, whether it's resolved, and what to do next.

---

## 1. "Cool things to know about" — three resources

### 1a. DeepFilterNet2 (Hugging Face)
**What it is:** A real-time speech enhancement / noise-suppression model. Strips background noise from voice audio.

**Why it matters here:** Two plausible uses in this product.
1. **Customer-support voice notes**: when a buyer leaves a voice message about a quality complaint while standing in a noisy kitchen, run it through DeepFilterNet so the support rep can actually hear the words.
2. **Farmer-side check-ins from noisy environments**: a farmer recording a quick "dropped off the steer" voice note from a windy parking lot at the processor.

**Verdict:** Real but optional. Don't ship it for v1 — keep it as a phase-2 enhancement when voice messaging is added to the support inbox.

**Action:** Keep the link, move it from "Cool things to know about" to a future "Voice features" idea card under Features. No urgency.

---

### 1b. PlayHT / PlayDiffusion (Hugging Face)
**What it is:** Text-to-speech. PlayHT is an established TTS service; PlayDiffusion is the Hugging Face Space demo.

**Why it matters here:** Lower-tier accessibility play. Cut sheets are dense — auto-generating a 60-second voice walkthrough of a customer's cut sheet ("you're getting eight ribeyes at 1 inch, two chuck roasts at three pounds...") is a nice trust touch and a possible accessibility feature for sight-impaired buyers.

**Verdict:** Nice-to-have, not core. Skip for v1.

**Action:** Same as 1a — file under "Voice features" idea card. No urgency.

---

### 1c. sameday.ai
**What it is:** Same-day local delivery routing API (carrier marketplace + dispatch).

**Why it matters here:** This is the most strategically relevant of the three. Today the shipping path is "insulated box + dry ice + multi-day carrier delivery." Same-day local delivery from processor to consumer's home would be a major customer-experience and cost win for the metro buyers within ~25 miles of a processor. Fits the "Uber + Airbnb of meat" framing.

**Verdict:** Worth a real evaluation. Specifically:
- Cost per delivery vs cost of dry-ice shipping for short-distance buyers
- Insulated-cooler handling on courier side (do their drivers handle frozen meat correctly?)
- Geographic coverage relative to your processor + buyer footprint
- Integration: API quality, webhook reliability, delivery proof

**Action:** Actually use the credentials to log in (yourself, not Claude — the credentials are visible to anyone with Trello access right now, see security note below) and explore. Make a yes/no call on integrating.

**Bigger-picture action:** If sameday.ai works, the Step 4 prototype (file 08) has a "Pickup at processor / Ship for $89" choice — same-day delivery becomes a third option there for nearby buyers.

---

### Security note (re-flagged)

The plaintext credentials for sameday.ai (username and password) are sitting on a public-to-the-board Trello card. Anyone with access to that board sees them. This is a real risk because (a) the email belongs to someone outside Protein Outfitters (`pruhland@watscoventures.com`), so leakage exposes a third party, and (b) that password works for an account that can dispatch real-world deliveries.

Concrete fix:
1. Move the credentials into 1Password / Bitwarden / equivalent.
2. Replace the Trello card content with: "sameday.ai eval account — credentials in [shared vault location]."
3. Remove the password from anywhere else it's been pasted (Slack DMs, email, Notion, etc.).

There's already a Lights On card tracking this. Just bumping it.

---

## 2. Corner Cases — coverage audit

### Already resolved by existing policy/email work (3 cards marked done in Trello)
- ✅ "customer doesn't fill cut sheet" → Skip → Processor's Choice fallback in cut-sheet step (file 02 §5, file 05 email 3)
- ✅ "farmer wants to change price of animal after fraction has sold" → first-purchaser locks price (Decision Log #11 affirmed it)
- ✅ "farmer wants to add processors after fraction is sold" → first-purchaser locks processor too (Decision Log #11)

### Resolved-on-paper, but needs more design work (4 still open)

| # | Corner case | Today's resolution | Residual gap to close |
|---|---|---|---|
| 1 | **Farmer says animal dropped off, processor doesn't** | P4 reconciliation email + 6-hour state-machine grace window | **Dual-attestation drop-off**: needs a real protocol so this dispute stops happening. See spec file 10. |
| 2 | **Animal killed and disease found** | Condemnation insurance pool covers refunds + processor kill fee (file 07) | Sub-cases not fully spec'd: ante-mortem failure, post-mortem-fabrication failure, customer-table failure (rare e.g. trichinosis discovery). Quick sub-spec below. |
| 3 | **Customer cancels card transaction** | Refund state machine handles in-app cancels (file 04 §5) | **Stripe chargebacks** are a separate animal — chargeback reason codes, evidence packet, dispute timeline. Needs a chargeback playbook. Below. |
| 4 | **Farmer is no-show at scheduled time** | F11 email + 48h flag policy | **Reputation/repeat-offender system** not designed. **Dropoff deposit** (changing-functionality card) is the structural fix. See file 10. |

### Sub-spec: condemnation timing variations (closes corner case #2 fully)

```
Ante-mortem condemnation (animal arrives sick, fails inspection before kill)
  → Kill fee NOT charged
  → Animal returned to farmer (or destroyed at farmer's election + cost)
  → Customer fully refunded from pool
  → Farmer is NOT flagged unless this is repeat behavior (3+ events / 12 months)
  → P8 email replaced with a different "ante-mortem" variant that frames as "no kill happened"

Post-mortem-fabrication condemnation (animal killed clean, disease found during cutting)
  → Already covered by Pool Spec §9 partial-condemnation rules
  → Customer gets pro-rata refund on affected primal portion only
  → Processor gets full kill fee + processing on the salvaged portion

Customer-table failure (extremely rare, e.g. trichinosis claim from buyer)
  → NOT a condemnation pool draw — this is a public-health-reporting event
  → Escalate to Tier-3 (you, Mychal) immediately
  → Notify state agriculture department as required
  → Pool covers customer refund as goodwill, but the legal posture changes
```

### Chargeback playbook (closes corner case #3)

When a customer initiates a chargeback through their bank/card issuer (instead of the in-app cancel), Stripe forwards a dispute. The platform has 7–21 days to respond depending on reason code.

**Reason-code triage:**

| Code | Meaning | Likely actual reason | Default response |
|---|---|---|---|
| 4853 / "fraudulent" | They claim they didn't authorize the charge | Possibly real fraud, or remorse | Investigate logs (Apple Pay biometric? IP? device?). If suspicious, refund. Otherwise contest with auth proof. |
| 4855 / "non-receipt" | "I never got my meat" | Order delayed, or customer forgot / wrong household member | Contest with delivery/pickup proof, photos, signature. Strong case if delivery confirmed. |
| 4860 / "credit not processed" | They claim refund owed wasn't issued | Probably true — failed Stripe refund | Re-issue refund immediately, drop dispute. |
| 4863 / "not as described" | "Quality / wrong cuts / off-spec" | Real complaint that bypassed our window | Refund what's owed, contest the rest with cut sheet + chain-of-custody docs. |
| 4870 / "card recovery bulletin" | Card was on a lost/stolen list at time of charge | Almost always lose this one | Accept, refund, eat the cost. |

**Default policy:** If the disputed amount is ≤ $250 and we don't have airtight evidence, accept the chargeback rather than fight it. The cost of fighting + risk of losing exceeds the lost revenue.

For chargebacks > $250 with strong evidence (delivery proof, signed receipt, cut-sheet match, etc.), build the evidence packet and contest. Stripe's win rate when you contest with documentation is around 35%.

**Engineering work**: a "Disputes" admin view that surfaces Stripe webhook events, the relevant cut sheet + delivery confirmation + email log per `share.id`, and a button to "Submit evidence" or "Accept dispute." Trello card to add.

---

## 3. Changing functionality — 5 pivots

### Status of each

| # | Pivot | Status |
|---|---|---|
| 1 | **First Purchaser picks processor. Cutsheet before payment!** | ✅ DONE — built into Reserve & Customize 4-step flow (Decision Log #11) |
| 2 | **Custom cutsheets based on processor and fraction** | 🟡 PARTIAL — animal-aware branching is in the prototype (file 03), but processor-specific cut options aren't. Needs processor-side config. |
| 3 | **Queue view (Outlook-style) for processor** | ❌ NOT STARTED — major UX work. Spec below. |
| 4 | **Only processor does check-in** | 🟡 PARTIAL — implied by current state machine, but not enforced as the sole authoritative event. Spec in file 10. |
| 5 | **Dropoff deposit for farmer** | ❌ NOT STARTED — structurally addresses farmer no-show. Spec in file 10. |

### Spec: Processor-specific cut options (closes #2)

Each processor has a config in their dashboard:

```yaml
processor: "Hilltop Custom Meats"
species_supported: [beef, hog, lamb]   # no venison or poultry
cut_options:
  beef:
    available_cuts: [ribeye, ny_strip, tenderloin, ...] # excludes uncommon
    smoking_offered: [bacon (pork only), summer_sausage]
    grinding_options: [80/20, 85/15]   # no 90/10
    upcharge_per_lb:
      stew_meat: 1.00
      ground_in_chubs: 0.50
      vacuum_seal: 0.30
  hog:
    available_cuts: [...]
```

When the customer is on Step 3 (cut sheet), Step 3 reads the inherited processor's config and only renders cut options that processor offers. Photos/CSR box stay generic.

**Engineering work:** Processor config dashboard (one-time setup) + Step 3 reads `processor.cutOptions` instead of hard-coded list. Trello card to add.

### Spec: Processor queue view + dropoff deposit + processor-only check-in

These three are tightly coupled and deserve their own spec doc → see **10 Processor Operations Spec.md**.

---

## 4. Trello cleanup recommendations

### Cool things to know about
- Move all 3 cards out of "Cool things to know about" — it shouldn't be a permanent column. Rename it to "Reference" or merge into a Notion/wiki page. Trello isn't for stable references.

### Corner Cases
- Mark the 4 still-open cards as "resolved by spec" with comment links to the relevant doc files. They're not gone, just tracked elsewhere now.

### changing functionality
- Mark #1 done.
- Add comment with status to each remaining card (✅ DONE / 🟡 PARTIAL — see spec / ❌ NOT STARTED — see spec).
- Cards #3, #4, #5 spawn new Features cards for the actual implementation.

### New cards to add to Features
1. Processor config dashboard (cut options, smoking, grinding, upcharges)
2. Cut sheet reads processor config (not hard-coded)
3. Disputes admin view for Stripe chargebacks + chargeback evidence packet builder
4. Processor queue view (Outlook-style) — see spec 10
5. Dropoff deposit for farmer — see spec 10
6. Processor-only check-in enforcement — see spec 10
7. Farmer reputation / strike system (3-strikes for no-show)
8. Sub-flow: ante-mortem condemnation handling (variant of P8 email + state)

I'll add these to Trello after this doc lands.
