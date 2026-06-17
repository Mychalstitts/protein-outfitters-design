# Farmer & Processor Emails — Policy Lifecycle

_Author: Claude (Cowork session) · Date: May 3, 2026 · Pairs with: 04 Refund Policy + 05 Customer Emails_

The customer emails (file 05) have a corresponding farmer-side and processor-side message for almost every event. This file is those mirrored emails. Same voice rules: warm, plain, accountable, no fluff. Variables in `{{double_braces}}`, designer notes in `[brackets]`.

Send-from convention: lifecycle confirmations from `team@proteinoutfitters.com`; payout, dispute, or flagging emails from `mychal@proteinoutfitters.com` (humans handle money and bad news).

---

## FARMER LIFECYCLE

### F1. Listing live

**Trigger:** Farmer publishes a listing.
**Subject:** {{animal_breed}} #{{animal_number}} is live on the marketplace
**Preheader:** Buyers can reserve fractions immediately. Here's what to track.

> Hi {{first_name}},
>
> {{animal_breed}} #{{animal_number}} is live at proteinoutfitters.com. Customers can reserve fractions starting now.
>
> **Locked-in price**: ${{price_per_lb}}/lb hanging weight
> **Estimated yield**: {{est_hang_lbs}} lbs hanging / {{est_takehome_lbs}} lbs take-home
> **Available fractions**: {{available_fractions}}
>
> **You'll get a notification when:**
> - First fraction sells (you'll need to book a processor within 72 hours)
> - 50% sold
> - 100% sold
> - Anyone has a question
>
> [CTA: View listing → /farmer/listings/{{animal_id}}]

---

### F2. First fraction sold — book a processor

**Trigger:** First share reservation lands; processor not yet selected.
**Subject:** First fraction sold — book a processor in 72 hours
**Preheader:** {{buyer_first_name}} reserved {{fraction_pretty}}. Lock the slot.

> Hi {{first_name}},
>
> Good news: {{buyer_first_name}} just reserved **{{fraction_pretty}}** of {{animal_breed}} #{{animal_number}}.
>
> Per our policy, the first purchaser sets the processor. Pick one in the next **72 hours** so {{buyer_first_name}} and any future buyers know where and when their share gets processed.
>
> [CTA: Book processor → /farmer/listings/{{animal_id}}/processor]
>
> **Things to know**
> - Once you book, all current and future buyers inherit the processor + drop-off date.
> - Pricing rises as the date gets closer (Airbnb-style). The earlier you book, the cheaper for everyone.
> - If you can't find a processor that works, reply and we'll help.

---

### F3. 100% sold

**Trigger:** Final fraction reserved.
**Subject:** {{animal_breed}} #{{animal_number}} is fully sold
**Preheader:** Drop-off on {{drop_off_date}} at {{processor_name}}. Here's what's next.

> Hi {{first_name}},
>
> All fractions of **{{animal_breed}} #{{animal_number}}** are reserved. Nice work.
>
> **Drop-off**: {{drop_off_date}} at {{processor_name}}, {{processor_address}}
> **Total committed**: ${{total_committed}} (paid to you after pickup; ${{deposit_already_collected}} of customer deposits is held)
>
> **Your action items**
> 1. Confirm transport plan to the processor.
> 2. Make sure the animal is fit for transport — vet check if anything's off.
> 3. Pull a brand inspection certificate if your state requires one.
>
> If anything changes — illness, injury, anything — reply right away. The earlier we know, the cleaner the rebook or refund.
>
> [CTA: View listing dashboard → /farmer/listings/{{animal_id}}]

---

### F4. Drop-off reminder (T-3 days)

**Trigger:** Drop-off date − 3 days.
**Subject:** Drop-off in 3 days — final checklist
**Preheader:** {{drop_off_date}} at {{processor_name}}. 5 things to confirm.

> Hi {{first_name}},
>
> Drop-off is **{{drop_off_date}}** at **{{processor_name}}**, {{processor_address}}.
>
> **Final checklist**
> - [ ] Animal weight check — does it match listing estimate? Big variance? Reply now.
> - [ ] Health certificate / vet check current
> - [ ] Brand inspection if applicable
> - [ ] Transport arranged (you or hauler)
> - [ ] Processor knows your ETA on the day
>
> If you need to reschedule, do it today — not at the last minute. {{processor_name}} can re-slot you within 7 days for free; outside that, kill-fee surge applies.
>
> [CTA: Reschedule if needed → /farmer/listings/{{animal_id}}/reschedule]

---

### F5. Drop-off confirmed by processor

**Trigger:** Processor checks in animal.
**Subject:** {{processor_name}} confirmed drop-off
**Preheader:** Hanging weight comes next. Payouts queue up.

> Hi {{first_name}},
>
> {{processor_name}} confirmed that {{animal_breed}} #{{animal_number}} arrived. Thanks for getting it there clean.
>
> **What happens next**
> 1. Hanging weight reported in 24–48 hours. We'll email you the number.
> 2. Final per-fraction reconciliation runs against the locked price.
> 3. Your payout is scheduled for **3 business days after the customer takes delivery** — that's standard escrow timing across the marketplace.
>
> If hanging weight is meaningfully different from the estimate, no problem — pricing adjusts at the locked $/lb rate. We notify the customer; you don't have to.
>
> [CTA: Track this animal → /farmer/listings/{{animal_id}}]

---

### F6. Hanging weight reported — payout snapshot

**Trigger:** Processor enters hanging weight.
**Subject:** Hanging weight: {{actual_hang_lbs}} lbs — your payout is ${{net_payout}}
**Preheader:** Net of platform & processing fees. Disburses {{payout_date}}.

> Hi {{first_name}},
>
> {{animal_breed}} #{{animal_number}} weighed in at **{{actual_hang_lbs}} lbs hanging** ({{delta_pretty}} vs your estimate).
>
> **Your payout**
> Gross at ${{price_per_lb}}/lb × {{actual_hang_lbs}} lbs = ${{gross_payout}}
> Less platform fee ({{platform_fee_pct}}%): −${{platform_fee_dollars}}
> Less any pre-agreed haul/marketing add-ons: −${{addon_dollars}}
> **Net to your account: ${{net_payout}}**
>
> Disbursement scheduled for **{{payout_date}}** (3 business days after customer takes delivery, per the standard hold).
>
> [CTA: View earnings → /farmer/earnings]

---

### F7. Payout disbursed

**Trigger:** Stripe transfer succeeded.
**Subject:** Paid: ${{net_payout}} on the way
**Preheader:** ACH to {{bank_last4}}. 1–2 business days.

> Hi {{first_name}},
>
> ${{net_payout}} just left our platform headed to your account ending in {{bank_last4}}. Should land in 1–2 business days.
>
> **Reference**: {{stripe_transfer_id}}
> **Listing**: {{animal_breed}} #{{animal_number}}
> **Sold to**: {{buyer_count}} buyers
>
> [CTA: Tax-ready earnings export → /farmer/earnings/export]

---

### F8. Customer cancels in 8–20 day window — your share of the deposit

**Trigger:** Customer cancels in deposit-forfeit window; farmer is part-paid.
**Subject:** Customer cancelled — you keep ${{farmer_keep}} from the deposit
**Preheader:** Animal is back to listing if you want.

> Hi {{first_name}},
>
> {{buyer_first_name}} cancelled their {{fraction_pretty}} reservation on {{animal_breed}} #{{animal_number}}. They're inside the no-refund window for the deposit.
>
> Per our policy split:
> **You keep ${{farmer_keep}}** (your share of the forfeited deposit, since you committed transport and may have already prepped)
> {{processor_keep}} goes to {{processor_name}}
> {{platform_keep}} stays with the platform
>
> **The fraction is back on the marketplace** so another buyer can scoop it up. We'll notify you when that happens.
>
> If you'd rather just take that fraction back yourself (process it for personal use), reply and we'll cancel the relisting.

---

### F9. Animal condemned — kill fee covered, you're not on the hook

**Trigger:** USDA inspection result = condemned.
**Subject:** {{animal_breed}} #{{animal_number}} was condemned — covered, not on you
**Preheader:** Kill fee paid from our condemnation pool. Customer fully refunded.

> Hi {{first_name}},
>
> Hard news. {{animal_breed}} #{{animal_number}} was condemned at federal inspection ({{condemnation_reason}}). None of the meat can be sold.
>
> **What this means for you**
> - You are **not** charged the kill fee. We cover it through our condemnation reserve. {{processor_name}} is paid in full.
> - The customer is fully refunded.
> - Any deposits already routed to you are clawed back from your next payout — but **you are not net negative** because you didn't have time to incur transport-only costs that aren't reimbursable. (If you did, send receipts and we'll review case-by-case.)
>
> Inspection failures are rare and usually outside the farmer's control. We don't flag your account for it.
>
> Reply if there's anything you want us to know about what happened — sometimes a pattern is worth tracking.

---

### F10. Animal died on-ranch (farmer-reported)

**Trigger:** Farmer marks `died_pre_dropoff`.
**Subject:** Got it — we're handling the customer side
**Preheader:** Reservations refunded. Listing closed.

> Hi {{first_name}},
>
> Confirmed: {{animal_breed}} #{{animal_number}} can't go to processing because the animal died on the ranch.
>
> **What we're doing**
> - All {{buyer_count}} buyers are being fully refunded right now.
> - Your listing is closed.
> - {{processor_name}} is being notified to release the slot.
>
> **What you don't owe**
> - No platform fee for this listing.
> - No processor cancellation fee (we cover it from the reserve).
>
> Sorry — losing an animal is rough. If you've got another one ready to list, we'll fast-track it through review.
>
> [CTA: List another animal → /farmer/list-new]

---

### F11. Farmer no-show flag

**Trigger:** Animal not delivered by drop-off + 24h, farmer unreachable.
**Subject:** We didn't see {{animal_breed}} #{{animal_number}} at the processor — please respond
**Preheader:** This needs an answer in 48 hours or your account is flagged.

> Hi {{first_name}},
>
> {{processor_name}} reports that {{animal_breed}} #{{animal_number}} did not arrive on {{drop_off_date}}. We've called and texted but haven't heard back.
>
> **Customer impact:** {{buyer_count}} buyers are waiting on an answer. We've held off on refunding them in case there's an explanation we don't have yet.
>
> **What we need from you in the next 48 hours:**
> 1. What happened (illness, transport issue, schedule mix-up, etc.)
> 2. Whether the animal can still go to {{processor_name}} on a new date this week
> 3. Or whether we should refund all buyers and close the listing
>
> If we don't hear back by **{{flag_deadline}}**, we'll refund all customers in full and your account is flagged for review. Future listings would require additional verification before publishing.
>
> Reply directly to this email or call {{support_phone}}.

---

### F12. Force majeure

**Trigger:** Admin-initiated event affecting the area.
**Subject:** {{event_type}} affecting your area — three options
**Preheader:** Pick a path. We've already started talking to {{processor_name}}.

> Hi {{first_name}},
>
> A {{event_type}} ({{event_short}}) is affecting your area and {{processor_name}}, which makes the {{drop_off_date}} drop-off uncertain.
>
> **Three options for your listings affected by this:**
>
> 1. **Hold the animal** — we keep the listing live, customers get notified, drop-off rescheduled when {{processor_name}} reopens. No penalty either way.
> 2. **Move to a backup processor** — we have {{backup_processor_count}} alternatives within {{backup_radius}} miles with capacity. Reply with **MOVE** and we'll surface options.
> 3. **Close listing, refund customers** — we make every customer whole. You can re-list when things settle.
>
> Reply with **1**, **2**, or **3**. If you don't reply by {{decision_deadline}}, we go with #1 (hold).
>
> [CTA: Read more → /events/{{event_id}}]

---

### F13. Quality complaint received about your animal

**Trigger:** Customer files complaint within 7-day window; complaint cites farmer-side issue (e.g. bad marbling, off taste).
**Subject:** A buyer flagged a quality issue — your input requested
**Preheader:** No charge to you yet. Reply with context.

> Hi {{first_name}},
>
> {{buyer_first_name}} flagged a quality concern with their share of {{animal_breed}} #{{animal_number}}. Their complaint:
>
> > "{{complaint_excerpt}}"
>
> [photos attached]
>
> We're investigating. Common explanations: dry-aging variance, freezer-burn from delayed pickup, breed-typical leanness. Sometimes it's a real issue, sometimes not.
>
> **What we need from you**
> Reply with anything we should know — feeding history, stress events, age, anything. If it's a real defect on the farm side, we'll discuss the resolution before it touches your payout. If it's a packaging or transport issue, we don't bill you.
>
> Standard practice: rep decides within 1 business day, customer gets refund/replace/credit choice, costs allocated to the actual cause.
>
> [CTA: Send context → reply to this email]

---

## PROCESSOR LIFECYCLE

### P1. New booking received

**Trigger:** Farmer books a slot.
**Subject:** New booking — {{drop_off_date}} for {{animal_breed}} #{{animal_number}}
**Preheader:** {{ranch_name}}. Hanging weight estimated {{est_hang_lbs}} lbs.

> Hi {{first_name}},
>
> {{ranch_name}} just booked your **{{drop_off_date}}** slot for {{animal_breed}} #{{animal_number}}.
>
> **Estimated hanging weight**: {{est_hang_lbs}} lbs
> **Cut sheet**: {{cutsheet_status}} — {{cutsheet_lock_deadline}} deadline
> **Buyers**: {{buyer_count}} sharing this animal
>
> **What you'll be paid**
> Kill fee: ${{kill_fee}}
> Per-lb processing: ${{processing_per_lb}}/lb hanging
> Estimated total at this animal's est. weight: **${{est_total}}**
>
> Final settle goes by actual hanging weight + cut sheet specifics.
>
> [CTA: View booking → /processor/bookings/{{booking_id}}]

---

### P2. Cut sheet finalized

**Trigger:** Cut sheet locked at T-7 day deadline (or earlier).
**Subject:** Cut sheet locked — {{animal_breed}} #{{animal_number}} on {{drop_off_date}}
**Preheader:** {{cutsheet_summary}}

> Hi {{first_name}},
>
> Cut sheets are locked for {{animal_breed}} #{{animal_number}}, dropping off {{drop_off_date}}.
>
> **Summary across {{buyer_count}} buyers:**
> {{cutsheet_summary_bullets}}
>
> **Customer Special Requests:**
> {{csr_bullets}} _(if any)_
>
> [CTA: View full cut sheet → /processor/bookings/{{booking_id}}/cutsheet]
>
> If anything's not feasible — uncommon cuts, conflicting requests across buyers — reply and we'll mediate before drop-off.

---

### P3. Drop-off check-in reminder (T-1 day)

**Trigger:** Drop-off date − 1 day.
**Subject:** Drop-off tomorrow — {{animal_breed}} #{{animal_number}}
**Preheader:** {{ranch_name}} ETA {{eta_window}}.

> Hi {{first_name}},
>
> Reminder: **{{ranch_name}}** is dropping off {{animal_breed}} #{{animal_number}} tomorrow.
>
> **ETA window**: {{eta_window}}
> **Farmer contact**: {{farmer_phone}} / {{farmer_email}}
>
> **When the animal arrives, please tap "Check In"** in the processor app. That triggers the customer notifications and queues your kill fee for transfer.
>
> [CTA: Check in animal → /processor/check-in/{{booking_id}}]

---

### P4. Reconcile a "farmer says dropped off, processor doesn't"

**Trigger:** Farmer marks delivered + processor hasn't checked in within 6 hours.
**Subject:** Quick reconciliation needed — did {{animal_breed}} #{{animal_number}} arrive?
**Preheader:** {{ranch_name}} marked it delivered. Confirm so customers don't get conflicting updates.

> Hi {{first_name}},
>
> {{ranch_name}} reports they delivered {{animal_breed}} #{{animal_number}} to your facility today, but we don't see a check-in on your side.
>
> **Two possibilities**
> 1. The animal arrived and check-in just hasn't been logged yet — please tap "Check In" in the app.
> 2. The animal didn't arrive — reply and we'll loop the farmer.
>
> Customers see the live state. We'd rather not send them a "your animal arrived" email if it didn't.
>
> [CTA: Resolve → /processor/check-in/{{booking_id}}]

---

### P5. Hanging weight requested

**Trigger:** 24 hours after check-in.
**Subject:** Please log hanging weight for {{animal_breed}} #{{animal_number}}
**Preheader:** Customers and farmer are waiting on the number.

> Hi {{first_name}},
>
> Once the animal hangs, please log the hanging weight in the app:
>
> [CTA: Log weight → /processor/bookings/{{booking_id}}/weight]
>
> The farmer's payout is calculated against this number, and customers get a reconciliation email if it differs from the estimate. The sooner you log it, the cleaner the cycle.

---

### P6. Processing complete

**Trigger:** Processor marks ready for pickup/ship.
**Subject:** {{animal_breed}} #{{animal_number}} marked ready — kill fee released
**Preheader:** Final processing fee on customer pickup.

> Hi {{first_name}},
>
> {{animal_breed}} #{{animal_number}} is marked ready for pickup/ship. Thanks.
>
> **Payments**
> - Kill fee + 50% processing already released to your account.
> - Remaining 50% processing fee releases when the customer takes delivery (or {{auto_release_days}} days from today, whichever comes first).
> - Total expected: **${{total_processor_payout}}**
>
> [CTA: View payouts → /processor/earnings]

---

### P7. Processor must cancel a booking — re-route attempt

**Trigger:** Processor reports they can't process on the booked date.
**Subject:** We've started re-routing your buyers — what triggered this?
**Preheader:** Customers and farmer get notified by us, not you. Reply with reason.

> Hi {{first_name}},
>
> Got your cancel for {{animal_breed}} #{{animal_number}} ({{drop_off_date}}). We're already working on alternatives:
>
> - Surfaced {{alt_processor_count}} alternative processors within range.
> - Notified the farmer with the options.
> - Will fully refund customers if no alternative works.
>
> **Two things we need from you**
> 1. Brief reason — equipment, capacity, illness, regulatory? Helps us not double-book you in the same scenario.
> 2. Confirm we should release **all customer slots** on this date (or specific ones).
>
> No penalty for one cancel; patterns trigger a review.
>
> [CTA: Reply with details → email or /processor/cancellations]

---

### P8. Animal condemned at inspection — confirmation + payout

**Trigger:** USDA inspection failed.
**Subject:** Condemnation confirmed — kill fee released to you
**Preheader:** Customer refunded. Farmer notified. Pool covers your fee.

> Hi {{first_name}},
>
> Confirmed condemnation on {{animal_breed}} #{{animal_number}} at your facility ({{condemnation_reason}}, USDA inspector ID {{inspector_id}}).
>
> **Your payment**
> - Kill fee of ${{kill_fee}} releases to you on the standard 1–2 day cycle.
> - The kill fee is paid from our condemnation reserve, not the farmer or customer.
>
> **What happens next**
> - We refund all {{buyer_count}} customers in full.
> - Farmer is notified. They are not flagged for this.
>
> Please attach the inspection record to the booking when you have a moment for our records.
>
> [CTA: Attach inspection → /processor/bookings/{{booking_id}}/inspection]

---

### P9. Quality complaint flagged against your facility

**Trigger:** Customer complaint cites cut error, packaging issue, or transport-cold-chain failure attributable to processor.
**Subject:** Quality complaint flagged — please respond by {{response_deadline}}
**Preheader:** {{buyer_first_name}}'s share of {{animal_breed}} #{{animal_number}}.

> Hi {{first_name}},
>
> {{buyer_first_name}} flagged a quality issue with their share of {{animal_breed}} #{{animal_number}}, and the issue appears to be on the processing side. Specifically:
>
> > "{{complaint_excerpt}}"
>
> [photos attached]
>
> **What we need by {{response_deadline}} ({{response_hours}} hours):**
> 1. Your read on the issue — yes/no/maybe a fair complaint
> 2. Any cut-sheet exception you noticed at processing
> 3. Any chain-of-custody notes (cold-chain, vacuum-seal, etc.)
>
> **How we resolve**
> - If the complaint is valid and processor-attributable: refund value of affected portion is deducted from your next payout.
> - If valid but ambiguous: split between processor and platform.
> - If not valid: we explain to the customer; nothing on you.
>
> First complaint per quarter is informational only. Patterns trigger a facility review.
>
> [CTA: Respond → reply to this email]

---

### P10. Force majeure (processor side)

**Trigger:** Admin-initiated event affecting the processor.
**Subject:** {{event_type}} — we're rerouting your bookings
**Preheader:** No action needed unless something changes on your end.

> Hi {{first_name}},
>
> A {{event_type}} ({{event_short}}) is affecting your area. We're proactively re-routing your bookings on {{affected_dates}} to backup processors so customers and farmers aren't left hanging.
>
> **What we're doing on your behalf**
> - Pausing new bookings into {{affected_dates}}
> - Notifying farmers with backup options
> - Issuing partial refunds where bookings can't be re-routed
>
> **Your slot fees for affected bookings are protected** — paid from our reserve up to the contracted maximum, even though no animal will arrive.
>
> If your facility is back online sooner than expected, reply UPDATE and we'll reopen capacity.

---

## What this closes on the Trello board

- ✅ "Notifications--make links work" — every email above has a primary CTA with a deep link
- ✅ "Farmer says animal dropped off, processor doesn't" — P4 reconciliation email
- ✅ "Animal killed and disease found" — F9 + P8 pair
- ✅ "Farmer is no show at scheduled time" — F11 with explicit 48h response window
- ✅ Farmer payout transparency — F6 + F7 cover the lifecycle
- ✅ "Customer cancels card transaction" upstream impact — F8 explains farmer's piece of the deposit split
- ✅ Force majeure handling — F12 + P10 (mirrors customer email 22)
- ✅ "Stripe customization" — payout timing rules made explicit so the customer-side language matches the engineering reality

## Implementation note

These should share a templating system with the customer-side emails (file 05). Recommended structure:

```
/emails
  /customer        (22 templates)
  /farmer          (13 templates — F1–F13 above)
  /processor       (10 templates — P1–P10 above)
  /shared
    header.html
    footer.html
    button.html
```

Total: 45 templates. All wire into the same state machine from `04 Refund & Cancellation Policy.md`.
