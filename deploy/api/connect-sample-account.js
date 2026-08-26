// POST /api/connect-sample-account
//   Create a Stripe Accounts v2 connected account for the signed-in user
//   and store user_id → stripe_account_id.
//
// GET  /api/connect-sample-account
//   Return the live onboarding status from the Accounts API (not the DB).
//
// ONLY the properties in the Stripe V2 sample are sent on create.
// Never pass top-level `type` (no express / standard / custom).
//
// This does not replace /api/connect-onboarding (Express, used by
// /farmer and /processor to get paid for livestock reservations).

import { currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { getStripeClient } from './_lib/stripe-client.js';
import { stripeErrorToResponse } from './_lib/stripe-env.js';
import {
  getMappingForUser,
  saveMapping,
  readOnboardingStatus,
  isConnectV2Unavailable,
} from './_lib/connect-sample.js';

export const config = { runtime: 'nodejs' };

function statusPayload(mapping, live) {
  return {
    stripe_account_id: mapping.stripe_account_id,
    // Live fields — always from the Accounts API.
    readyToProcessPayments: live.readyToProcessPayments,
    onboardingComplete: live.onboardingComplete,
    requirementsStatus: live.requirementsStatus,
    display_name: live.display_name,
    // Stored subscription snapshot (updated by the v1 subscription webhook).
    subscription: {
      status: mapping.subscription_status || null,
      id: mapping.subscription_id || null,
      price_id: mapping.subscription_price_id || null,
      quantity: mapping.subscription_quantity || null,
      pause_collection: !!mapping.pause_collection,
      cancel_at_period_end: !!mapping.cancel_at_period_end,
    },
    // Storefront URL uses the account id for this demo. Use a farm slug
    // (or another public identifier) in production — do not put acct_ in
    // customer-facing URLs long term.
    storefront_url: `/connect-sample/storefront?accountId=${encodeURIComponent(mapping.stripe_account_id)}`,
  };
}

async function handler(req) {
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let stripeClient;
  try {
    stripeClient = getStripeClient();
  } catch (e) {
    return err(e.status || 500, e.message);
  }

  if (req.method === 'GET') {
    const mapping = await getMappingForUser(user.id);
    if (!mapping) {
      return json({
        stripe_account_id: null,
        readyToProcessPayments: false,
        onboardingComplete: false,
        requirementsStatus: null,
        subscription: null,
      });
    }
    try {
      const live = await readOnboardingStatus(stripeClient, mapping.stripe_account_id);
      return json(statusPayload(mapping, live));
    } catch (e) {
      if (isConnectV2Unavailable(e)) {
        return err(503, 'Stripe Accounts v2 is not available on this platform yet. Use /api/connect-onboarding (Express) for farm and processor payouts.');
      }
      const mapped = stripeErrorToResponse(e, 'Could not read Connect account status');
      return err(mapped.status, mapped.message);
    }
  }

  if (req.method === 'POST') {
    const existing = await getMappingForUser(user.id);
    if (existing?.stripe_account_id) {
      try {
        const live = await readOnboardingStatus(stripeClient, existing.stripe_account_id);
        return json({ created: false, ...statusPayload(existing, live) });
      } catch (e) {
        const mapped = stripeErrorToResponse(e, 'Could not read existing Connect account');
        return err(mapped.status, mapped.message);
      }
    }

    try {
      // Creating Connected Accounts — V2 only. Do not add `type`.
      const account = await stripeClient.v2.core.accounts.create({
        display_name: user.name || user.email,
        contact_email: user.email,
        identity: {
          country: 'us',
        },
        dashboard: 'full',
        defaults: {
          responsibilities: {
            fees_collector: 'stripe',
            losses_collector: 'stripe',
          },
        },
        configuration: {
          customer: {},
          merchant: {
            capabilities: {
              card_payments: {
                requested: true,
              },
            },
          },
        },
      });

      await saveMapping(user.id, account.id);
      const mapping = await getMappingForUser(user.id);
      const live = await readOnboardingStatus(stripeClient, account.id);
      return json({ created: true, ...statusPayload(mapping, live) }, { status: 201 });
    } catch (e) {
      if (isConnectV2Unavailable(e)) {
        return err(503, 'Stripe Accounts v2 is not available on this platform yet. Farm and processor payouts still use Express via /api/connect-onboarding.');
      }
      const mapped = stripeErrorToResponse(e, 'Could not create connected account');
      return err(mapped.status, mapped.message);
    }
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
