// /api/map-subscribe — start a Stripe checkout session for a Map Insights tier.
//
//   POST { tier: 'pro' | 'hardware' }   → returns { url } for Stripe checkout
//   GET                                  → returns { tier, current_period_end } for the signed-in user
//
// Uses Stripe Subscriptions. Pricing comes from env vars:
//   STRIPE_PRICE_MAP_PRO_MONTHLY        (e.g. price_...)
//   STRIPE_PRICE_MAP_HARDWARE_MONTHLY   (e.g. price_...)
//
// On checkout completion, the stripe-webhook handler should update users.map_tier.
// (We add a `map_tier` column on first call if missing — idempotent ALTER.)

import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' }; // Stripe SDK needs Node runtime

// Schema columns are bootstrapped by the stripe-webhook handler the first time a
// subscription event fires, so we don't ALTER TABLE on every request — that
// adds 4 round trips per call and was causing 504 timeouts on cold starts.

const PRICE = {
  pro:      process.env.STRIPE_PRICE_MAP_PRO_MONTHLY      || '',
  hardware: process.env.STRIPE_PRICE_MAP_HARDWARE_MONTHLY || '',
};

const TIER_DISPLAY = {
  pro: { name: 'Map Insights Pro', amount: '$29/mo' },
  hardware: { name: 'Hardware Insights', amount: '$199/mo' },
};

async function handler(req) {
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  if (req.method === 'GET') {
    // Tolerate missing column on a fresh DB — return free if the column doesn't
    // exist yet (the webhook will create it on first subscription event).
    let tier = 'free', periodEnd = null;
    try {
      const rows = await sql`SELECT map_tier, map_tier_period_end FROM users WHERE id = ${user.id}`;
      tier = rows[0]?.map_tier || 'free';
      periodEnd = rows[0]?.map_tier_period_end || null;
    } catch (e) { /* column missing → treat as free */ }
    return json({ tier, period_end: periodEnd, pricing: TIER_DISPLAY });
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch {}
    const tier = (body.tier || '').toLowerCase();
    if (tier !== 'pro' && tier !== 'hardware') return err(400, 'tier must be "pro" or "hardware"');

    const priceId = PRICE[tier];
    if (!priceId) return err(503, `STRIPE_PRICE_MAP_${tier.toUpperCase()}_MONTHLY env var not set`);
    if (!process.env.STRIPE_SECRET_KEY) return err(503, 'STRIPE_SECRET_KEY env var not set');

    // Lazy-load Stripe SDK
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Re-use existing customer if we have one. If the column doesn't exist yet
    // (fresh DB) we just always create a new Stripe customer; the webhook
    // handler creates the column the first time a subscription event fires.
    let customerId = null, userEmail = user.email || null;
    try {
      const userRow = (await sql`SELECT map_stripe_customer_id, email FROM users WHERE id = ${user.id}`)[0];
      customerId = userRow?.map_stripe_customer_id || null;
      userEmail = userRow?.email || userEmail;
    } catch (e) { /* column missing — fall through to create a new customer */ }

    if (!customerId) {
      const c = await stripe.customers.create({
        email: userEmail || undefined,
        metadata: { user_id: user.id, map_tier_purchase: tier },
      });
      customerId = c.id;
      try {
        await sql`UPDATE users SET map_stripe_customer_id = ${customerId} WHERE id = ${user.id}`;
      } catch (e) { /* column missing — webhook will create it later */ }
    }

    const origin = (req.headers.get('origin') || 'https://www.proteinoutfitters.com').replace(/\/$/, '');
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/map?subscribed=${tier}`,
      cancel_url:  `${origin}/map?canceled=1`,
      metadata: { user_id: user.id, tier },
      subscription_data: { metadata: { user_id: user.id, tier } },
    });

    return json({ url: session.url, tier });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
