// POST /api/connect-v2-webhook
//
// Thin events for Accounts v2. Configure a separate Event Destination:
//   Stripe Dashboard → Developers → Webhooks → + Add destination
//   Events from: Connected accounts
//   Payload style: Thin  (required for V2 accounts)
//   Events:
//     v2.core.account[requirements].updated
//     v2.core.account[configuration.merchant].capability_status_updated
//     v2.core.account[configuration.customer].capability_status_updated
//
// Local:
//   stripe listen --thin-events \
//     'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' \
//     --forward-thin-to https://<host>/api/connect-v2-webhook
//
// Env: STRIPE_V2_WEBHOOK_SECRET (or STRIPE_WEBHOOK_SECRET as a last resort)
//
// We always re-fetch the account from the API. We do not treat the thin
// payload as source of truth for charges_enabled / requirements.

import { sql, nodejsHandler } from './_lib/db.js';
import { getStripeClient, parseThinEvent } from './_lib/stripe-client.js';
import { ensureConnectSampleTable, getMappingByAccountId } from './_lib/connect-sample.js';

export const config = { runtime: 'nodejs', api: { bodyParser: false } };

function relatedAccountId(thinEvent, event) {
  return thinEvent?.related_object?.id
    || event?.related_object?.id
    || event?.data?.id
    || event?.data?.object?.id
    || null;
}

async function handleRequirementsUpdated(stripeClient, accountId) {
  const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'requirements'],
  });
  const due = account.requirements?.summary?.minimum_deadline?.status;
  const currentlyDue = account.requirements?.summary?.currently_due
    || account.requirements?.currently_due
    || [];

  // Collect updated requirements: persist a snapshot so the dashboard can
  // show "Stripe asked for more info" without treating the snapshot as
  // charges_enabled (that still comes from a live retrieve).
  const mapping = await getMappingByAccountId(accountId);
  if (mapping) {
    await sql`
      UPDATE connect_sample_accounts
      SET last_requirements_json = ${sql.json({
        status: due || null,
        currently_due: currentlyDue,
        ready: account?.configuration?.merchant?.capabilities?.card_payments?.status === 'active',
      })},
          last_event_type = ${'v2.core.account[requirements].updated'},
          last_event_at = NOW(),
          updated_at = NOW()
      WHERE stripe_account_id = ${accountId}`;
  }
  return { accountId, due, currentlyDue };
}

async function handleCapabilityUpdated(eventType, stripeClient, accountId) {
  const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'configuration.customer', 'requirements'],
  });
  const mapping = await getMappingByAccountId(accountId);
  if (mapping) {
    await sql`
      UPDATE connect_sample_accounts
      SET last_event_type = ${eventType},
          last_event_at = NOW(),
          updated_at = NOW()
      WHERE stripe_account_id = ${accountId}`;
  }
  return {
    accountId,
    card_payments: account?.configuration?.merchant?.capabilities?.card_payments?.status || null,
  };
}

async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let stripeClient;
  try {
    stripeClient = getStripeClient();
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }

  const secret = process.env.STRIPE_V2_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let thinEvent;
  try {
    thinEvent = parseThinEvent(stripeClient, rawBody, sig, secret);
  } catch (e) {
    return new Response(`Thin event signature mismatch: ${e.message}`, { status: 400 });
  }

  await ensureConnectSampleTable();

  let event;
  try {
    event = await stripeClient.v2.core.events.retrieve(thinEvent.id);
  } catch (e) {
    return new Response(`Could not retrieve v2 event ${thinEvent.id}: ${e.message}`, { status: 500 });
  }

  const type = event.type || thinEvent.type || '';
  const accountId = relatedAccountId(thinEvent, event);

  try {
    switch (type) {
      case 'v2.core.account[requirements].updated':
        if (accountId) await handleRequirementsUpdated(stripeClient, accountId);
        break;

      case 'v2.core.account[configuration.merchant].capability_status_updated':
      case 'v2.core.account[configuration.customer].capability_status_updated':
      case 'v2.core.account[configuration.recipient].capability_status_updated':
        if (accountId) await handleCapabilityUpdated(type, stripeClient, accountId);
        break;

      default:
        // Unknown / newer v2 types — still 200 so Stripe does not retry forever.
        break;
    }
  } catch (e) {
    return new Response(`Handler failed: ${e.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, type }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default nodejsHandler(handler);
