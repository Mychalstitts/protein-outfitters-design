// /api/donate-to-fund — open a Stripe Checkout Session for an unrestricted gift to the
// Producer Partnership program fund (kill-fee + processing for donated animals).
//
// POST { amount, donor_email?, donor_name?, designation? } → { url, fund_id }
//
// Anonymous-friendly: donor_email/name are optional. We insert a `pledged` row
// in donation_funds keyed to the Stripe PaymentIntent so the stripe-webhook
// can flip it to `received` once the charge succeeds.
//
// Edge runtime — Stripe SDK 17.4+ supports edge via Stripe.createFetchHttpClient(),
// which avoids the Node http-agent cold-start that was hanging this endpoint
// past Vercel's 10s default function timeout.
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };
export const maxDuration = 30;

// We keep amounts in real-world bounds the form already enforces client-side,
// but re-validate server-side to protect the ledger.
const MIN_USD = 5;
const MAX_USD = 50_000;

async function _handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  if (!process.env.STRIPE_SECRET_KEY) {
    return err(500, 'Donations not configured (missing STRIPE_SECRET_KEY)');
  }

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount < MIN_USD || amount > MAX_USD) {
    return err(400, `amount must be a number between ${MIN_USD} and ${MAX_USD}`);
  }

  const donor_email = body.donor_email ? String(body.donor_email).trim().toLowerCase() : null;
  const donor_name = body.donor_name ? String(body.donor_name).trim().slice(0, 200) : null;
  const designation = body.designation ? String(body.designation).trim().slice(0, 200) : null;

  if (donor_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(donor_email)) {
    return err(400, 'donor_email must be a valid email address (or omitted)');
  }

  const user = await currentUser(req).catch(() => null);
  const sourceType = donor_email || user?.email ? 'individual' : 'individual';

  // 1. Stage a pledge row so the webhook can resolve the PaymentIntent → row.
  const inserted = await sql`
    INSERT INTO donation_funds (
      source_type, source_name, contact_email, amount, designation, status
    ) VALUES (
      ${sourceType}, ${donor_name || null}, ${donor_email || user?.email || null},
      ${amount}, ${designation}, 'pledged'
    ) RETURNING id`;
  const fund_id = inserted[0].id;

  // 2. Create the Stripe Checkout Session.
  // Lazy-import + edge fetch HTTP client so cold-start is fast on edge runtime.
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const origin = req.headers.get('origin') || 'https://www.proteinoutfitters.com';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    submit_type: 'donate',
    customer_email: donor_email || user?.email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(amount * 100),
        product_data: {
          name: 'Producer Partnership — fund contribution',
          description: 'Covers kill fees and processing for donated animals routed to food banks, schools, tribal nations, and veteran families.',
        },
      },
    }],
    metadata: {
      kind: 'donation_fund',
      fund_id,
      donor_name: donor_name || '',
      donor_email: donor_email || user?.email || '',
      designation: designation || '',
    },
    payment_intent_data: {
      description: `Producer Partnership fund · ${donor_name || donor_email || 'anonymous'}`,
      statement_descriptor_suffix: 'PO FUND',
      metadata: {
        kind: 'donation_fund',
        fund_id,
      },
    },
    success_url: `${origin}/donation-flow?donation=${fund_id}&status=success`,
    cancel_url: `${origin}/donation-flow?donation=${fund_id}&status=cancel`,
    automatic_tax: { enabled: false },
  });

  // 3. Persist the PaymentIntent on the row so the webhook can find it.
  // (Fire-and-forget: the donor will still complete checkout if this UPDATE blips.)
  try {
    await sql`UPDATE donation_funds
              SET stripe_payment_intent = ${session.payment_intent || ''}
              WHERE id = ${fund_id}`;
  } catch (e) { console.error('donate-to-fund PI link failed:', e.message); }

  return json({ url: session.url, fund_id, session_id: session.id });
}

// Top-level guard — every donation-button click gets a structured 500 with a
// helpful message instead of a generic Vercel FUNCTION_INVOCATION_FAILED.
export default async function handler(req) {
  try {
    return await _handler(req);
  } catch (e) {
    console.error('donate-to-fund crashed:', e?.stack || e?.message || e);
    return err(500, 'Donation could not be opened. Please try again or email hello@proteinoutfitters.com.');
  }
}
