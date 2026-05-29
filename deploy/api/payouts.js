// /api/payouts — Stripe Connect payout from a producer/processor's available balance
//   to their linked bank account.
//
//   POST { amount_cents?, role? }
//     amount_cents — defaults to entire available balance for that account
//     role         — 'producer' | 'processor' (which connected account to debit)
//
//   GET  → list of past payouts for the signed-in user, joined by status
//
// Stripe is the source of truth on the actual money movement; we mirror it in
// the `payouts` table for in-app history. Webhook `payout.paid` /
// `payout.failed` flips status (wired in stripe-webhook.js — caller should
// register those events in the Stripe dashboard if not already).

// Stripe loaded lazily inside the handler — same pattern as donate-to-fund.js.
import { sql, currentUser, json, err } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (!process.env.STRIPE_SECRET_KEY) return err(500, 'Stripe not configured (STRIPE_SECRET_KEY missing)');
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  // ── GET — payout history ─────────────────────────────
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, role, stripe_payout_id, amount_cents, currency, status,
             arrival_estimate, failure_reason, created_at, updated_at
      FROM payouts
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 50`;
    return json({ payouts: rows });
  }

  // ── POST — initiate a payout ─────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const wantedRole = body.role || (user.role === 'producer' ? 'producer' : (user.role === 'processor' ? 'processor' : null));
    if (!wantedRole) return err(400, 'role required (producer or processor) and must match account type');

    // Resolve the user's connected Stripe account by role.
    let stripeAccountId = null;
    let farm_id = null;
    let processor_id = null;
    if (wantedRole === 'producer') {
      const rows = await sql`SELECT id, stripe_account_id FROM farms WHERE owner_id = ${user.id} AND stripe_account_id IS NOT NULL LIMIT 1`;
      if (!rows[0]) return err(400, 'No farm with a connected Stripe account on your profile. Visit /farmer to connect Stripe.');
      stripeAccountId = rows[0].stripe_account_id;
      farm_id = rows[0].id;
    } else if (wantedRole === 'processor') {
      const rows = await sql`SELECT id, stripe_account_id FROM processors WHERE owner_id = ${user.id} AND stripe_account_id IS NOT NULL LIMIT 1`;
      if (!rows[0]) return err(400, 'No processor record with a connected Stripe account. Visit /processor to connect Stripe.');
      stripeAccountId = rows[0].stripe_account_id;
      processor_id = rows[0].id;
    }

    // Fetch the available balance on the connected account.
    let balance;
    try {
      balance = await stripe.balance.retrieve({ stripeAccount: stripeAccountId });
    } catch (e) {
      return err(502, 'Could not load Stripe balance: ' + (e.message || 'unknown'));
    }
    const available = balance.available?.find(b => b.currency === 'usd');
    const availableCents = available ? available.amount : 0;
    if (availableCents <= 0) {
      return err(409, 'No available balance to transfer right now. Funds may still be pending — they typically clear in 2 business days.');
    }

    const amount_cents = Math.min(
      body.amount_cents ? Math.max(50, Math.floor(Number(body.amount_cents))) : availableCents,
      availableCents
    );

    // Create the Stripe Payout on the connected account.
    let payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: amount_cents,
          currency: 'usd',
          metadata: {
            kind: 'producer_processor_payout',
            user_id: user.id,
            role: wantedRole,
            farm_id: farm_id || '',
            processor_id: processor_id || ''
          }
        },
        { stripeAccount: stripeAccountId }
      );
    } catch (e) {
      return err(502, 'Stripe payout creation failed: ' + (e.message || 'unknown'));
    }

    // Mirror the payout in our DB so the user sees it in the history pane.
    const arrival = payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null;
    const rows = await sql`
      INSERT INTO payouts (
        user_id, role, farm_id, processor_id,
        stripe_account_id, stripe_payout_id,
        amount_cents, currency, status, arrival_estimate
      )
      VALUES (
        ${user.id}, ${wantedRole}, ${farm_id}, ${processor_id},
        ${stripeAccountId}, ${payout.id},
        ${amount_cents}, 'usd',
        ${payout.status === 'paid' ? 'paid' : 'in_transit'},
        ${arrival}
      )
      RETURNING *`;

    // F7 payout-disbursed email — fires for producer payouts. The webhook
    // path already emails on auto-Connect transfers; this mirrors it for
    // manual transfers so producers get a notification either way.
    if (wantedRole === 'producer' && farm_id) {
      try {
        const { sendLifecycleEmail } = await import('./_lib/email.js');
        await sendLifecycleEmail('F7.payout_disbursed', {
          to: user.email,
          farmer_name: user.name,
          payout_amount: amount_cents / 100,
          animal_label: 'manual payout',
          gross_amount: amount_cents / 100,
          fees_amount: 0,
          payout_id: payout.id,
          dedupKey: `F7::manual::${payout.id}`,
        });
      } catch (e) { console.error('F7 manual-payout email failed:', e.message); }
    }

    return json({ payout: rows[0], stripe: { id: payout.id, status: payout.status, arrival_date: payout.arrival_date } });
  }

  return err(405, 'Method not allowed');
}
