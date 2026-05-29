// /api/connect-onboarding — Stripe Connect Express onboarding for farms and processors
//
//   POST { kind: "farm"|"processor", id: "<row id>" }
//     1. Verify the caller owns the row.
//     2. Create a Stripe Connected Account (Express) if one doesn't exist.
//     3. Persist stripe_account_id on the row.
//     4. Generate an Account Link and return its URL — the caller redirects there.
//
//   GET ?kind=farm|processor&id=<row id>
//     Return the current Connect status (pending, restricted, active, disabled).
//
// Webhook `account.updated` should be added to /api/stripe-webhook to keep
// `stripe_connect_status` fresh as Stripe verifies the account.
//
// Env required: STRIPE_SECRET_KEY
// Optional: STRIPE_CONNECT_RETURN_URL (defaults to https://www.proteinoutfitters.com/account)
import Stripe from 'stripe';
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOWED_KINDS = ['farm', 'processor'];

async function handler(req) {
  if (!process.env.STRIPE_SECRET_KEY) return err(500, 'Stripe not configured');

  // Node runtime: req.url is relative; URL() needs a base.
  const url = new URL(req.url, 'https://www.proteinoutfitters.com');
  const kind = (req.method === 'GET' ? url.searchParams.get('kind') : null) || (await peekJson(req))?.kind;
  if (!ALLOWED_KINDS.includes(kind)) return err(400, 'kind must be "farm" or "processor"');

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  // ───── GET: return status ─────
  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return err(400, 'id required');
    const table = kind === 'farm' ? 'farms' : 'processors';
    const rows = await rawSelect(table, id, user);
    if (!rows[0]) return err(404, `${kind} not found or not yours`);
    const row = rows[0];

    // If we have an account ID, refresh status from Stripe.
    if (row.stripe_account_id) {
      try {
        const acct = await stripe.accounts.retrieve(row.stripe_account_id);
        const status = acct.charges_enabled && acct.payouts_enabled ? 'active'
          : acct.requirements?.currently_due?.length ? 'restricted'
          : acct.requirements?.disabled_reason ? 'disabled'
          : 'pending';
        if (status !== row.stripe_connect_status) {
          if (kind === 'farm') {
            await sql`UPDATE farms SET stripe_connect_status = ${status} WHERE id = ${id}`;
          } else {
            await sql`UPDATE processors SET stripe_connect_status = ${status} WHERE id = ${id}`;
          }
        }
        return json({
          stripe_account_id: row.stripe_account_id,
          status,
          charges_enabled: acct.charges_enabled,
          payouts_enabled: acct.payouts_enabled,
          requirements_due: acct.requirements?.currently_due || [],
          disabled_reason: acct.requirements?.disabled_reason || null,
        });
      } catch (e) {
        return err(500, `Stripe lookup failed: ${e.message}`);
      }
    }

    return json({ status: 'not-started', stripe_account_id: null });
  }

  // ───── POST: start or resume onboarding ─────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const id = body.id;
    if (!id) return err(400, 'id required');
    const table = kind === 'farm' ? 'farms' : 'processors';
    const rows = await rawSelect(table, id, user);
    if (!rows[0]) return err(404, `${kind} not found or not yours`);
    const row = rows[0];

    // Create Connected Account if one doesn't exist yet.
    let accountId = row.stripe_account_id;
    if (!accountId) {
      const acct = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: user.email,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        business_type: 'individual', // overridden by user during onboarding if needed
        business_profile: {
          name: row.name,
          product_description: kind === 'farm'
            ? 'Pasture-raised livestock sold via Protein Outfitters marketplace.'
            : 'USDA / state-inspected meat processing services.',
          mcc: kind === 'farm' ? '0763' : '5499',  // 0763 = agricultural co-op, 5499 = misc food stores
        },
        metadata: { kind, row_id: id, owner_user_id: user.id },
      });
      accountId = acct.id;
      if (kind === 'farm') {
        await sql`UPDATE farms SET stripe_account_id = ${accountId}, stripe_connect_status = 'pending' WHERE id = ${id}`;
      } else {
        await sql`UPDATE processors SET stripe_account_id = ${accountId}, stripe_connect_status = 'pending' WHERE id = ${id}`;
      }
    }

    // Generate an Account Link — the URL the user redirects to to complete onboarding.
    const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL || 'https://www.proteinoutfitters.com/account';
    const refreshUrl = `${returnUrl}?stripe_connect=refresh&kind=${kind}&id=${id}`;
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: `${returnUrl}?stripe_connect=done&kind=${kind}&id=${id}`,
      type: 'account_onboarding',
    });

    return json({ url: link.url, stripe_account_id: accountId });
  }

  return err(405, 'Method not allowed');
}

// Helper: select a row by id, ensuring the caller owns it (or is admin).
async function rawSelect(table, id, user) {
  if (table === 'farms') {
    if (user.role === 'admin') return await sql`SELECT * FROM farms WHERE id = ${id} LIMIT 1`;
    return await sql`SELECT * FROM farms WHERE id = ${id} AND owner_id = ${user.id} LIMIT 1`;
  }
  // processors
  if (user.role === 'admin') return await sql`SELECT * FROM processors WHERE id = ${id} LIMIT 1`;
  return await sql`SELECT * FROM processors WHERE id = ${id} AND owner_id = ${user.id} LIMIT 1`;
}

// Helper: read JSON body without consuming the original Request stream.
async function peekJson(req) {
  if (req.method !== 'POST') return null;
  try { return await req.clone().json(); } catch { return null; }
}

export default nodejsHandler(handler);
