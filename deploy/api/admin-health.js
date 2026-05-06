// /api/admin-health — operational readiness dashboard
//
//   GET  → { env, schema, stripe, resend, crons, score }
//
// The single place to answer "is the platform actually live?" — checks every
// required env var (no values revealed, just present/missing), pings every
// table the platform expects, tests Stripe + Resend connectivity, and reports
// which Stripe webhook events should be subscribed.
//
// Admin-only. Read-only — running migrations or rotating secrets happens
// elsewhere. This is just the dashboard.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

// Env vars the platform expects, grouped by what they enable.
const ENV_SPEC = [
  // Core infrastructure
  { key: 'DATABASE_URL',          group: 'Core',     required: true,  purpose: 'Neon Postgres connection string' },
  { key: 'PUBLIC_BASE_URL',       group: 'Core',     required: false, purpose: 'Override the production base URL (defaults to www.proteinoutfitters.com)' },
  { key: 'MIGRATE_SECRET',        group: 'Core',     required: true,  purpose: 'Gate for /api/migrate — without this, schema migrations cannot run' },

  // Stripe
  { key: 'STRIPE_SECRET_KEY',     group: 'Stripe',   required: true,  purpose: 'Authorize Stripe API calls (Checkout, Connect, balance, refunds)' },
  { key: 'STRIPE_WEBHOOK_SECRET', group: 'Stripe',   required: true,  purpose: 'Verify webhook signatures from Stripe — without this, payments don\'t flip reservations to paid' },
  { key: 'STRIPE_PRICE_STANDARD_MONTHLY', group: 'Stripe', required: false, purpose: 'Processor SaaS Standard tier monthly price id (price_...)' },
  { key: 'STRIPE_PRICE_STANDARD_ANNUAL',  group: 'Stripe', required: false, purpose: 'Processor SaaS Standard tier annual price id' },
  { key: 'STRIPE_PRICE_PREMIUM_MONTHLY',  group: 'Stripe', required: false, purpose: 'Processor SaaS Premium tier monthly price id' },
  { key: 'STRIPE_PRICE_PREMIUM_ANNUAL',   group: 'Stripe', required: false, purpose: 'Processor SaaS Premium tier annual price id' },

  // Email + lifecycle
  { key: 'RESEND_API_KEY',        group: 'Email',    required: true,  purpose: 'Send lifecycle emails. Without this, emails are logged-only (skipped)' },
  { key: 'RESEND_FROM',           group: 'Email',    required: false, purpose: 'From address (defaults to "Protein Outfitters <hello@proteinoutfitters.com>")' },
  { key: 'EMAIL_TICK_SECRET',     group: 'Email',    required: true,  purpose: 'Gate for /api/email-tick + cron sweepers (ad-hoc URL trigger)' },
  { key: 'CRON_SECRET',           group: 'Email',    required: true,  purpose: 'Bearer token Vercel sends to authenticate cron callers' },

  // Donation Depot
  { key: 'PARTNER_EIN',           group: 'Donation', required: true,  purpose: 'EIN printed on tax letters + Deed of Gift (defaults to placeholder if unset)' },
  { key: 'PARTNER_ADDRESS',       group: 'Donation', required: true,  purpose: 'Charity address on tax letters' },
  { key: 'PARTNER_SIGNER',        group: 'Donation', required: false, purpose: 'Signing authority printed on tax letters' },

  // Hardware leads
  { key: 'HARDWARE_LEADS_EMAIL',  group: 'Hardware', required: false, purpose: 'Inbox for new hardware quote requests (defaults to mychal@proteinoutfitters.com)' },
  { key: 'HARDWARE_CRM_WEBHOOK_URL', group: 'Hardware', required: false, purpose: 'Generic CRM webhook (HubSpot/Pipedrive/Salesforce/Zapier) — fires alongside the email' },
];

// Tables we expect after a complete migration. Used to detect schema drift.
const TABLES = [
  'users', 'auth_tokens', 'sessions',
  'farms', 'listings', 'reservations',
  'processors', 'processor_subscriptions',
  'donations', 'donation_funds', 'institutions',
  'reviews', 'discovered_partners',
  'bookings', 'farmer_deposits', 'checkin_codes',
  'disputes', 'complaints',
  'referral_codes', 'referral_redemptions',
  'hardware_leads', 'notifications', 'email_log',
];

// Stripe webhook events we listen for in stripe-webhook.js
const REQUIRED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  'account.updated',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
];

// Crons defined in vercel.json — duplicated here so the dashboard can show them.
const CRONS_EXPECTED = [
  { path: '/api/email-tick',                schedule: '0 14 * * *',    purpose: 'Daily lifecycle email sweep (C2 / C4 / F4 / P3 / F11)' },
  { path: '/api/annual-donor-acknowledgment', schedule: '0 15 15 1 *', purpose: 'Yearly D3 consolidated tax letter (Jan 15)' },
];

// Wrap a promise with a timeout so a slow upstream doesn't hang the whole function.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function checkStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { connected: false, reason: 'STRIPE_SECRET_KEY not set' };
  }
  try {
    const StripeModule = await import('stripe');
    const Stripe = StripeModule.default || StripeModule;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const [balanceRes, accountRes] = await Promise.allSettled([
      withTimeout(stripe.balance.retrieve(), 4000, 'stripe.balance'),
      withTimeout(stripe.accounts.retrieve(), 4000, 'stripe.accounts'),
    ]);
    if (balanceRes.status !== 'fulfilled' || accountRes.status !== 'fulfilled') {
      return { connected: false, reason: (balanceRes.reason?.message || accountRes.reason?.message || 'Stripe call failed').slice(0, 200) };
    }
    const balance = balanceRes.value;
    const account = accountRes.value;

    let webhookEvents = [];
    let webhookSummary = null;
    try {
      const endpoints = await withTimeout(stripe.webhookEndpoints.list({ limit: 100 }), 4000, 'stripe.webhookEndpoints');
      const ours = endpoints.data.find(e => /\/api\/stripe-webhook/.test(e.url));
      if (ours) {
        webhookEvents = ours.enabled_events || [];
        webhookSummary = { url: ours.url, status: ours.status, enabled_count: webhookEvents.length };
      }
    } catch (e) { /* webhook listing may require restricted key with webhook scopes — degrade gracefully */ }

    return {
      connected: true,
      account_id: account.id,
      country: account.country,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      mode: process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test',
      balance: {
        available: balance.available.map(b => ({ currency: b.currency, amount: b.amount / 100 })),
        pending:   balance.pending.map(b => ({ currency: b.currency, amount: b.amount / 100 })),
      },
      webhook: webhookSummary,
      webhook_events_subscribed: webhookEvents,
      webhook_events_required: REQUIRED_STRIPE_EVENTS,
      webhook_events_missing: webhookSummary
        ? REQUIRED_STRIPE_EVENTS.filter(e => !webhookEvents.includes(e))
        : [], // if we couldn't list endpoints, don't lie about what's missing
    };
  } catch (e) {
    return { connected: false, reason: e.message.slice(0, 200) };
  }
}

async function checkResend() {
  if (!process.env.RESEND_API_KEY) {
    return { connected: false, reason: 'RESEND_API_KEY not set' };
  }
  try {
    // Resend doesn't have a cheap "ping" endpoint — list domains is the lightest call.
    const r = await withTimeout(fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
    }), 4000, 'resend.domains');
    if (!r.ok) {
      return { connected: false, reason: `Resend API returned ${r.status}` };
    }
    const data = await r.json().catch(() => ({}));
    const domains = (data.data || data || []).map(d => ({
      name: d.name, status: d.status, region: d.region,
    }));
    // Recent send count from email_log
    let recentSends = null;
    try {
      const rows = await sql`
        SELECT COUNT(*)::int AS c
        FROM email_log
        WHERE status = 'sent' AND created_at > NOW() - INTERVAL '24 hours'`;
      recentSends = rows[0]?.c ?? 0;
    } catch { /* email_log may not exist yet */ }
    return { connected: true, domains, sends_last_24h: recentSends };
  } catch (e) {
    return { connected: false, reason: e.message.slice(0, 200) };
  }
}

export default async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  // ── Env vars ──
  const envReport = ENV_SPEC.map(spec => ({
    ...spec,
    set: !!process.env[spec.key],
  }));
  const requiredMissing = envReport.filter(e => e.required && !e.set);
  const optionalMissing = envReport.filter(e => !e.required && !e.set);

  // ── Schema (single query against info_schema, no array binding) ──
  let schemaReport = [];
  try {
    const present = await withTimeout(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'`,
      5000, 'schema.tables');
    const presentSet = new Set(present.map(r => r.table_name));
    schemaReport = TABLES.map(t => ({ table: t, exists: presentSet.has(t) }));
  } catch (e) {
    schemaReport = TABLES.map(t => ({ table: t, exists: false, error: (e.message || 'query failed').slice(0, 80) }));
  }
  const tablesMissing = schemaReport.filter(t => t.exists === false);

  // ── Integrations: each wrapped in a hard outer timeout so a hung upstream
  // can't take down the whole dashboard. If a check times out we just report
  // it as disconnected — the user can debug separately.
  const stripe = await withTimeout(
    checkStripe().catch(e => ({ connected: false, reason: (e.message || 'failed').slice(0, 200) })),
    7000, 'checkStripe'
  ).catch(e => ({ connected: false, reason: (e.message || 'timed out').slice(0, 200) }));
  const resend = await withTimeout(
    checkResend().catch(e => ({ connected: false, reason: (e.message || 'failed').slice(0, 200) })),
    7000, 'checkResend'
  ).catch(e => ({ connected: false, reason: (e.message || 'timed out').slice(0, 200) }));

  // ── Score ──
  // Each required-env, each table, stripe-connected, resend-connected is a check.
  const totalRequired = ENV_SPEC.filter(e => e.required).length + TABLES.length + 2;
  const passed =
    envReport.filter(e => e.required && e.set).length +
    schemaReport.filter(t => t.exists).length +
    (stripe.connected ? 1 : 0) +
    (resend.connected ? 1 : 0);
  const pct = Math.round((passed / totalRequired) * 100);

  return json({
    score: { passed, total: totalRequired, pct, ready: pct === 100 },
    summary: {
      required_env_missing: requiredMissing.map(e => e.key),
      optional_env_missing: optionalMissing.map(e => e.key),
      tables_missing: tablesMissing.map(t => t.table),
      stripe_connected: stripe.connected,
      stripe_mode: stripe.mode || null,
      stripe_webhook_events_missing: stripe.webhook_events_missing || [],
      resend_connected: resend.connected,
    },
    env: envReport,
    schema: schemaReport,
    stripe,
    resend,
    crons_expected: CRONS_EXPECTED,
    generated_at: new Date().toISOString(),
  });
}
