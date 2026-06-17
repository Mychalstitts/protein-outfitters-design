# Email Additions — Ante-mortem condemnation & Chargebacks

_Author: Claude (Cowork session) · Date: May 3, 2026 · Append to: 05 Customer Emails + 06 Farmer & Processor Emails_

These are the email templates that didn't fit into the original 22 customer + 23 farmer/processor sets. They cover the ante-mortem condemnation sub-case (animal arrives sick, fails inspection before kill) and the chargeback flow (customer disputes a charge through their bank instead of in-app).

Voice: same as 05/06. From `mychal@proteinoutfitters.com` for trust-sensitive items, `team@` for confirmations.

---

## ANTE-MORTEM CONDEMNATION

### A1. Customer email — animal failed pre-kill inspection

**Trigger:** `animal.status = 'condemned_ante_mortem'` (animal arrived sick, never killed).
**Subject:** {{animal_breed}} #{{animal_number}} couldn't be processed — full refund inside
**Preheader:** Animal failed pre-kill inspection. You're refunded in full.

> Hi {{first_name}},
>
> {{animal_breed}} #{{animal_number}} arrived at {{processor_name}} but didn't pass federal pre-kill inspection ({{condemnation_reason}}). The animal was not slaughtered.
>
> **You are refunded in full: ${{total_paid}}** to {{card_brand}} ending in {{card_last4}}, within 5–10 business days. Nothing to do on your end.
>
> The kill fee is not charged because no kill happened. Our condemnation reserve covers your refund and {{processor_name}}'s time. {{ranch_name}} is not flagged — pre-kill failures often catch a problem the farmer couldn't have known about, and that's exactly what inspection is for.
>
> If you'd like to reserve another animal at the same locked price of ${{price_per_lb}}/lb, reply REPLACE in the next 14 days and we'll surface options.
>
> [CTA: Browse the marketplace → /]

---

### A2. Farmer email — your animal failed pre-kill inspection

**Trigger:** Same as A1.
**Subject:** {{animal_breed}} #{{animal_number}} didn't pass pre-kill inspection
**Preheader:** Animal returned to you. No kill fee. Customer refunded.

> Hi {{first_name}},
>
> Tough one. {{animal_breed}} #{{animal_number}} arrived at {{processor_name}} today and the USDA inspector flagged a pre-kill condition — {{condemnation_reason}}. The inspector did not approve the animal for slaughter.
>
> **What happens next**
> 1. The animal is yours to take back. Coordinate with {{processor_name}} on transport off the lot in the next 24 hours.
> 2. **No kill fee charged.** Pre-kill condemnations cost you nothing on the platform side.
> 3. Your **$100 dropoff deposit** is refunded in full within 1–2 business days.
> 4. The {{buyer_count}} customers who reserved fractions are being refunded on our dime.
>
> **What we'd ask of you**
> If you've got insight on what the inspector caught (long-distance hauling stress? recent illness?), reply with context. We'll keep it on file in case it's a pattern, but **you are not flagged** — this is exactly why pre-slaughter inspection exists.
>
> If you can replace this animal with another from your herd, reply REPLACE and we'll fast-track a new listing.

---

### A3. Processor email — please return animal to farmer

**Trigger:** Same as A1.
**Subject:** Pre-kill condemnation — release {{animal_breed}} #{{animal_number}} back to {{ranch_name}}
**Preheader:** Kill fee paid in full from condemnation reserve.

> Hi {{first_name}},
>
> Confirmed: {{animal_breed}} #{{animal_number}} did not pass pre-kill inspection at your facility today (USDA inspector ID {{inspector_id}}).
>
> **What we're doing**
> 1. Releasing the animal back to {{ranch_name}}; coordinate transport with {{farmer_first_name}} ({{farmer_phone}}).
> 2. **Your time is paid.** A pre-kill inspection processing fee of ${{pre_kill_fee}} releases to your account within 1–2 business days from our condemnation reserve.
> 3. We've notified the farmer and all {{buyer_count}} affected customers.
>
> **Documentation**
> When you get a moment, please attach the inspection record to the booking. Helps us keep the chain-of-custody clean.
>
> [CTA: Attach inspection → /processor/bookings/{{booking_id}}/inspection]

---

## CHARGEBACK FLOW

### C1. Customer email — heads-up the chargeback was received

**Trigger:** Stripe `charge.dispute.created` webhook fires.
**Subject:** Heads up — your bank just opened a dispute on your reservation
**Preheader:** We've received it. Tell us if this isn't something you started.

> Hi {{first_name}},
>
> Your bank ({{card_brand}}) opened a dispute on your reservation for **{{animal_breed}} #{{animal_number}}** today — reason code {{reason_code}} ({{reason_description}}).
>
> If you started this dispute and meant to: no further action needed. We'll respond per Stripe's process. You'll see the refund (if granted by your bank) within 5–10 business days.
>
> **If you didn't start this dispute** — that means someone else (a co-cardholder, a fraud-flag triggered by your bank, etc.) did, and we should sort it out directly. Reply to this email and we'll figure out what's going on.
>
> If you're inside our 21-day free-cancel window, the cleaner path is to use the in-app cancel — replies process immediately, no bank back-and-forth.
>
> [CTA: View reservation → /reservations/{{share_id}}]

---

### C2. Internal email — chargeback opened, evidence packet pending

**Trigger:** Same as C1, sent to support@.
**Subject:** [DISPUTE] ${{amount}} chargeback on share {{share_id_short}} — deadline {{response_deadline}}
**Preheader:** Reason: {{reason_code}}. Default rec: {{default_action}}.

> Internal — please review.
>
> **Dispute summary**
> Stripe ID: {{stripe_dispute_id}}
> Amount: ${{amount}}
> Reason code: {{reason_code}} — {{reason_description}}
> Customer: {{customer_name}} ({{customer_email}})
> Share: {{share_id}} · {{animal_breed}} #{{animal_number}}
> Response deadline: {{response_deadline}}
>
> **Default recommendation:** {{default_action}}
> {{default_reason}}
>
> **Quick links**
> [CTA: Open in Disputes admin → /admin/disputes/{{chargeback_id}}]
> [CTA: View share → /admin/shares/{{share_id}}]
> [CTA: View cut sheet → /admin/cutsheets/{{cutsheet_id}}]
> [CTA: View delivery proof → {{delivery_proof_url}}]
>
> **Action required by {{response_deadline_minus_2d}}**
> If we let this lapse, Stripe accepts the dispute on our behalf.

---

### C3. Customer email — we're contesting (shipped, you got it)

**Trigger:** Admin clicks "Build evidence & contest" in DisputesAdminScreen.
**Subject:** About the dispute on your reservation — here's what we have on file
**Preheader:** Delivery confirmed {{delivery_date}}. Cut sheet matched. Reach out if there's a real issue.

> Hi {{first_name}},
>
> Your bank opened a dispute on your **{{animal_breed}} #{{animal_number}}** reservation citing {{reason_description}}. We've reviewed our records and we don't see a problem on our end:
>
> {{#if reason_code == '4855'}}
> - Delivered: {{delivery_date}} at {{delivery_address}}
> - Carrier confirmation: {{carrier_tracking_url}}
> - Recipient signature: {{signature_url}}
> {{/if}}
> {{#if reason_code == '4863'}}
> - Cut sheet preset: {{cutsheet_preset}}
> - Allocation: {{allocated_lbs}} lbs across {{cut_count}} cuts
> - Processor: {{processor_name}} (Compliance Score {{compliance_score}})
> {{/if}}
>
> We've submitted this evidence to your bank. If there is a real issue we missed — wrong cuts, off-spec, anything — please reply to this email rather than going through your bank. We can resolve it faster and more generously than the chargeback process can.
>
> Either way, the bank's decision typically takes 30–60 days. We'll let you know how it lands.

---

### C4. Customer email — we're accepting the chargeback (ack)

**Trigger:** Admin clicks "Accept dispute" in DisputesAdminScreen.
**Subject:** Refund processing on your reservation
**Preheader:** Your bank's dispute is being honored. Refund coming.

> Hi {{first_name}},
>
> We're honoring the dispute your bank opened on your **{{animal_breed}} #{{animal_number}}** reservation. **${{amount}}** is being refunded to your {{card_brand}} ending in {{card_last4}} via Stripe; the timing is up to your bank but typically 5–10 business days.
>
> If we got something wrong on our end, we're sorry — and the team note below is on file with our processor partner:
> > _{{decision_note}}_
>
> If you'd like to give us another shot in the future, reply ANOTHER and we'll waive the platform fee on your next reservation. No pressure either way.

---

## What this closes

- ✅ Trello "ante-mortem condemnation handling" sub-flow card (added in this session) — A1, A2, A3 emails + state machine branch in functions/src/index.ts
- ✅ Chargeback playbook (file 09 §2) — C1–C4 emails + DisputesAdminScreen.tsx + acceptChargeback / submitChargebackEvidence Cloud Functions

## Implementation notes

These templates plug into the same Klaviyo flow as the 22 customer + 23 farmer/processor templates. Trigger events:
- `animal_condemned_ante_mortem` → fires A1/A2/A3 in parallel
- `stripe.charge.dispute.created` → fires C1 + C2 (internal)
- Admin contests dispute → fires C3
- Admin accepts dispute → fires C4
