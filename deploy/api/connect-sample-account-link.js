// POST /api/connect-sample-account-link
//   Create a V2 Account Link so the signed-in user can finish onboarding.
//   The dashboard button "Onboard to collect payments" calls this, then
//   redirects to accountLink.url.
//
// Status is never stored from this response — the dashboard re-fetches
// /api/connect-sample-account after return/refresh.

import { currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { getStripeClient } from './_lib/stripe-client.js';
import { stripeErrorToResponse } from './_lib/stripe-env.js';
import {
  getMappingForUser,
  originFromReq,
  isConnectV2Unavailable,
} from './_lib/connect-sample.js';

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
    return err(409, 'Create a connected account first (POST /api/connect-sample-account).');
  }

  const origin = originFromReq(req);
  const accountId = mapping.stripe_account_id;

  try {
    const accountLink = await stripeClient.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant', 'customer'],
          refresh_url: `${origin}/connect-sample?refresh=1`,
          return_url: `${origin}/connect-sample?accountId=${encodeURIComponent(accountId)}`,
        },
      },
    });

    const url = accountLink.url || accountLink.use_case?.account_onboarding?.url;
    if (!url) {
      return err(502, 'Stripe returned an account link without a URL.');
    }
    return json({ url, stripe_account_id: accountId });
  } catch (e) {
    if (isConnectV2Unavailable(e)) {
      return err(503, 'Stripe Accounts v2 account links are not available on this platform yet.');
    }
    const mapped = stripeErrorToResponse(e, 'Could not create account link');
    return err(mapped.status, mapped.message);
  }
}

export default nodejsHandler(handler);
