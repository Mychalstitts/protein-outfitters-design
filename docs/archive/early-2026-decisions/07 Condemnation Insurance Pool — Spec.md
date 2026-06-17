# Condemnation Insurance Pool — Specification

_Author: Claude (Cowork session) · Date: May 3, 2026 · Pairs with: 04 Refund Policy_

---

## 1. What it is, in 30 seconds

A platform-managed reserve that absorbs the cost of an animal being condemned at federal inspection so that the customer is fully refunded, the farmer doesn't eat the loss, and the processor still gets paid for the kill they performed. Funded by an opt-in 2% line item at customer checkout plus an initial seed.

Without this pool, condemnation forces an awkward four-way negotiation. With it, the platform absorbs the loss and writes one entry to a deferred-liability account. Engineering, accounting, and customer experience all get cleaner.

---

## 2. Why a pool, not a third-party insurer

Real livestock insurance for "animal-condemned-at-inspection" is hard to buy at marketplace scale and the premiums are high relative to the actual loss frequency (industry condemnation rate ≈ 0.05–0.20% on USDA-inspected fed cattle, higher on cull cows). A self-funded pool is cheaper and faster than third-party for the small-to-medium-share-volume stage, with the option to layer external reinsurance later.

---

## 3. Money mechanics in Stripe

### 3a. Pool account

The pool lives as **a dedicated Stripe Connected Account** (or a logical sub-balance on the platform account, depending on tax structure). Recommended: a separate Stripe account `acct_condemnation_pool` so pool funds are isolated from operating cash. Same legal entity, separate bookkeeping.

### 3b. Customer contribution flow

When the customer opts in at checkout:

```
charge:                       $X.XX (deposit)
            ├─ to platform-fee:        platform fee
            ├─ to farmer (delayed):    locked-price × fraction × 25%
            ├─ to processor (delayed): kill-fee allocation × 25%
            └─ to pool:                2% × deposit total
                        (transfer to acct_condemnation_pool, immediate)
```

The 2% rides the same Stripe `transfer_group = share.id` so it stays attributable in audit. On balance capture (T-7), the same 2% transfer happens against the remaining 75%.

### 3c. Pool draw on condemnation

When `animal.status = 'condemned'`, the pool issues these transfers:

```
from: acct_condemnation_pool
   ├─ to: each customer (via Stripe Refund chained from original charge):
   │       full refund of customer's paid amount
   ├─ to: processor: kill fee they performed (still owed for work done)
   ├─ to: farmer: $0 (animal yields nothing to sell, no farmer payout)
   └─ platform: $0 (waive platform fee for the affected reservation)
```

If the customer hasn't yet had their balance captured at the time of condemnation (rare — condemnation happens at processing day, balance captured at T-7), only their deposit is refunded.

The pool is the buyer-of-last-resort: it pays the processor so the processor isn't left short-changed by an event outside their control. This is how the platform credibly says "the kill fee is on us, not the farmer or processor."

### 3d. Top-up and reserve target

```
Reserve target = 6 months × expected condemnations × avg cost per condemnation
              = (annual_share_count × 0.001) / 2 × ($800 average)
              ≈ at 5,000 shares/year: 5000 × 0.001 / 2 × 800 = $2,000

Initial seed       $25,000  (covers ~30 condemnation events at avg $800)
Top-up trigger     pool balance falls below $10,000
Top-up source      platform operating account; treated as a contribution
                   to the pool, not a loan
```

Reasoning for the conservative seed: early-stage marketplace volume is low and noisy. One bad month with two large-animal condemnations could draw $4–6k from a $2k target. The $25k seed survives statistical clustering until volume smooths it out.

If volume grows past 5,000 shares/year, recompute target every quarter and let the seed shrink toward the formula. Excess pool funds ≥ 150% of target can be returned to platform operating per §6.

---

## 4. Accounting treatment

This isn't revenue. The 2% the customer paid is a **deferred liability** on the balance sheet — money the platform holds with a contractual obligation to deploy on condemnation events. Specifically:

| Event | Debit | Credit |
|---|---|---|
| Customer pays 2% pool fee at checkout | Cash (Stripe pool acct) | Deferred liability — Pool obligations |
| Condemnation refund paid to customer | Deferred liability — Pool obligations | Cash (Stripe pool acct) |
| Top-up from operating | Cash (Stripe pool acct), Pool reserve expense | Cash (operating) |
| Pool excess returned to operating (§6) | Cash (operating) | Deferred liability — Pool obligations (release) |
| Pool funds invested (§7) | Investment asset | Cash (Stripe pool acct) |

Tax treatment depends on how the pool is structured legally. Two common options:

- **Operating reserve (recommended starting point)** — pool sits inside Protein Outfitters LLC's books. The 2% inflows are **not** revenue; they're customer prepayments held against future obligations. Simpler. Consult a CPA before scaling.
- **Captive insurer / segregated cell** — eventually, if pool volume justifies it (millions in annual flow), spin the pool out as a captive insurance cell. Tax-favored treatment for premiums, but adds compliance overhead.

A CPA should sign off before launch. Document the policy in your accounting memo so the auditor can follow it.

---

## 5. Reporting and transparency

The pool is a trust signal. Make it visible.

### Public-facing (lightweight)

A small section on `proteinoutfitters.com/policies/refunds`:

> **Condemnation Reserve**
> Balance as of {{date}}: {{pool_balance_pretty}}
> Events covered last 12 months: {{events_12mo}}
> Customers refunded last 12 months: {{customers_refunded_12mo}}
> Total reimbursed last 12 months: {{total_refunded_12mo}}

Updated nightly from a cron job that reads the Stripe pool account balance and the audit log. No login required to view. Builds trust without exposing customer-level detail.

### Internal-facing (admin)

A dashboard tile on the admin command center:
- Current balance
- Reserve target (vs actual, % headroom)
- Trailing 12-month draw rate
- Top-up history
- Pending refunds in flight (amount + ETA)
- Anomaly flag if any single event > 3× rolling-90d average draw

### To regulators / partners (on request)

A signed quarterly attestation from your CPA confirming pool segregation and balance. Future investors will ask for this; staying ahead saves a fire drill later.

---

## 6. Excess and shortfall rules

### Excess

If pool balance exceeds **150% of reserve target** for two consecutive quarters, return the excess to platform operating per the accounting entry in §4. Don't let the pool become a slush fund.

If a customer cancels a reservation that was opted into the pool and the cancellation occurs **before drop-off**, refund the 2% pool contribution back to the customer along with their other refundable amounts. This is contractually a prepayment for an obligation that no longer exists.

If they cancel after drop-off (the no-refund window), the 2% has already covered the period of risk and is retained.

### Shortfall

If the pool balance is below the top-up trigger ($10k) the system auto-transfers from operating to pool to bring it back to target.

If the pool would otherwise go **negative** (e.g. catastrophic event with multiple simultaneous condemnations), platform operating covers the gap immediately and the auditor flag is raised. This must be a non-blocking event for the customer — they get their refund regardless. The platform is the backstop.

Set a **daily draw cap** in code so a malicious or buggy actor can't drain the pool. Recommended: $5,000 per 24h; admin override required above that.

---

## 7. Investment policy

The pool sits in cash by default. Once balance is consistently > $100k, consider a **conservative investment policy**:

- 90% in money market or short-term Treasuries
- 10% in operating cash for instant draw
- No equity exposure
- No instruments with > 90 day liquidity timeline

Until that scale, leave it in the Stripe pool account.

---

## 8. Pricing the 2%

The 2% is set so that at **expected loss**, the pool breaks even on the customer cohort that opts in:

```
breakeven_premium / share_value
  = expected_loss_rate × avg_loss_severity / share_value
  ≈ 0.001 × $800 / $2,000 (typical half-share price)
  ≈ 4 basis points
```

Pure expected-loss math says < 0.05% would clear it. Charging 2% is roughly 50× the expected loss — generous margin to:
1. Build reserve faster
2. Cover adverse selection (the customers who opt in are more risk-averse / paranoid; their share-level loss rate is higher)
3. Keep the math simple at the line-item level (a flat 2% is easier to communicate than 4 bps)

Revisit annually. If trailing 12-month draw rate stays well below the contribution rate, drop to 1.5% or 1%. The customer-friendliness of "we charge less than we used to" is a marketing gift.

### Alternative: flat $50

Mychal's "For Myke" decision card asks 2% vs flat $50. Flat $50:
- Easier to communicate
- Regressive on small shares (a $50 fee on a $400 ¼-share is 12.5%; absurd)
- Generous on large shares ($50 on a $4,000 whole is 1.25%; under-prices the risk slightly for big animals)

**Recommendation: percentage-based.** Flat fees are clearer but bad for a marketplace where share sizes vary 10×. Stick with 2%.

---

## 9. Edge cases

### "Animal condemned mid-processing" (post-drop-off, post-kill, but mid-cut)

USDA can condemn product after kill if a disease shows up in fabrication. In this case:
- Kill fee already released to processor — stays released.
- Customer fully refunded (deposit + balance).
- Pool eats: customer refund + farmer's locked price × fraction (because farmer owes nothing back to customer; farmer's payout simply doesn't materialize since no meat).

### "Partial condemnation" (one quarter has issue, others don't)

Rare but real. Two paths:
- Most processors will discard the affected primal and continue. Treat as a **quality complaint** at the customer level (file 05, email 19), not a pool draw, since meat is still produced.
- If a substantial portion is lost (> 25% by weight), pro-rate the pool refund: customer gets the affected fraction's share of their payment refunded; the remainder ships normally. Allocate processor payment to actual hanging weight processed.

### "Customer didn't opt in to pool but animal is condemned"

Customer still gets full refund. We never punish a customer for a no-fault loss just because they didn't opt in. The pool absorbs it; opt-in customers effectively cross-subsidize non-opt-ins.

This is a deliberate generosity — it costs us slightly more but the alternative (telling a non-opting customer "tough luck") is brand-damaging and reputationally unrecoverable. The 2% is positioned as belt-and-suspenders, not as the only path to a refund.

### "Adverse selection: only buyers of risky animals opt in"

Protect against this in two ways:
1. **Don't price by animal**. Price the 2% as a flat percentage of share value across all animals so the optionality value is similar for everyone. Buyers shouldn't be able to cherry-pick.
2. **Bundle into checkout default-on**, with a clear unchecking option. Most opt-in pricing wins go to default-on patterns. Watch the opt-out rate as a leading indicator of customer trust.

### "Pool overcollects during low-condemnation years"

§6 auto-rebates excess to operating once > 150% of target, so this self-corrects. If you want to be even more customer-friendly, send a "good year, here's a dollar back" credit to opt-in customers from prior 12 months when excess returns to operating. Marketing-positive, mechanically simple.

---

## 10. Regulatory considerations

**Insurance regulation.** Some states classify a self-funded customer reserve as quasi-insurance and require licensure. Minnesota's stance on this for a marketplace is ambiguous — defensible as "customer service guarantee" rather than insurance. **Get an insurance lawyer's opinion before launch.** A 30-minute call clarifies the question.

If the insurance-licensure risk is material, you can:
- Structure the 2% as a non-refundable platform fee with a contractual obligation to refund condemnation losses (still a customer-promise, but legally a service guarantee, not insurance)
- Partner with a licensed reinsurer for the catastrophic tail and self-fund the body
- Spin out a captive insurer in a friendly jurisdiction (Vermont is the standard)

**Stripe terms of service.** Confirm with Stripe that the pool account structure and the chained refund pattern is acceptable for your platform agreement. They are usually fine with it but document the pattern in your Stripe support thread.

**Consumer-disclosure rules.** The 2% line item must be clearly labeled at checkout, the policy linked, and the opt-in default clearly disclosed. Standard FTC guidance.

---

## 11. Engineering work to ship this

| # | Item | Effort |
|---|---|---|
| 1 | Provision dedicated Stripe Connected Account for the pool | 1 day |
| 2 | Add 2% line item to checkout with toggle, default ON | 0.5 day |
| 3 | Wire transfer-on-charge for the 2% to the pool account | 1 day |
| 4 | Wire pool draw on `condemnation` event: refund customer chain + processor transfer | 2 days |
| 5 | Refund 2% on customer cancel pre-drop-off | 0.5 day |
| 6 | Pool dashboard tile on admin command center | 1 day |
| 7 | Public dashboard widget on policies page | 0.5 day |
| 8 | Daily draw cap + alerts | 0.5 day |
| 9 | Top-up automation when balance < $10k | 0.5 day |
| 10 | Quarterly excess-return job | 0.5 day |
| 11 | Audit log + accounting memo coordination with CPA | 1 day |
| **Total** | | **~9 dev-days plus ~1 lawyer/CPA day** |

Phase 1 (launch-ready): items 1–5, 8, 11.
Phase 2 (transparency + trust): items 6, 7, 9, 10.

---

## 12. What this closes on the Trello board

- ✅ "Optional condemnation insurance pool" Feature card
- ✅ "POLICY DECISION: condemnation insurance price — 2% of share or flat $50?" — recommended 2%, reasoning above
- ✅ "POLICY DECISION: condemnation insurance pool starting reserve ($25k seed)?" — yes, $25k seed defended in §3d
- ✅ Corner case "animal killed and disease found" — pool covers it cleanly
- ✅ Stripe split routing (Bug card) — split now includes pool transfer

## What still needs your call

1. Confirm 2% (vs flat $50). Recommended: 2%.
2. Confirm $25k seed. Recommended: yes.
3. Confirm pool default-on at checkout. Recommended: default-on with clear unchecking.
4. Choose between "operating reserve" vs "captive insurance" structure with a CPA. Recommended: operating reserve until pool flow > $1M/year.
5. 30-minute insurance-lawyer call before launch. Strongly recommended.
6. Approve the $5k/24h draw cap.
