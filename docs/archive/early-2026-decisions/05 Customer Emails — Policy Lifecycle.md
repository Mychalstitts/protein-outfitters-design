# Customer Emails — Policy Lifecycle

_Author: Claude (Cowork session) · Date: May 3, 2026 · Pairs with: 04 Refund & Cancellation Policy.md_

These are the customer-facing email templates that operationalize the refund and cancellation policy. Each one fires on a specific state transition. Voice is warm, plain-English, accountable — same tone as the policy doc.

Variables in `{{double_braces}}` are merge fields. Anything in `[brackets]` is a designer note, not part of the email.

---

## 1. Reservation confirmation

**Trigger:** Stripe deposit captured, share row written.
**Subject:** Reserved — {{animal_breed}} #{{animal_number}}, {{drop_off_date}}
**Preheader:** Your share is locked in. Here's what happens next.

> Hi {{first_name}},
>
> Your reservation is locked in.
>
> **{{fraction_pretty}} of {{animal_breed}} #{{animal_number}}**
> {{ranch_name}} · {{ranch_city}}, {{ranch_state}}
> Drop-off: **{{drop_off_date}}** at {{processor_name}}
> Estimated take-home: {{est_take_home_lbs}} lbs
>
> Today we charged your **25% deposit of ${{deposit_amount}}**. The balance of ${{balance_amount}} will be charged on **{{balance_capture_date}}** — 7 days before drop-off.
>
> **What happens next**
> 1. Customize your cut sheet anytime before {{cutsheet_deadline}}. We'll send a reminder. (If you skip it, your processor uses a sensible default.)
> 2. We'll email you when the animal is dropped off, killed, processed, and ready.
> 3. Pickup or shipment lands {{est_ready_date}}.
>
> **You can cancel for a full refund anytime before {{free_cancel_deadline}}** — that's 21 days before drop-off. After that the deposit is non-refundable. Full policy: proteinoutfitters.com/policies/refunds
>
> If anything goes wrong on our end — animal condemned, processor cancels, farmer no-shows — we make you whole. Always.
>
> Questions: support@proteinoutfitters.com or tap "Get help" in the app.
>
> [CTA: View your reservation → /reservations/{{share_id}}]

---

## 2. Cut sheet reminder (T-14)

**Trigger:** Drop-off date − 14 days, cutsheet not yet finalized.
**Subject:** Two weeks out — pick your cuts when you have a minute
**Preheader:** Or skip it and your processor will use defaults. Either's fine.

> Hi {{first_name}},
>
> Your share is dropping off in two weeks. If you want to choose your own cuts — steak thickness, roasts vs ground, brisket, etc. — now's a good time.
>
> [CTA: Customize cut sheet → /reserve/{{animal_id}}/cutsheet]
>
> No pressure. If you don't fill it out, your processor uses a balanced "Processor's Choice" default. You'll still get great meat.
>
> Final deadline: {{cutsheet_deadline}}.

---

## 3. Cut sheet → Processor's Choice fallback

**Trigger:** Drop-off date − 1 day, cutsheet still empty.
**Subject:** Heads-up: we're going with Processor's Choice on your cuts
**Preheader:** A balanced default. You can still text us special requests.

> Hi {{first_name}},
>
> Your share drops off tomorrow and we don't have a cut sheet on file, so {{processor_name}} will use their **Processor's Choice** default — a balanced mix of steaks, roasts, and ground beef. Most customers are happy with it.
>
> If there's anything specific you want (extra ribeyes, hold the liver, etc.), reply to this email in the next 6 hours and we'll forward it to the processor.
>
> [CTA: Text the processor → opens prefilled email]

---

## 4. Balance-capture coming up (T-9 days, 2-day heads-up)

**Trigger:** Drop-off − 9 days.
**Subject:** Heads-up — final balance posts in 2 days
**Preheader:** ${{balance_amount}} on {{balance_capture_date}}.

> Hi {{first_name}},
>
> Quick reminder: the balance on your reservation posts on **{{balance_capture_date}}**.
>
> Card on file: {{card_brand}} ending in {{card_last4}}
> Balance: **${{balance_amount}}**
>
> If you need to update your card, do it before {{balance_capture_date}}.
>
> [CTA: Update payment method → /me/payment]

---

## 5. Balance captured

**Trigger:** Successful PaymentIntent at T-7.
**Subject:** Balance posted — see you on {{drop_off_date}}
**Preheader:** Your share is fully paid. Here's what's next.

> Hi {{first_name}},
>
> The balance of **${{balance_amount}}** posted today. Your share is fully paid.
>
> **Drop-off**: {{drop_off_date}} at {{processor_name}}, {{processor_city}}.
>
> We'll email you when {{animal_breed}} #{{animal_number}} arrives at the processor.
>
> [CTA: View reservation → /reservations/{{share_id}}]

---

## 6. Card decline — 72-hour grace

**Trigger:** PaymentIntent failed at balance capture.
**Subject:** We couldn't charge your card — please update by {{grace_deadline}}
**Preheader:** 72 hours to fix this before we have to release your share.

> Hi {{first_name}},
>
> We tried to capture the **${{balance_amount}}** balance on your reservation today and the charge was declined.
>
> Card on file: {{card_brand}} ending in {{card_last4}}
> Decline reason: {{decline_reason}}
>
> Please update your payment method by **{{grace_deadline}}** ({{grace_hours_remaining}} hours from now). If we can't capture by then, we'll have to release your share back to the marketplace and the 25% deposit becomes non-refundable per our policy.
>
> [CTA: Update payment now → /me/payment]
>
> If something's wrong on our end (it happens), reply and we'll fix it.

---

## 7. Card decline — final, share released

**Trigger:** PaymentIntent still failing at T-4 days.
**Subject:** Your share has been released
**Preheader:** We couldn't capture the balance. Deposit is non-refundable per policy.

> Hi {{first_name}},
>
> We weren't able to capture your balance after several attempts and the 72-hour grace window. Per the cancellation policy you agreed to at reservation, your share has been released back to the marketplace and the **25% deposit (${{deposit_amount}}) is non-refundable**.
>
> We're sorry — this is the part of the policy nobody likes. The farmer and processor commitments were already in motion, which is why deposits become non-refundable inside the 7-day window.
>
> When you're ready to try again, the marketplace is right where you left it. The first one's on us — reply with "ANOTHER" and we'll waive the platform fee on your next reservation.
>
> [CTA: Browse the marketplace → /]

---

## 8. Customer-initiated cancel — full refund (≥21 days)

**Trigger:** Customer taps Cancel before T-21.
**Subject:** Cancellation confirmed — full refund on the way
**Preheader:** We'll have ${{refund_amount}} back to your card in 5–10 business days.

> Hi {{first_name}},
>
> Got it — your reservation for **{{fraction_pretty}} of {{animal_breed}} #{{animal_number}}** is cancelled.
>
> **Refund: ${{refund_amount}}** (everything you paid)
>
> The refund will hit your {{card_brand}} ending in {{card_last4}} within 5–10 business days.
>
> No hard feelings. If circumstances change, the marketplace is right here.
>
> [CTA: Browse other animals → /]

---

## 9. Customer-initiated cancel — deposit forfeit (8–20 days)

**Trigger:** Customer taps Cancel between T-8 and T-20.
**Subject:** Cancellation confirmed — partial refund on the way
**Preheader:** ${{refund_amount}} refunded. ${{deposit_amount}} deposit is non-refundable per policy.

> Hi {{first_name}},
>
> Your reservation is cancelled.
>
> **Refund: ${{refund_amount}}** (everything except the 25% deposit)
> Non-refundable deposit: ${{deposit_amount}}
>
> A heads-up so this doesn't sting: the deposit covers the farmer and processor commitments that were already in motion. You can read why at proteinoutfitters.com/policies/refunds.
>
> Your refund will land on {{card_brand}} ending in {{card_last4}} within 5–10 business days.
>
> [CTA: Browse other animals → /]

---

## 10. Customer-initiated cancel — inside 7-day window (no refund)

**Trigger:** Customer taps Cancel between T-1 and T-7.
**Subject:** We can't refund inside the 7-day window — but here's what we can do
**Preheader:** Read this before you decide.

> Hi {{first_name}},
>
> Cancelling inside the 7-day drop-off window means **no refund** per our policy — the farmer is already trucking the animal and the processor's slot is locked. We don't want you to walk away with nothing for the **${{total_paid}}** you paid.
>
> **Three things we can do instead:**
>
> 1. **Pickup at processor** — your meat is yours. Pick it up on {{ready_date}} and skip the shipping. We can help you find someone local to pick up if you can't.
> 2. **Ship anyway, then donate** — we ship the meat to a food bank near you and provide a tax letter for the full retail value.
> 3. **Transfer the share** — give it to a friend or family member. They get the meat, you get the goodwill. Free of charge.
>
> Reply to this email with **1**, **2**, or **3** and we'll handle it. If you reply CANCEL we'll process the cancel anyway, but the policy doesn't allow a refund.
>
> [CTA: Reply to this email]

---

## 11. Animal condemned — full refund

**Trigger:** USDA inspection result = condemned.
**Subject:** {{animal_breed}} #{{animal_number}} was condemned at inspection — you're refunded in full
**Preheader:** Not your fault, not your loss. Here are options.

> Hi {{first_name}},
>
> Tough news. **{{animal_breed}} #{{animal_number}}** was condemned at federal inspection at {{processor_name}} today. The USDA inspector found {{condemnation_reason}}, which means none of the meat can be sold.
>
> **You are refunded in full: ${{total_paid}}**
>
> The refund goes back to {{card_brand}} ending in {{card_last4}} within 5–10 business days. Nothing for you to do.
>
> We absorb the kill fee on our end through the condemnation reserve so the farmer and processor are made whole too. This is exactly the situation that reserve exists for.
>
> **Want to pick another animal?** We'll honor the same per-pound price you locked at on this one if you reserve a replacement in the next 14 days. Reply REPLACE and we'll surface comparable options.
>
> Sorry this happened. Inspection failures are rare but real, and we'd rather lose a cow than a customer's trust.
>
> [CTA: See similar animals → /search?similar={{animal_id}}]

---

## 12. Animal died pre-drop-off — full refund

**Trigger:** Farmer reports `animal.status = 'died_pre_dropoff'`.
**Subject:** {{animal_breed}} #{{animal_number}} can't be processed — you're refunded in full
**Preheader:** The animal died before drop-off. Here's what happens.

> Hi {{first_name}},
>
> Difficult message. {{ranch_name}} reported that **{{animal_breed}} #{{animal_number}}** died on the ranch before drop-off, so it can't go to the processor.
>
> **You are refunded in full: ${{total_paid}}** to {{card_brand}} ending in {{card_last4}}, within 5–10 business days. Nothing for you to do.
>
> If you'd like to reserve another animal at the same locked price, reply REPLACE and we'll line up comparable options for you in the next 14 days.
>
> [CTA: Browse the marketplace → /]

---

## 13. Processor cancellation — re-routed

**Trigger:** Processor unavailable, system found alternative.
**Subject:** Quick change — your animal moved to a new processor
**Preheader:** Same dates, same cut sheet, slightly different drive.

> Hi {{first_name}},
>
> {{old_processor_name}} can't process your share on {{drop_off_date}} after all (capacity issue on their end). We've moved your animal to **{{new_processor_name}}** in {{new_processor_city}} — same date, same cut sheet, same price.
>
> **What changes for you**
> Pickup location: {{new_processor_address}} ({{distance_change}} from the original)
>
> **What stays the same**
> Drop-off date, cuts, total cost, and the date your share is ready.
>
> If the new pickup spot doesn't work for you, reply and we'll either re-route again or refund you in full.
>
> [CTA: View updated reservation → /reservations/{{share_id}}]

---

## 14. Processor cancellation — no alternative, full refund

**Trigger:** Processor unavailable, no alternative within range.
**Subject:** Your processor cancelled and we can't find a backup — full refund
**Preheader:** Sorry. Refund is on the way and we'll help you find another animal.

> Hi {{first_name}},
>
> {{old_processor_name}} cancelled your slot for {{drop_off_date}} and we couldn't find another USDA-inspected processor within range that has open capacity in time.
>
> **You are refunded in full: ${{total_paid}}** to {{card_brand}} ending in {{card_last4}}, within 5–10 business days. Nothing to do on your end.
>
> If you want to start over, we'll honor the same per-pound price on a replacement animal you reserve in the next 14 days. Reply REPLACE and we'll surface options.
>
> Sorry this didn't work out.

---

## 15. Farmer no-show — full refund + apology

**Trigger:** `animal.status = 'farmer_no_show'`.
**Subject:** {{ranch_name}} didn't deliver the animal — you're refunded in full
**Preheader:** Not OK. They've been flagged. Refund is on the way.

> Hi {{first_name}},
>
> {{ranch_name}} did not deliver **{{animal_breed}} #{{animal_number}}** to {{processor_name}} on {{drop_off_date}}. We've been unable to reach them or confirm a new date.
>
> **You are refunded in full: ${{total_paid}}** to {{card_brand}} ending in {{card_last4}}, within 5–10 business days.
>
> The farmer has been flagged on the platform. Future reservations from {{ranch_name}} require additional verification, and our team is following up directly.
>
> If you want to reserve from another farm, reply REPLACE and we'll show you 3 comparable options at the same locked per-pound price.
>
> Sorry this happened.

---

## 16. Animal arrived at processor

**Trigger:** Processor confirms drop-off.
**Subject:** {{animal_breed}} #{{animal_number}} arrived at the processor
**Preheader:** Hanging weight comes next. Then the cuts.

> Hi {{first_name}},
>
> Quick update: **{{animal_breed}} #{{animal_number}}** arrived at {{processor_name}} today and check-in is complete. {{ranch_name}} delivered on time.
>
> Next milestone: hanging weight reported in 1–2 days. We'll email you the exact weight and any small balance reconciliation if it differs from the estimate.
>
> [CTA: Track this share → /reservations/{{share_id}}]

---

## 17. Hanging weight reconciliation

**Trigger:** Hanging weight reported, differs from estimate.
**Subject:** Hanging weight: {{actual_hang_lbs}} lbs — {{delta_direction}} ${{delta_amount}}
**Preheader:** Final reconciliation against your locked price.

> Hi {{first_name}},
>
> {{animal_breed}} #{{animal_number}} weighed in at **{{actual_hang_lbs}} lbs hanging** — {{delta_pretty}} versus the {{est_hang_lbs}} lb estimate.
>
> **What this means for you**
> {{#if delta_positive}}
> Your share is bigger than estimated. We'll capture an extra **${{delta_amount}}** at your locked price of ${{price_per_lb}}/lb hanging on {{capture_date}}.
> {{else}}
> Your share is a bit smaller than estimated. We'll refund **${{delta_amount}}** to {{card_brand}} ending in {{card_last4}} within 5–10 business days.
> {{/if}}
>
> Cuts come next.
>
> [CTA: View final breakdown → /reservations/{{share_id}}]

---

## 18. Ready for pickup / shipped

**Trigger:** State = processed.
**Subject (pickup):** Ready for pickup at {{processor_name}}
**Subject (shipped):** Shipped — tracking inside
**Preheader:** Your meat is done.

> Hi {{first_name}},
>
> Good news. **{{animal_breed}} #{{animal_number}}** is processed, packed, and ready.
>
> {{#if pickup}}
> **Pickup at**: {{processor_name}}, {{processor_address}}
> **Hours**: {{processor_hours}}
> **By**: {{pickup_deadline}} (after that there's a {{storage_fee}}/day storage fee)
> {{/if}}
>
> {{#if shipped}}
> **Tracking**: {{tracking_number}} via {{carrier}}
> **Estimated delivery**: {{est_delivery_date}}
> Shipping in an insulated box with dry ice. Refrigerate or freeze immediately on arrival.
> {{/if}}
>
> Once it's in your hands, you have **7 days to flag any quality issue** for a refund, replacement, or platform credit. Most customers won't need that — we just want you to know it's there.
>
> [CTA: View your share → /reservations/{{share_id}}]

---

## 19. Delivered — quality complaint window opens

**Trigger:** Carrier confirms delivery (or pickup confirmed).
**Subject:** Enjoy — and tell us if anything's off
**Preheader:** 7 days to flag any quality issue. Then we close the books.

> Hi {{first_name}},
>
> Your **{{fraction_pretty}} of {{animal_breed}} #{{animal_number}}** is delivered. We hope it's exactly what you hoped for.
>
> **If something's off** — wrong cuts, missing items, freezer-burn, spoilage in transit — let us know within **7 days** ({{complaint_deadline}}). Send a couple of photos and a short description. We'll review within 1 business day and offer a refund, replacement, or platform credit — your choice.
>
> Otherwise, enjoy the meat. Tag us on social if you cook something good.
>
> [CTA: Flag an issue → /reservations/{{share_id}}/complaint]

---

## 20. Quality complaint received

**Trigger:** Customer submits complaint.
**Subject:** We got it — review by {{review_deadline}}
**Preheader:** A real person looks at this within 1 business day.

> Hi {{first_name}},
>
> We received your complaint about your share of **{{animal_breed}} #{{animal_number}}**. A real person will review it by **{{review_deadline}}** ({{review_hours}} hours from now).
>
> **What we have**
> {{complaint_summary_bullet_list}}
>
> **What happens next**
> 1. We compare against your cut sheet and the processor's records.
> 2. We email you with three options: full refund of the affected portion, replacement from another share, or platform credit.
> 3. You pick.
>
> Hold on to the affected items if you can — sometimes we ask for a follow-up photo.
>
> [CTA: Track the complaint → /reservations/{{share_id}}/complaint]

---

## 21. Quality complaint resolved

**Trigger:** Support resolves complaint.
**Subject:** Resolved — pick how you want to be made whole
**Preheader:** Three options. You pick.

> Hi {{first_name}},
>
> Reviewed. Based on what you sent and what we have on file from {{processor_name}}, you're owed an adjustment of **${{credit_value}}** for {{affected_summary}}.
>
> **Pick one:**
>
> 1. **Refund** ${{credit_value}} to {{card_brand}} ending in {{card_last4}}
> 2. **Replacement** of equivalent value from your next share or from inventory
> 3. **Platform credit** of ${{credit_value_plus_15pct}} (15% bonus) toward your next reservation
>
> Reply with **1**, **2**, or **3**. We'll handle the rest.
>
> Thanks for telling us. The note is on file with the processor and will inform how we work with them going forward.

---

## 22. Force majeure notice

**Trigger:** Admin-initiated event affecting share.
**Subject:** {{event_type}} affecting your share — three options inside
**Preheader:** Date change, full refund, or platform credit. You pick.

> Hi {{first_name}},
>
> We need to flag something on your reservation. **{{event_type}}** ({{event_short_description}}) is affecting {{ranch_name}} and {{processor_name}}, which means your scheduled drop-off on **{{drop_off_date}}** can't happen as planned.
>
> Per our policy, you have three options. There is no extra charge for any of them.
>
> 1. **Reschedule** to a new drop-off date once {{processor_name}} reopens (we'll surface options when we have them).
> 2. **Full refund** of everything you paid, back to {{card_brand}} ending in {{card_last4}} within 5–10 business days.
> 3. **Platform credit** of {{total_paid_plus_10pct}} (10% bonus) toward a future reservation. Never expires.
>
> Reply with **1**, **2**, or **3**.
>
> Sorry this happened. None of us picked it.
>
> [CTA: Read more about this event → /events/{{event_id}}]

---

## Implementation notes

- All emails should send from a real human-named address (e.g. `mychal@proteinoutfitters.com` for refund/condemnation emails) for higher trust on the heavier topics. Lifecycle confirmations can come from `team@`.
- Plain-text fallback is identical to HTML — these are short enough not to need a fancy HTML template. A simple wordmark + text + button gets the job done.
- Localize amounts and dates to the customer's locale.
- Don't send a "Cut sheet reminder" if the customer already filled it out (gate on `cutSheet.preset !== null`).
- Stack-rank by trust impact: emails 7, 11, 12, 14, 15, 22 are the trust-makers. Spend extra editorial care on those.
- Track every send + open + reply to a single conversation thread per `share.id` so support has full context when a customer replies.

---

## What this closes on the Trello board

- ✅ The customer side of every refund-policy state transition
- ✅ The "no-refund inside 7 days" softener (email 10) addresses customer-experience risk
- ✅ Force majeure email (22) covers natural-disaster scenarios cleanly
- ✅ Complaint emails (19, 20, 21) make the 7-day quality window operational
- ✅ Card-decline cascade (6, 7) is fully covered
