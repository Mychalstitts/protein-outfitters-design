// One Stripe Client for every sample Connect request.
//
//   const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY)
//
// The SDK picks the latest API version automatically (currently
// 2026-07-29.dahlia on stripe-node 22). Do not pass apiVersion.
//
// Production farm/processor payouts still use /api/connect-onboarding
// (Express / Accounts v1). This client is shared by the V2 sample
// routes under /api/connect-sample-*.

import Stripe from 'stripe';
import { requireStripeSecretKey } from './stripe-env.js';

let _client = null;

/**
 * Return a memoized StripeClient.
 * Throws a helpful error if STRIPE_SECRET_KEY is missing or a placeholder.
 */
export function getStripeClient() {
  const key = requireStripeSecretKey();
  if (_client) return _client;
  // `new Stripe(...)` is the StripeClient constructor in stripe-node v22+.
  const stripeClient = new Stripe(key);
  _client = stripeClient;
  return stripeClient;
}

/**
 * Parse a V2 thin event (event notification).
 *
 * The Stripe sample prompt calls this `parseThinEvent`. stripe-node v22
 * renamed it to `parseEventNotification`. We try the documented name
 * first, then the current SDK name.
 *
 * After parsing, fetch the full event:
 *   const event = await stripeClient.v2.core.events.retrieve(thinEvent.id)
 */
export function parseThinEvent(stripeClient, payload, signature, webhookSecret) {
  if (!webhookSecret || String(webhookSecret).includes('***')) {
    const err = new Error(
      'Thin-event webhook secret is missing. In the Stripe Dashboard → Developers → ' +
      'Webhooks → + Add destination, choose Connected accounts, payload style Thin, ' +
      'and copy the signing secret into STRIPE_V2_WEBHOOK_SECRET.'
    );
    err.status = 500;
    throw err;
  }
  if (typeof stripeClient.parseThinEvent === 'function') {
    return stripeClient.parseThinEvent(payload, signature, webhookSecret);
  }
  if (typeof stripeClient.parseEventNotification === 'function') {
    return stripeClient.parseEventNotification(payload, signature, webhookSecret);
  }
  throw new Error(
    'This stripe-node build has neither parseThinEvent nor parseEventNotification. ' +
    'Upgrade the stripe package (latest is 22.x).'
  );
}
