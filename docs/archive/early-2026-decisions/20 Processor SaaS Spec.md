# Processor SaaS Subscription — Spec

_Author: Claude (Cowork session) · Date: May 3, 2026 · Pairs with `20 processor-saas-prototype.html`_

The first dollar of revenue this platform earns shouldn't depend on a customer reservation. Decision Log #14 picked **processor SaaS subscription** as the primary early-stage revenue line. This doc specs how it works, what's in each tier, how it bills, and how processors sign up.

---

## 1. Why processor-side SaaS

A two-sided marketplace has a chicken-and-egg problem: customers don't show up until there are listings, listings don't show up until there are processors, and processors don't show up until there's customer demand. Charging customers in those early months is anti-trust-building. Charging processors gives them tools they value on day one — better calendar, fewer phone calls, automated comms — even before marketplace volume is meaningful. **They pay for the back-office, not the marketplace lift.** When marketplace volume arrives, that's a bonus, not the value prop.

Industry comp: similar processor-management SaaS tools (Cattlesoft, VistaTrac modules) are priced $50–$300/mo. We come in at the same price band, but with the marketplace integration as the differentiator.

---

## 2. Three tiers

| Tier | Price | Best for | Includes |
|---|---|---|---|
| **Free** | $0 | Single-operator processors, lockers, custom-exempt facilities testing the platform | Up to 4 bookings/mo · marketplace listing · QR check-in · 1 staff seat · email support |
| **Standard** | $99/mo billed monthly, $79/mo annually | Most USDA / state-inspected plants doing 4–40 bookings/mo | Unlimited bookings · processor calendar (queue + week + month) · cut-sheet config · auto comms · 5 staff seats · phone support · custom branding on emails |
| **Premium** | $249/mo billed monthly, $199/mo annually | Multi-shift plants and chains doing 40+ bookings/mo | Everything in Standard plus: multi-location · API access · advanced analytics + exports · 25 staff seats · same-day support SLA · dedicated CSM · early access to new features |

All tiers get the marketplace listing, QR check-in, and inspection compliance hooks. Tier gates are administrative + operational, not safety-critical.

### Discounts
- Annual prepay: 20% off (priced into the table above)
- Multi-location (Premium only): negotiated, starts at 15% off seat 2+
- Friesla hardware buyers: 12 months Standard included with any MPU purchase ≥ $50k (cross-promotes the C-flow)

### What's NOT charged on
- Per-booking transaction fees (we already take a small platform fee on the marketplace side; double-charging hurts trust)
- Customer-side overage fees (this is the processor's bill, not the customer's)

---

## 3. Billing mechanics

Stripe Subscriptions + Customer Portal pattern. Same tax/payment infrastructure as the marketplace.

### Sign-up flow

```
1. Processor lands on /pricing/processor (public page)
2. Picks tier → "Start free trial" or "Start annual plan"
3. → Stripe Checkout-hosted page (collects payment method, captures $0 trial or full amount)
4. → success webhook fires → mark processor.saasSubscriptionTier in Firestore
5. → email welcome sequence S1
6. Trial: 14 days. Auto-converts to monthly billing unless cancelled.
```

### Manage subscription

In-app: **Settings → Billing**. Two CTAs:

1. **Open Customer Portal** — redirects to Stripe-hosted Customer Portal where the processor can update payment method, change tier, view invoices, or cancel. Stripe handles all of this. We never see a card number.
2. **Compare tiers** — opens the in-app pricing modal (same content as `/pricing/processor`)

Webhooks we listen to:
- `customer.subscription.created` → set tier
- `customer.subscription.updated` → update tier (downgrade is effective at period end; upgrade is immediate prorated)
- `customer.subscription.deleted` → revert to Free tier, send sunset email
- `invoice.payment_failed` → mark `billingStatus: 'past_due'`, email processor, gate them at tier-Standard limits after 3 days

### Proration & downgrades

| Action | Stripe behavior | Our behavior |
|---|---|---|
| Upgrade Standard → Premium | Immediate, prorated | Premium features unlock immediately |
| Downgrade Premium → Standard | Effective end of period | Premium features stay until end of period |
| Cancel | Effective end of period | Free tier engages at end of period; data retained 90 days |

---

## 4. Tier enforcement in code

Server-side gate on every tier-restricted feature. Don't rely on client-side hiding.

```ts
// app/functions/src/saasGate.ts (new file)
export type TierLimit = {
  monthlyBookingsMax: number | 'unlimited';
  staffSeatsMax: number;
  apiAccess: boolean;
  multiLocation: boolean;
  customBrandedEmails: boolean;
  prioritySupport: boolean;
};

export const TIER_LIMITS: Record<'free'|'standard'|'premium', TierLimit> = {
  free:     { monthlyBookingsMax: 4,           staffSeatsMax: 1,  apiAccess: false, multiLocation: false, customBrandedEmails: false, prioritySupport: false },
  standard: { monthlyBookingsMax: 'unlimited', staffSeatsMax: 5,  apiAccess: false, multiLocation: false, customBrandedEmails: true,  prioritySupport: false },
  premium:  { monthlyBookingsMax: 'unlimited', staffSeatsMax: 25, apiAccess: true,  multiLocation: true,  customBrandedEmails: true,  prioritySupport: true  }
};

export async function gateBooking(processorId: string): Promise<{ ok: boolean; reason?: string }> {
  const proc = (await db.collection('processors').doc(processorId).get()).data();
  if (!proc) return { ok: false, reason: 'processor not found' };
  const limit = TIER_LIMITS[proc.saasSubscriptionTier || 'free'];
  if (limit.monthlyBookingsMax === 'unlimited') return { ok: true };
  // Count this month's bookings
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const count = (await db.collection('bookings')
    .where('processorId', '==', processorId)
    .where('createdAt', '>=', monthStart.toISOString()).count().get()).data().count;
  if (count >= limit.monthlyBookingsMax) {
    return { ok: false, reason: `Free tier limited to ${limit.monthlyBookingsMax} bookings/mo. Upgrade to Standard for unlimited.` };
  }
  return { ok: true };
}
```

`bookProcessor` in `functions/src/index.ts` calls `gateBooking()` first and returns a friendly upgrade prompt on `ok: false`.

---

## 5. New Cloud Functions

Append to `app/functions/src/index.ts`:

```ts
export const createProcessorSubscription = onCall<{
  processorId: string;
  tier: 'standard' | 'premium';
  cadence: 'monthly' | 'annual';
}>({ secrets: [STRIPE_SECRET] }, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign-in required.');
  const { processorId, tier, cadence } = req.data;

  // Authorize: must be a staff member of this processor
  const staff = await db.collection('processors').doc(processorId).collection('staff').doc(req.auth.uid).get();
  if (!staff.exists) throw new HttpsError('permission-denied', 'Not staff at this processor.');

  // Stripe price ID lookup (set in env)
  const priceId = STRIPE_PRICE_IDS[`${tier}_${cadence}`];

  // Find or create Stripe Customer for this processor
  const procSnap = await db.collection('processors').doc(processorId).get();
  let customerId = procSnap.data()?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe().customers.create({
      name: procSnap.data()?.name,
      metadata: { processorId, type: 'processor' }
    });
    customerId = customer.id;
    await procSnap.ref.update({ stripeCustomerId: customerId });
  }

  // Create Checkout session for subscription
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { processorId, tier, cadence }
    },
    success_url: 'https://proteinoutfitters.com/processor/billing?welcome=1',
    cancel_url: 'https://proteinoutfitters.com/pricing/processor'
  });

  return { ok: true as const, checkoutUrl: session.url };
});

export const openProcessorBillingPortal = onCall<{ processorId: string }>(
  { secrets: [STRIPE_SECRET] },
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const staff = await db.collection('processors').doc(req.data.processorId).collection('staff').doc(req.auth.uid).get();
    if (!staff.exists) throw new HttpsError('permission-denied', 'Not staff at this processor.');
    const proc = (await db.collection('processors').doc(req.data.processorId).get()).data();
    if (!proc?.stripeCustomerId) throw new HttpsError('failed-precondition', 'No Stripe customer; subscribe first.');

    const portal = await stripe().billingPortal.sessions.create({
      customer: proc.stripeCustomerId,
      return_url: 'https://proteinoutfitters.com/processor/billing'
    });
    return { ok: true as const, portalUrl: portal.url };
  }
);

// Webhook: called by Stripe on subscription events
export const stripeWebhook = onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET.value());
  } catch { res.status(400).send('Bad signature'); return; }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription;
    const processorId = (sub.metadata as any).processorId;
    const tier = (sub.metadata as any).tier as 'standard' | 'premium';
    const status = sub.status; // active, trialing, past_due, canceled, etc.
    if (processorId) {
      await db.collection('processors').doc(processorId).update({
        saasSubscriptionTier: status === 'canceled' ? 'free' : tier,
        billingStatus: status,
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString()
      });
    }
  }
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const processorId = (sub.metadata as any).processorId;
    if (processorId) {
      await db.collection('processors').doc(processorId).update({
        saasSubscriptionTier: 'free',
        billingStatus: 'canceled'
      });
      await fireEmailEvent('processor_subscription_ended', { processorId });
    }
  }
  res.json({ received: true });
});
```

---

## 6. Email templates (lifecycle)

Add to file 06 (or as a 13-series append). Five templates:

| ID | Trigger | Purpose |
|---|---|---|
| S1 | Stripe `subscription.created` | Welcome — tier features overview, link to first-time setup |
| S2 | Day 12 of 14-day trial | Trial ending in 2 days — upgrade or auto-bill |
| S3 | `invoice.payment_failed` | Card declined — 3-day grace, instructions to update |
| S4 | Day 4 of past_due | Service-degraded notice — upgrade to restore |
| S5 | `subscription.deleted` | Sunset — you're back on Free tier, here's what changed, here's how to come back |

Template body matches the voice in files 05/06: warm, accountable, clear consequences. Examples sketched in the prototype `20 processor-saas-prototype.html` modal previews.

---

## 7. UI surfaces

### Public pricing page (`/pricing/processor`)
Showpiece marketing page. Three side-by-side tier cards on desktop, stacked on mobile. Cadence toggle (Monthly / Annual — default Annual to highlight savings). FAQ below. Built in `20 processor-saas-prototype.html` — see preview.

### In-app billing dashboard (`/processor/billing`)
- Current tier card with status (Active / Trial / Past Due / Canceled)
- Next invoice date + amount
- Recent invoices (link to Stripe-hosted PDF)
- "Open Customer Portal" CTA
- "Change plan" CTA → modal with tier comparison
- Hardware-bundle banner (if eligible — see §2)

### Tier-gated upsell prompts
When a Free-tier processor hits their booking cap, the `bookProcessor` function returns `ok: false` with `reason`. UI surfaces a soft modal: "You've used your 4 free bookings this month. Upgrade to Standard for unlimited at $99/mo." Two CTAs: "Upgrade →" (opens Checkout), "Wait until next month" (closes modal).

---

## 8. Security & abuse considerations

- **Don't let processors self-set tier** in Firestore. Tier is server-only, set via webhook only.
- **Cancel-and-rejoin loop abuse**: Stripe doesn't prevent a processor from canceling and re-trialing. Detect via `stripeCustomerId` history; if a customer has had > 1 trial in 12 months, deny the trial period for the next subscription.
- **Tier downgrade mid-cycle**: don't refund prorated — let them keep features through period end. Avoids gaming.
- **Invoice email injection**: validate processor's billing email separately from their account email. Stripe handles this in Customer Portal.

---

## 9. Closes the following Trello cards

- ✅ "Processor SaaS subscription tier (calendar + booking + customer-comms tools, $X/mo)" — primary early-stage revenue
- 🟡 Open: pricing per tier — `Standard $99/mo billed monthly, $79/mo annually` and `Premium $249/mo billed monthly, $199/mo annually`. Lock these or override.
- ✅ Decision Log #14 — locked answer was processor SaaS as primary; this spec gives it shape.

## 10. Open questions for Mychal

1. **Tier prices**: $99 Standard / $249 Premium proposed. Lock?
2. **Free-tier booking cap**: 4 bookings/mo. Generous enough? Tight enough?
3. **Hardware bundle**: 12 months Standard included with MPU buyers ≥ $50k. Confirm threshold.
4. **First-mover discount**: should the first 25 processors get Standard for $49/mo for life? Common growth tactic; you give up $50/mo per slot in exchange for testimonials and referrals.
5. **API access on Premium**: do you want to offer it on day one? Adds support burden. Could defer to month 6.
