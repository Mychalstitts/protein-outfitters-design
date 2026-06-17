# Donation Flow Spec — Producer Partnership Integration

_Author: Claude (Cowork session) · Date: May 3, 2026 · Pairs with `21 donation-flow-prototype.html`_

Decision Log #15 said yes: the Producer Partnership donation flow lives inside Step 1 of Reserve & Customize as a "Donate this fraction" toggle. Reuses ~95% of the marketplace pipeline. This doc specs what changes downstream.

---

## 1. The user story, in one paragraph

A farmer has 75% of an animal sold but the last 25% is sitting unfilled with three weeks until drop-off. Rather than relisting and hoping, the farmer flips a toggle on the unsold fraction to **donate it to local food banks/schools through Producer Partnership**. The animal flows through the same processor scheduling and cut sheet pipeline as paid sales — no extra work for the processor. Customers don't see the donated fraction (it's already "sold" from the marketplace's perspective, just to the nonprofit). The farmer gets a tax-letter receipt detailing the protein yield. Schools/food banks get the meat free. The platform charges no fee on donated portions.

---

## 2. Why a toggle, not a separate flow

Producer Partnership operates as a parallel program to the marketplace. Two options were on the table:

| Option | Pro | Con |
|---|---|---|
| Separate donation app | Clean conceptually | Doubles the code surface, doubles the user training, requires duplicate scheduling and cut sheet logic |
| Toggle on Step 1 (chosen) | Reuses 95% of the reservation pipeline; farmers fill animals without leaving the listing screen | Slightly more conditional logic in shared code paths |

The toggle is the right call as long as we keep the donation lane visually + verbally distinct so neither farmer nor customer is confused about who pays whom.

---

## 3. Where it lives

### 3a. Farmer-facing — listing dashboard

When a farmer's listing has unsold fractions, the listing-detail screen (farmer view, not buyer view) shows a banner:

> **3 weeks until drop-off.** Want to donate the remaining ¼ to local schools/food banks? You'll get a tax letter.
> [Donate this fraction] [Keep listed]

Tapping **Donate this fraction** opens the donation confirm sheet (see §5).

### 3b. In Step 1 of Reserve & Customize — visual differentiation only

For *buyers*, donated fractions are simply not shown. From the buyer's perspective there are 3 fractions of an animal available, then there are 2, etc. The donation isn't called out — it just looks like "1 left."

For *farmers* viewing their own listing in Step 1, donated fractions show a small accent badge (`Donated · tax letter pending`) so they remember.

### 3c. Admin / nonprofit dashboard — full visibility

Admin (Protein Outfitters team or partnered 501(c)(3) staff) sees a separate donation queue per processor location with:
- Animal · ranch · drop-off date
- Donated lbs (estimated → actual after kill)
- Recipient organization (assigned post-processing)
- Tax letter status (pending → generated → mailed)
- Funding source for the processor's kill fee (grant pool / corporate sponsor / monetary donations)

---

## 4. Flow diagram

```
Farmer toggles "Donate this fraction" on their listing
   ↓
Confirm sheet: shows tax letter explainer + donation agreement
   ↓
Farmer e-signs the Donation Agreement (digital deed of gift)
   ↓
Fraction is marked donated=true, buyer = NONPROFIT_PROCESSOR_PARTNERSHIP
   ↓
Marketplace UI hides the fraction from new buyers
   ↓
Animal continues through normal flow:
  - Drop-off + QR check-in (same)
  - Processor processes per cut sheet (default Processor's Choice)
  - Hanging weight reported (same)
   ↓
On hanging weight report → tax-letter generator runs
   ↓
Tax letter PDF emailed to farmer (D3 email)
   ↓
Meat distributed:
  - Routed to food bank or school per nonprofit's distribution plan
  - Recipient signs distribution receipt
   ↓
Farmer receives "delivered" notification (D5 email)
   ↓
End of cycle. No customer payments anywhere on this fraction.
```

---

## 5. New screens

### 5a. Donation confirm sheet (modal on farmer's listing)

```
┌─────────────────────────────────────┐
│ Donate ¼ of Steer #402              │
│                                     │
│ ESTIMATED YIELD                     │
│ ≈ 140 lbs take-home                 │
│                                     │
│ TAX LETTER                          │
│ You'll receive an IRS-compliant     │
│ contribution acknowledgment letter  │
│ after processing, listing the       │
│ pounds of protein donated.          │
│                                     │
│ ▸ Note on basis vs FMV deduction    │
│                                     │
│ FUNDING                             │
│ Processing fee paid from program    │
│ funds (grants + monetary donations) │
│ — not from you, not from buyers.    │
│                                     │
│ [Donation Agreement preview]        │
│                                     │
│ ☐ I agree to transfer ownership of  │
│   the donated fraction to the       │
│   Producer Partnership 501(c)(3).   │
│                                     │
│ [E-sign and donate]                 │
│ [Cancel]                            │
└─────────────────────────────────────┘
```

### 5b. Tax letter preview (after hanging weight)

PDF rendered server-side, includes:
- Nonprofit's name, address, EIN
- Farmer's name + address
- Date of donation
- Description of donation (animal #, breed, ranch, fraction)
- Estimated tax-deductible value (basis-only with disclaimer)
- "No goods or services were provided in exchange for this donation"
- Authorized signature (digital)

### 5c. Donation distribution log (admin)

Every donation has a row showing:
- Where the meat went (food bank, school, food shelf)
- Distribution date
- Recipient signature URL
- Notes

---

## 6. Tax math: what the farmer can deduct

Tax law on raised livestock donation is tricky. The spec doc shouldn't pretend to be authoritative — it should disclose what we know and recommend the farmer consult their CPA.

What we tell the farmer in the UI:

> **What can you deduct?**
> For raised livestock, the IRS generally allows you to deduct the **animal's tax basis** (your accumulated production costs), not the fair market value. For most cash-basis farmers, costs were already deducted as expenses, so the deduction may be small. **The bigger benefit is usually avoiding income recognition** on a sale you didn't make. Talk to your CPA about your specific situation.
>
> **Possible enhanced deduction:** Some donations of "wholesome food" qualify for up to 2× basis. We'll generate the documentation either way; your CPA decides which deduction to claim.
>
> **State credits:** Watch for Minnesota farmer food-donation tax credits (HF3386 and similar bills propose 85% credit, capped at 50% of property taxes paid). Not yet permanent.

---

## 7. Data model changes

### `Share` extensions
Add three fields:
```ts
interface Share {
  // ... existing fields
  donation?: {
    isDonation: boolean;             // true if this fraction was donated
    nonprofitOrgId: string;          // 501(c)(3) recipient
    deedOfGiftSignedAt: string;      // ISO timestamp
    deedOfGiftSignatureUrl: string;  // signed PDF
    taxLetterStatus: 'pending' | 'generated' | 'mailed';
    taxLetterUrl?: string;           // signed PDF download
    estimatedDonatedLbs?: number;    // pre-kill estimate
    actualDonatedLbs?: number;       // post-kill actual
    distributionEvents: DistributionEvent[];
  };
}

interface DistributionEvent {
  id: string;
  recipientOrgId: string;     // food bank / school
  recipientOrgName: string;
  poundsDelivered: number;
  deliveredAt: string;
  signatureUrl?: string;       // recipient signed receipt
  notes?: string;
}
```

### New `nonprofitOrgs` collection
```ts
interface NonprofitOrg {
  id: string;
  name: string;          // "Producer Partnership" or partner org
  ein: string;
  address: Address;
  is501c3: boolean;
  determinationLetterUrl: string;
  active: boolean;
}
```

### New `donationFundLedger` collection
Tracks the program funding (grants, corporate sponsors, individual monetary donations) that pays processor kill fees on donated animals.
```ts
interface DonationFundEntry {
  id: string;
  type: 'grant' | 'corporate_sponsor' | 'individual' | 'platform_match';
  amount: number;
  source: string;       // donor / grantor name
  receivedAt: string;
  allocatedToShareIds: string[];   // which donations this funded
}
```

---

## 8. Cloud Functions additions

Append to `app/functions/src/index.ts`:

```ts
export const donateFraction = onCall<{
  animalId: string;
  fraction: 'quarter_front' | 'quarter_hind' | 'quarter_mixed' | 'half' | 'whole';
  nonprofitOrgId: string;
  agreedToDeedOfGift: boolean;
}>({}, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign-in required.');
  if (!req.data.agreedToDeedOfGift) throw new HttpsError('failed-precondition', 'Must agree to deed of gift.');

  const animal = (await db.collection('animals').doc(req.data.animalId).get()).data();
  if (!animal) throw new HttpsError('not-found', 'Animal not found.');
  if (animal.farmerId !== req.auth.uid) throw new HttpsError('permission-denied', 'Not your animal.');

  const nonprofit = (await db.collection('nonprofitOrgs').doc(req.data.nonprofitOrgId).get()).data();
  if (!nonprofit?.is501c3) throw new HttpsError('failed-precondition', 'Recipient must be 501(c)(3).');

  // Generate signed deed-of-gift PDF (server-side template render)
  const deedUrl = await generateDeedOfGift({
    farmerId: req.auth.uid, animal, fraction: req.data.fraction, nonprofit
  });

  // Create the Share row marked as donation
  const shareRef = db.collection('shares').doc();
  await shareRef.set({
    animalId: req.data.animalId,
    buyerId: req.data.nonprofitOrgId,            // nonprofit is the "buyer"
    fraction: req.data.fraction,
    cutSheetId: null,                              // defaults to Processor's Choice
    donation: {
      isDonation: true,
      nonprofitOrgId: req.data.nonprofitOrgId,
      deedOfGiftSignedAt: new Date().toISOString(),
      deedOfGiftSignatureUrl: deedUrl,
      taxLetterStatus: 'pending',
      estimatedDonatedLbs: estimateLbsFromFraction(req.data.fraction, animal),
      distributionEvents: []
    },
    payment: { method: null, splits: { farmer: 0, processor: 0, platform: 0, shipping: 0, insurancePool: 0 } },
    status: 'reserved',
    createdAt: new Date().toISOString()
  });

  // Inherit processor + drop-off date from earlier share if exists
  const earlier = await db.collection('shares')
    .where('animalId', '==', req.data.animalId)
    .where('processorId', '!=', null).limit(1).get();
  if (!earlier.empty) {
    await shareRef.update({
      processorId: earlier.docs[0].data().processorId,
      bookingId:   earlier.docs[0].data().bookingId,
      dropoffDate: earlier.docs[0].data().dropoffDate
    });
  }

  // Allocate funding from program fund pool
  const allocation = await allocateDonationFunding(shareRef.id, animal.processorId);
  if (!allocation.ok) {
    // Insufficient funds? Mark donation as 'awaiting_funding'
    await shareRef.update({ 'donation.taxLetterStatus': 'awaiting_funding' });
  }

  await fireEmailEvent('donation_initiated', { shareId: shareRef.id, farmerId: req.auth.uid });
  return { ok: true as const, shareId: shareRef.id };
});

export const generateTaxLetter = onCall<{ shareId: string }>({}, async (req) => {
  // Called automatically when hanging weight is reported on a donated share
  // OR manually by admin
  const share = (await db.collection('shares').doc(req.data.shareId).get()).data();
  if (!share?.donation) throw new HttpsError('failed-precondition', 'Not a donation.');
  if (!share.donation.actualDonatedLbs) throw new HttpsError('failed-precondition', 'Hanging weight not reported.');

  const taxLetterUrl = await generateTaxLetterPdf(share);
  await db.collection('shares').doc(req.data.shareId).update({
    'donation.taxLetterStatus': 'generated',
    'donation.taxLetterUrl': taxLetterUrl
  });
  await fireEmailEvent('tax_letter_ready', { shareId: req.data.shareId });
  return { ok: true as const, taxLetterUrl };
});
```

---

## 9. Email templates (D-series)

Add to file 12 (or new 21-series append).

### D1 — Farmer initiated donation
**Trigger:** `donateFraction()` succeeds.
**Subject:** Confirmed — your ¼ of {{animal_breed}} #{{animal_number}} is donated
**Preheader:** Tax letter follows after processing. No fee on this fraction.

> Hi {{first_name}},
>
> Confirmed. ¼ of {{animal_breed}} #{{animal_number}} is now flagged as a donation to **{{nonprofit_name}}**, a 501(c)(3) hunger-relief organization.
>
> **What happens next**
> 1. The animal flows through the same processing pipeline. No extra work.
> 2. After {{processor_name}} reports hanging weight, we generate your IRS-compliant tax acknowledgment letter listing the pounds of protein donated.
> 3. The meat is distributed to food banks and schools by {{nonprofit_name}}'s logistics team.
> 4. You'll get a confirmation email when distribution completes.
>
> **What we need from you**
> Just sign the Deed of Gift attached (already done if you toggled in-app).
>
> [CTA: View donation status → /farmer/donations/{{share_id}}]

### D2 — Tax letter ready
**Trigger:** `generateTaxLetter()` completes.
**Subject:** Tax letter ready — {{actual_donated_lbs}} lbs donated
**Preheader:** Download the IRS acknowledgment for your records.

> Hi {{first_name}},
>
> Your tax acknowledgment letter for the donation of ¼ of {{animal_breed}} #{{animal_number}} is ready.
>
> **Donation summary**
> Pounds of protein donated: **{{actual_donated_lbs}} lbs**
> Recipient: {{nonprofit_name}} (EIN {{ein}})
> Date of donation: {{deed_signed_date}}
>
> [CTA: Download tax letter (PDF) → {{tax_letter_url}}]
>
> **A note on the deduction**
> For raised livestock, the IRS typically allows a deduction at your tax basis. The bigger benefit for many cash-basis farmers is avoiding income recognition. Your CPA can advise — feel free to share this letter with them.
>
> Watch for state credits: some Minnesota bills (HF3386 and similar) propose enhanced credits for farmer food donations. Not yet permanent.

### D3 — Distribution complete
**Trigger:** All `distributionEvents` for a donation share total ≥ actualDonatedLbs.
**Subject:** Your donation reached {{recipient_count}} {{recipient_type}}
**Preheader:** {{actual_donated_lbs}} lbs of protein delivered to local hunger-relief partners.

> Hi {{first_name}},
>
> Closing the loop on your donation: your {{actual_donated_lbs}} lbs of {{animal_breed}} ground and cuts has been distributed to:
>
> {{recipient_summary_bullets}}
>
> Thanks. This is real impact — most rural Minnesota food banks have very little local protein on hand.
>
> [CTA: See impact dashboard → /farmer/donations/{{share_id}}/impact]

### D4 — Admin: insufficient program funds (escalation)
**Trigger:** `allocateDonationFunding()` returns insufficient on a new donation.
**Subject:** [DONATION] Insufficient program funds — donation pending
**Preheader:** Need to find ${{shortfall}} for {{animal_breed}} kill fee.

Internal email to ops@.

> Internal — donation needs funding.
>
> Farmer {{farmer_name}} just initiated a donation of ¼ of {{animal_breed}} #{{animal_number}}. Program fund balance is below the kill fee + processing for this animal.
>
> Shortfall: ${{shortfall}}
> Possible sources: pending grant from {{recent_grant_name}}, corporate sponsor pipeline, platform match.
>
> [CTA: Allocate funding → /admin/donation-fund]
>
> Donation is currently in `awaiting_funding` state. Farmer notified that processing will commence once funded.

---

## 10. Funding the kill fee

The donation flow is only sustainable if there's money to pay processors. Three sources, in priority order:

1. **Grants** — apply to organizations like Montana Food Bank Network, USDA TEFAP, state ag departments, foundations focused on hunger relief.
2. **Corporate sponsors** — local businesses sponsor a quarter ($X covers ~140 lbs of donated protein). Branded receipts.
3. **Individual monetary donations** — public-facing donate button on `/donate`. 501(c)(3) tax-deductible.

Platform match: if the program runs short on a specific donation, Protein Outfitters covers the kill fee from operating reserves and recoups from future grants. Limit: $5k/quarter to avoid bleeding the platform.

The funding ledger is a separate Firestore collection (see §7). Reporting transparency: a public page at `/donation-impact` shows pounds donated, schools served, dollar value of grants received — refreshed nightly.

---

## 11. Closes the following Trello cards

- ✅ "Donation toggle on Step 1 fraction selector" — this spec
- ✅ Decision Log #15 — locked answer was toggle on Step 1; this spec gives it shape
- 🟡 Open: nonprofit partnership choice — lock in Producer Partnership directly, or set up a sister-org Minnesota-based 501(c)(3)?

---

## 12. Open questions for Mychal

1. **Nonprofit recipient**: Producer Partnership (Montana) directly, or set up a Minnesota sister org to keep the meat in-state?
2. **Default cut sheet for donations**: ground-only is the highest-yield, lowest-effort path. Confirm we default to "100% ground" for donated fractions unless farmer says otherwise.
3. **Public donation match campaign**: should we run a "donate to fund a kill fee" landing page from day one, or wait for first farmer donations to materialize before fundraising?
4. **Tax-letter delivery**: PDF email + optional mailed paper copy? Some farmers will want paper.
5. **Insurance pool interaction**: if a donated fraction's animal is condemned, the insurance pool already covers the kill fee. Does the farmer still get a tax letter for "condemned protein donated to disposal"? Recommend: no — letter only generates on actually-distributed protein.
