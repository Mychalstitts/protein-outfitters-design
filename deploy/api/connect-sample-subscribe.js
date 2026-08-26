// POST /api/connect-sample-subscribe
//   Start a platform subscription Checkout for the signed-in user's
//   connected account. With Accounts v2, the same acct_ id is the
//   customer — use customer_account, not a cus_ customer id.
//
// Requires STRIPE_SAMPLE_PRICE_ID (a recurring Price on the platform).

import { currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { getStripeClient } from './_lib/stripe-client.js';
import { requireSamplePriceId, stripeErrorToResponse } from './_lib/stripe-env.js';
import { getMappingForUser, originFromReq } from './_lib/connect-sample.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let stripeClient;
  let priceId;
  try {
    stripeClient = getStripeClient();
    priceId = requireSamplePriceId();
  } catch (e) {
    return err(e.status || 500, e.message);
  }

  const mapping = await getMappingForUser(user.id);
  if (!mapping?.stripe_account_id) {
    return err(409, 'Onboard a connected account before subscribing.');
  }

  const origin = originFromReq(req);

  try {
    const session = await stripeClient.checkout.sessions.create({
      customer_account: mapping.stripe_account_id,
      mode: 'subscription',
      line_items: [
        { price: priceId, quantity: 1 },
      ],
      success_url: `${origin}/connect-sample/success?session_id={CHECKOUT_SESSION_ID}&kind=subscription`,
      cancel_url: `${origin}/connect-sample`,
      metadata: {
        kind: 'connect-sample-subscription',
        connect_sample_user_id: user.id,
      },
    });
    return json({ url: session.url, session_id: session.id });
  } catch (e) {
    const mapped = stripeErrorToResponse(e, 'Could not start subscription Checkout');
    return err(mapped.status, mapped.message);
  }
}

export default nodejsHandler(handler);
