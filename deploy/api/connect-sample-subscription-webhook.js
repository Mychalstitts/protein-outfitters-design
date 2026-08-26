// POST /api/connect-sample-subscription-webhook
//
// v1 (snapshot) events for the sample platform subscription.
// These do NOT use thin events.
//
// Configure a destination on the PLATFORM account:
//   https://www.proteinoutfitters.com/api/connect-sample-subscription-webhook
//   Events listed in the switch below.
//
// Env: STRIPE_SAMPLE_SUBSCRIPTION_WEBHOOK_SECRET
//   (falls back to STRIPE_WEBHOOK_SECRET if unset — only safe if this
//    endpoint is the only one using that secret.)
//
// For V2 accounts, the customer id lives on subscription.customer_account
// (shape acct_…), not subscription.customer.

import { sql, nodejsHandler } from './_lib/db.js';
import { getStripeClient } from './_lib/stripe-client.js';
import { requireStripeSecretKey } from './_lib/stripe-env.js';
import { ensureConnectSampleTable, getMappingByAccountId } from './_lib/connect-sample.js';

export const config = { runtime: 'nodejs', api: { bodyParser: false } };

function accountIdFromSubscription(sub) {
  // V2: customer_account is acct_…
  return sub?.customer_account || null;
}

async function writeSubscription(accountId, fields) {
  await ensureConnectSampleTable();
  const mapping = await getMappingByAccountId(accountId);
  if (!mapping) {
    // TODO: if this subscription is for a farm/processor Express account
    // instead of the sample table, write users / processor_subscriptions here.
    return false;
  }
  await sql`
    UPDATE connect_sample_accounts
    SET subscription_status = ${fields.status ?? mapping.subscription_status},
        subscription_id = ${fields.id ?? mapping.subscription_id},
        subscription_price_id = ${fields.price_id ?? mapping.subscription_price_id},
        subscription_quantity = ${fields.quantity ?? mapping.subscription_quantity},
        pause_collection = ${fields.pause_collection ?? mapping.pause_collection},
        cancel_at_period_end = ${fields.cancel_at_period_end ?? mapping.cancel_at_period_end},
        default_payment_method = ${fields.default_payment_method ?? mapping.default_payment_method},
        updated_at = NOW()
    WHERE stripe_account_id = ${accountId}`;
  return true;
}

async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let stripeClient;
  try {
    requireStripeSecretKey();
    stripeClient = getStripeClient();
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }

  const secret = process.env.STRIPE_SAMPLE_SUBSCRIPTION_WEBHOOK_SECRET
    || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || String(secret).includes('***')) {
    return new Response(
      'STRIPE_SAMPLE_SUBSCRIPTION_WEBHOOK_SECRET is not set. Add a platform webhook destination and paste the signing secret.',
      { status: 500 }
    );
  }

  const sig = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let event;
  try {
    event = stripeClient.webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    return new Response(`Webhook signature mismatch: ${e.message}`, { status: 400 });
  }

  const obj = event.data?.object || {};

  try {
    switch (event.type) {
      case 'customer.subscription.updated': {
        const accountId = accountIdFromSubscription(obj);
        if (!accountId) break;
        const item = obj.items?.data?.[0];
        const paused = !!(obj.pause_collection && Object.keys(obj.pause_collection).length);
        // pause_collection.behavior must be 'void' when the customer paused
        // in the portal. We store the paused flag; access is granted only
        // when status is active/trialing and not paused.
        await writeSubscription(accountId, {
          status: obj.status,
          id: obj.id,
          price_id: item?.price?.id || item?.plan?.id || null,
          quantity: item?.quantity ?? 1,
          pause_collection: paused,
          cancel_at_period_end: !!obj.cancel_at_period_end,
          default_payment_method: typeof obj.default_payment_method === 'string'
            ? obj.default_payment_method
            : obj.default_payment_method?.id || null,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const accountId = accountIdFromSubscription(obj);
        if (!accountId) break;
        // Revoke access — status canceled, clear price.
        await writeSubscription(accountId, {
          status: 'canceled',
          id: obj.id,
          price_id: null,
          quantity: 0,
          pause_collection: false,
          cancel_at_period_end: false,
        });
        break;
      }

      case 'invoice.paid': {
        const accountId = obj.customer_account || null;
        if (!accountId) break;
        const subId = typeof obj.subscription === 'string'
          ? obj.subscription
          : obj.subscription?.id || obj.parent?.subscription_details?.subscription || null;
        // TODO: grant access for the paid period (already reflected by
        // customer.subscription.updated in most cases).
        if (subId) {
          await writeSubscription(accountId, { id: subId, status: 'active' });
        }
        break;
      }

      case 'payment_method.attached':
      case 'payment_method.detached':
        // Informational — no access change. Logged via last_event on sample rows
        // only when we can resolve the account.
        break;

      case 'customer.updated': {
        // invoice_settings.default_payment_method is billing info only.
        // Do not use the customer billing email as a login credential.
        const accountId = obj.id?.startsWith('acct_') ? obj.id : obj.customer_account;
        if (!accountId) break;
        const pm = obj.invoice_settings?.default_payment_method;
        await writeSubscription(accountId, {
          default_payment_method: typeof pm === 'string' ? pm : pm?.id || null,
        });
        break;
      }

      case 'customer.tax_id.created':
      case 'customer.tax_id.deleted':
      case 'customer.tax_id.updated':
        // Tax IDs are billing data. Stripe validates some types.
        // https://docs.stripe.com/billing/customer/tax-ids
        break;

      case 'billing_portal.configuration.created':
      case 'billing_portal.configuration.updated':
      case 'billing_portal.session.created':
        break;

      default:
        break;
    }
  } catch (e) {
    return new Response(`Handler failed: ${e.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, type: event.type }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default nodejsHandler(handler);
