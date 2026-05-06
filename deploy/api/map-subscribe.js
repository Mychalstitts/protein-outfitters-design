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

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' }; // Stripe SDK needs Node runtime

async function ensureTierColumn() {
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_tier TEXT DEFAULT 'free'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_tier_period_end TIMESTAMPTZ`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_stripe_customer_id TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_stripe_subscription_id TEXT`;
  } catch (e) { /* best-effort */ }
}

const PRICE = {
  pro:      process.env.STRIPE_PRICE_MAP_PRO_MONTHLY      || '',
  hardware: process.env.STRIPE_PRICE_MAP_HARDWARE_MONTHLY || '',
};

const TIER_DISPLAY = {
  pro: { name: 'Map Insights Pro', amount: '$29/mo' },
  hardware: { name: 'Hardware Insights', amount: '$199/mo' },
};

export default async function handler(req) {
  await ensureTierColumn();

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  if (req.method === 'GET') {
    const rows = await sql`SELECT map_tier, map_tier_period_end FROM users WHERE id = ${user.id}`;
    return json({
      tier: rows[0]?.map_tier || 'free',
      period_end: rows[0]?.map_tier_period_end || null,
      pricing: TIER_DISPLAY,
    });
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

    // Re-use existing customer if we have one
    const userRow = (await sql`SELECT map_stripe_customer_id, email FROM users WHERE id = ${user.id}`)[0];
    let customerId = userRow?.map_stripe_customer_id || null;
    if (!customerId) {
      const c = await stripe.customers.create({
        email: userRow?.email || user.email || undefined,
        metadata: { user_id: user.id, map_tier_purchase: tier },
      });
      customerId = c.id;
      await sql`UPDATE users SET map_stripe_customer_id = ${customerId} WHERE id = ${user.id}`;
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
