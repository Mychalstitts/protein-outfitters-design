// /api/admin-create-webhook — one-shot Stripe webhook endpoint creator
//
//   POST /api/admin-create-webhook?secret=$MIGRATE_SECRET
//     → creates a Stripe webhook endpoint pointing at /api/stripe-webhook
//        subscribed to all 12 events the platform listens for, using your
//        STRIPE_SECRET_KEY already configured in Vercel.
//     → returns the signing secret. Copy it into Vercel as STRIPE_WEBHOOK_SECRET
//        and redeploy.
//
//   GET  /api/admin-create-webhook?secret=$MIGRATE_SECRET
//     → lists current webhook endpoints (idempotency check)
//
// MIGRATE_SECRET-gated so only the operator can run it.

import { err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const REQUIRED_EVENTS = [
  'account.updated',
  'charge.dispute.closed',
  'charge.dispute.created',
  'charge.dispute.funds_reinstated',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.updated',
  'charge.refunded',
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.deleted',
  'customer.subscription.updated',
  'invoice.paid',
];

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const secret = url.searchParams.get('secret');

  if (!process.env.MIGRATE_SECRET) return err(503, 'MIGRATE_SECRET env var not set on the server');
  if (!secret || secret !== process.env.MIGRATE_SECRET) {
    return err(401, 'Unauthorized — pass ?secret=$MIGRATE_SECRET');
  }
  if (!process.env.STRIPE_SECRET_KEY) return err(503, 'STRIPE_SECRET_KEY env var not set');

  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://www.proteinoutfitters.com';
  const targetUrl = `${baseUrl}/api/stripe-webhook`;

  const StripeModule = await import('stripe');
  const Stripe = StripeModule.default || StripeModule;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // ── GET: list existing endpoints (so the operator can verify before creating)
  if (req.method === 'GET') {
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoints = list.data.map(e => ({
      id: e.id,
      url: e.url,
      status: e.status,
      enabled_events: e.enabled_events,
      api_version: e.api_version,
      created: e.created,
    }));
    const ours = endpoints.find(e => e.url === targetUrl);
    return json({
      target_url: targetUrl,
      our_endpoint: ours || null,
      all_endpoints: endpoints,
      required_events: REQUIRED_EVENTS,
      note: ours
        ? 'An endpoint already exists at this URL. POST to update its events list, or use the existing signing secret from Stripe Dashboard.'
        : 'No endpoint at the target URL yet. POST to create one.',
    });
  }

  if (req.method !== 'POST') return err(405, 'Method not allowed');

  // ── POST: create the endpoint (or update events on the existing one)
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = list.data.find(e => e.url === targetUrl);

  if (existing) {
    // Update events on the existing endpoint to make sure all 12 are subscribed.
    // Note: the signing secret is only revealed at create time. If they want
    // a fresh secret, they'll need to delete and recreate.
    const updated = await stripe.webhookEndpoints.update(existing.id, {
      enabled_events: REQUIRED_EVENTS,
      description: 'Protein Outfitters production webhook',
    });
    return json({
      action: 'updated',
      id: updated.id,
      url: updated.url,
      enabled_events: updated.enabled_events,
      events_count: updated.enabled_events.length,
      signing_secret_note: 'Signing secrets are only shown at creation time. Find yours in Stripe Dashboard → Developers → Webhooks → ' + updated.id + ' → Reveal.',
      next_step: 'If STRIPE_WEBHOOK_SECRET is already set in Vercel, you\'re done. Otherwise grab the signing secret from the Stripe Dashboard for endpoint ' + updated.id + ' and add it to Vercel.',
    });
  }

  // Brand new endpoint — Stripe returns the signing secret in the response.
  const created = await stripe.webhookEndpoints.create({
    url: targetUrl,
    enabled_events: REQUIRED_EVENTS,
    description: 'Protein Outfitters production webhook',
  });

  return json({
    action: 'created',
    id: created.id,
    url: created.url,
    enabled_events: created.enabled_events,
    events_count: created.enabled_events.length,
    signing_secret: created.secret, // whsec_...
    next_step: 'Copy the `signing_secret` value above. In Vercel → Settings → Environment Variables, set `STRIPE_WEBHOOK_SECRET` to that value (mark sensitive). Then redeploy. After redeploy, /admin-health will show all 12 events subscribed.',
  });
}

export default nodejsHandler(handler);
