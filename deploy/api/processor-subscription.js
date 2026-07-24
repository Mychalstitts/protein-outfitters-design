// /api/processor-subscription — SaaS subscription management for processors
//
//   GET   → current subscription for the authed processor
//   POST  → create Stripe Checkout session for a tier+cadence
//          body: { tier: 'standard' | 'premium', cadence: 'monthly' | 'annual', success_url?, cancel_url? }
//   DELETE → cancel at period end (sets cancel_at_period_end=true; doesn't terminate immediately)
//
// Price resolution order:
//
//   1. Vercel env var, if set — lets you pin an exact price id:
//        STRIPE_PRICE_STANDARD_MONTHLY / _ANNUAL
//        STRIPE_PRICE_PREMIUM_MONTHLY  / _ANNUAL
//   2. Stripe lookup_key (the default). The live prices carry stable keys:
//        po_processor_standard_monthly  $79/mo
//        po_processor_standard_annual   $758/yr  ($63/mo, 20% off)
//        po_processor_premium_monthly   $199/mo
//        po_processor_premium_annual    $1,910/yr ($159/mo, 20% off)
//
// Lookup keys mean price changes are made in Stripe alone — repricing a tier
// is "create new price, move the lookup_key, archive the old one", with no
// deploy and no env var edit. These amounts must stay in sync with the tier
// cards in /processor-saas.html.
//
// The 'free' tier writes a row directly without touching Stripe.

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const PRICE_KEYS = {
  'standard.monthly': 'STRIPE_PRICE_STANDARD_MONTHLY',
  'standard.annual':  'STRIPE_PRICE_STANDARD_ANNUAL',
  'premium.monthly':  'STRIPE_PRICE_PREMIUM_MONTHLY',
  'premium.annual':   'STRIPE_PRICE_PREMIUM_ANNUAL',
};

const LOOKUP_KEYS = {
  'standard.monthly': 'po_processor_standard_monthly',
  'standard.annual':  'po_processor_standard_annual',
  'premium.monthly':  'po_processor_premium_monthly',
  'premium.annual':   'po_processor_premium_annual',
};

// Env var wins when present; otherwise resolve the price by its lookup_key
// so Stripe stays the single source of truth for the actual amount.
async function resolvePriceId(stripe, tier, cadence) {
  const key = `${tier}.${cadence}`;
  const envKey = PRICE_KEYS[key];
  if (envKey && process.env[envKey]) return process.env[envKey];

  const lookupKey = LOOKUP_KEYS[key];
  if (!lookupKey) return null;
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return found.data[0]?.id || null;
}

async function loadProcessorForUser(userId) {
  const rows = await sql`
    SELECT p.id, p.slug, p.name, p.contact_email
    FROM processors p
    WHERE p.owner_id = ${userId}
    LIMIT 1`;
  return rows[0] || null;
}

async function loadSubscription(processorId) {
  const rows = await sql`
    SELECT id, tier, cadence, status, current_period_end, cancel_at_period_end,
           stripe_subscription_id, stripe_price_id, stripe_customer_id, updated_at
    FROM processor_subscriptions
    WHERE processor_id = ${processorId}
    ORDER BY updated_at DESC
    LIMIT 1`;
  return rows[0] || null;
}

async function handler(req) {
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');
  if (!['processor', 'admin'].includes(user.role)) return err(403, 'Processor account required');

  const processor = await loadProcessorForUser(user.id);
  if (!processor && user.role !== 'admin') return err(404, 'No processor profile linked to this account');

  // ── GET: current subscription
  if (req.method === 'GET') {
    if (!processor) return json({ subscription: null, processor: null });
    const sub = await loadSubscription(processor.id);
    return json({
      subscription: sub,
      processor: { id: processor.id, slug: processor.slug, name: processor.name },
      pricing_configured: !!process.env.STRIPE_SECRET_KEY,
    });
  }

  // ── POST: pick a tier
  if (req.method === 'POST') {
    if (!processor) return err(400, 'No processor profile to bill');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const tier = String(body.tier || '').toLowerCase();
    const cadence = String(body.cadence || 'monthly').toLowerCase();

    // ── Stripe Customer Portal (manage card, invoices, cancel) ──
    if (body.portal) {
      if (!process.env.STRIPE_SECRET_KEY) return err(503, 'Stripe not configured');
      const existing = await loadSubscription(processor.id);
      const customerId = existing?.stripe_customer_id;
      if (!customerId) return err(404, 'No billing account yet — subscribe to a paid tier first');
      const StripeModule = await import('stripe');
      const Stripe = StripeModule.default || StripeModule;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const baseUrl = process.env.PUBLIC_BASE_URL || 'https://www.proteinoutfitters.com';
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: body.return_url || `${baseUrl}/processor-saas?page=billing`,
      });
      return json({ portal_url: session.url });
    }

    if (!['free', 'standard', 'premium'].includes(tier)) return err(400, 'Invalid tier');
    if (tier !== 'free' && !['monthly', 'annual'].includes(cadence)) return err(400, 'Invalid cadence');

    // ── Free tier: just record it, no Stripe ──
    if (tier === 'free') {
      const existing = await loadSubscription(processor.id);
      if (existing) {
        await sql`
          UPDATE processor_subscriptions
          SET tier = 'free', cadence = NULL, status = 'active',
              cancel_at_period_end = FALSE, updated_at = NOW()
          WHERE id = ${existing.id}`;
      } else {
        await sql`
          INSERT INTO processor_subscriptions (processor_id, tier, status)
          VALUES (${processor.id}, 'free', 'active')`;
      }
      return json({ tier: 'free', status: 'active' });
    }

    // ── Paid tier: build Stripe Checkout session ──
    if (!process.env.STRIPE_SECRET_KEY) {
      return err(503, 'Stripe not configured: STRIPE_SECRET_KEY missing');
    }

    const StripeModule = await import('stripe');
    const Stripe = StripeModule.default || StripeModule;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const priceId = await resolvePriceId(stripe, tier, cadence);
    if (!priceId) {
      return err(503, `Pricing not configured: no active Stripe price with lookup_key "${LOOKUP_KEYS[`${tier}.${cadence}`]}" (or set env var ${PRICE_KEYS[`${tier}.${cadence}`]})`);
    }

    // Reuse existing customer if we already have one
    const existing = await loadSubscription(processor.id);
    let customerId = existing?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: processor.contact_email || user.email,
        name: processor.name,
        metadata: { processor_id: processor.id, processor_slug: processor.slug, kind: 'processor_saas' },
      });
      customerId = customer.id;
    }

    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://www.proteinoutfitters.com';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { processor_id: processor.id, tier, cadence, kind: 'processor_saas' },
      },
      success_url: body.success_url || `${baseUrl}/processor?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  body.cancel_url  || `${baseUrl}/processor-saas?canceled=1`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    // Stage a 'incomplete' row so the UI can show "subscribing…" while
    // Stripe Checkout is in progress. Webhook flips it to 'active' later.
    if (existing) {
      await sql`
        UPDATE processor_subscriptions
        SET tier = ${tier}, cadence = ${cadence},
            stripe_customer_id = ${customerId}, stripe_price_id = ${priceId},
            status = 'incomplete', cancel_at_period_end = FALSE,
            updated_at = NOW()
        WHERE id = ${existing.id}`;
    } else {
      await sql`
        INSERT INTO processor_subscriptions
          (processor_id, tier, cadence, stripe_customer_id, stripe_price_id, status)
        VALUES
          (${processor.id}, ${tier}, ${cadence}, ${customerId}, ${priceId}, 'incomplete')`;
    }

    return json({ checkout_url: session.url, session_id: session.id });
  }

  // ── DELETE: cancel at period end
  if (req.method === 'DELETE') {
    if (!processor) return err(400, 'No processor profile');
    const sub = await loadSubscription(processor.id);
    if (!sub || !sub.stripe_subscription_id) return err(404, 'No active subscription');

    if (process.env.STRIPE_SECRET_KEY) {
      try {
        const StripeModule = await import('stripe');
        const Stripe = StripeModule.default || StripeModule;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
      } catch (e) {
        return err(502, `Stripe cancel failed: ${e.message}`);
      }
    }
    await sql`
      UPDATE processor_subscriptions
      SET cancel_at_period_end = TRUE, updated_at = NOW()
      WHERE id = ${sub.id}`;
    return json({ canceled: true, effective: sub.current_period_end });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
