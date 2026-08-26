// POST /api/connect-sample-billing-portal
//   Open the Stripe Billing Portal so the connected account can manage
//   the platform subscription (upgrade / cancel / payment method).
//
// Uses customer_account (acct_…), not a cus_ id.

import { currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { getStripeClient } from './_lib/stripe-client.js';
import { stripeErrorToResponse } from './_lib/stripe-env.js';
import { getMappingForUser, originFromReq } from './_lib/connect-sample.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let stripeClient;
  try {
    stripeClient = getStripeClient();
  } catch (e) {
    return err(e.status || 500, e.message);
  }

  const mapping = await getMappingForUser(user.id);
  if (!mapping?.stripe_account_id) {
    return err(409, 'Onboard a connected account first.');
  }

  const origin = originFromReq(req);

  try {
    const session = await stripeClient.billingPortal.sessions.create({
      customer_account: mapping.stripe_account_id,
      return_url: `${origin}/connect-sample`,
    });
    return json({ url: session.url });
  } catch (e) {
    const mapped = stripeErrorToResponse(e, 'Could not open the billing portal');
    return err(mapped.status, mapped.message);
  }
}

export default nodejsHandler(handler);
