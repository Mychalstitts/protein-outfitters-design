// /api/stripe-webhook — receives Stripe events, marks reservations paid
//
// Configure in Stripe dashboard:
//   Endpoint: https://www.proteinoutfitters.com/api/stripe-webhook
//   Events:
//     - checkout.session.completed
//     - charge.refunded
//     - charge.dispute.created
//   Then copy the signing secret into Vercel env var STRIPE_WEBHOOK_SECRET.
//
// Vercel hands us the raw body via req.text() — Stripe needs the raw bytes
// to verify the signature, so we cannot run on edge runtime.
import Stripe from 'stripe';
import { sql } from './_lib/db.js';
import { Resend } from 'resend';

export const config = { runtime: 'nodejs', api: { bodyParser: false } };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!process.env.STRIPE_SECRET_KEY) return new Response('Stripe not configured', { status: 500 });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return new Response('Webhook secret missing', { status: 500 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`Webhook signature mismatch: ${e.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const reservationId = session.metadata?.reservation_id;
        if (!reservationId) break;
        const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        await sql`
          UPDATE reservations
          SET status = 'deposit-paid',
              stripe_payment_intent = ${piId || null},
              updated_at = NOW()
          WHERE id = ${reservationId}`;

        // Best-effort confirmation email
        if (process.env.RESEND_API_KEY) {
          try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const buyerEmail = session.customer_details?.email || session.customer_email;
            if (buyerEmail) {
              const farmName = session.metadata?.farm_name || 'your farm';
              const animal = session.metadata?.animal_number || 'your reservation';
              const total = (session.amount_total / 100).toLocaleString('en-US', { style: 'currency', currency: 'usd' });
              await resend.emails.send({
                from: process.env.RESEND_FROM || 'Protein Outfitters <hello@proteinoutfitters.com>',
                to: buyerEmail,
                subject: `Reservation confirmed — ${animal} from ${farmName}`,
                html: `
                  <div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#061b0e;">
                    <h1 style="font-size:22px;margin:0 0 14px;">Your reservation is locked in.</h1>
                    <p>Thanks for reserving <strong>${animal}</strong> from <strong>${farmName}</strong>.</p>
                    <p>You paid <strong>${total}</strong> today (deposit + processing + insurance). The remaining balance is settled at pickup based on actual hanging weight.</p>
                    <p>Next: we'll email your cut sheet within 24 hours so you can dial in exactly how you want every cut.</p>
                    <p style="margin-top:24px;"><a href="https://www.proteinoutfitters.com/account" style="background:#061b0e;color:#fbf9f5;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;">View your reservation →</a></p>
                  </div>`
              });
            }
          } catch (emailErr) { console.error('Email send failed:', emailErr); }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (!piId) break;
        await sql`
          UPDATE reservations
          SET status = 'refunded', updated_at = NOW()
          WHERE stripe_payment_intent = ${piId}`;
        break;
      }

      case 'charge.dispute.created': {
        // Future: insert into disputes table when we add it
        console.log('Dispute opened:', event.data.object.id);
        break;
      }
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    return new Response(`Handler error: ${e.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}
