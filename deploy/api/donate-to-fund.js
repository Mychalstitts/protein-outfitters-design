// /api/donate-to-fund — public Stripe Checkout for individual donations to the program fund
//
//   POST { amount, donor_name?, donor_email? }
//     - Creates a `donation_funds` row in 'pledged' state.
//     - Creates a Stripe Checkout Session for the chosen amount (USD).
//     - Stripe webhook (`checkout.session.completed`) flips the row to 'received'.
//     - Returns { url } so the client redirects to Stripe.
//
// No auth required — anyone can donate. We capture the donor's name + email
// for the tax acknowledgment letter mailing, but it's optional (anonymous gifts OK).

import Stripe from 'stripe';
import { sql, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOWED_AMOUNTS = [25, 50, 95, 200, 500, 770, 1000, 2500];
const MIN = 5;
const MAX = 50000;

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  if (!process.env.STRIPE_SECRET_KEY) return err(500, 'Stripe not configured');

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < MIN || amount > MAX) {
    return err(400, `amount must be between ${MIN} and ${MAX} USD`);
  }

  const donorName = (body.donor_name || '').trim() || null;
  const donorEmail = (body.donor_email || '').trim().toLowerCase() || null;

  // Persist as pledged — Stripe webhook flips to 'received' on payment success.
  const rows = await sql`
    INSERT INTO donation_funds (source_type, source_name, contact_email, amount, status, notes)
    VALUES (
      'individual',
      ${donorName},
      ${donorEmail},
      ${amount},
      'pledged',
      ${body.notes || null}
    )
    RETURNING id`;
  const fundId = rows[0].id;

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.get('origin') || 'https://www.proteinoutfitters.com';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: donorEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(amount * 100),
        product_data: {
          name: 'Donation Depot — program fund contribution',
          description: 'Pays processor kill + processing fees on donated animals so they can flow to schools, food banks, and government feeding programs.',
        },
      },
    }],
    metadata: {
      donation_fund_id: fundId,
      kind: 'donation_to_fund',
    },
    payment_intent_data: {
      description: `Donation to Protein Outfitters Donation Depot fund · $${amount}`,
      metadata: { donation_fund_id: fundId, kind: 'donation_to_fund' },
      statement_descriptor_suffix: 'PO DONATE',
    },
    success_url: `${origin}/donation-flow?donated=1&fund=${fundId}`,
    cancel_url: `${origin}/donation-flow?donated=cancel`,
  });

  // Persist the payment_intent on the fund row once Stripe returns it.
  if (session.payment_intent) {
    await sql`UPDATE donation_funds SET stripe_payment_intent = ${session.payment_intent} WHERE id = ${fundId}`;
  }

  return json({ url: session.url, fund_id: fundId, session_id: session.id });
}
