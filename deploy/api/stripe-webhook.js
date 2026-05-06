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

        // ── Stripe Connect split routing (only fires when accounts exist) ──
        // Pulls farmer + processor connected accounts from reservation metadata,
        // calculates each party's share of the post-fee total, and issues
        // Stripe Transfers against the reservation's transfer_group.
        // No-ops cleanly if nobody's onboarded yet.
        try {
          const farmAcct = session.metadata?.farm_stripe_account_id;
          const procAcct = session.metadata?.processor_stripe_account_id;
          const transferGroup = `po_${session.metadata?.listing_id || ''}_${session.id}`;

          // Look up the reservation's actual transfer_group + amounts from DB
          const rrow = await sql`
            SELECT stripe_transfer_group, deposit_amount, total_estimate
            FROM reservations WHERE id = ${reservationId} LIMIT 1`;
          const tg = rrow[0]?.stripe_transfer_group;

          if (tg && (farmAcct || procAcct)) {
            // Split policy (placeholder until policy decision is locked):
            //   Farmer = deposit (already represents % of meat value)
            //   Processor = ~$225 from the processing line item (per current line item)
            //   Platform = retained (no transfer)
            const totalCents = session.amount_total || 0;
            const processorCents = 22500; // from the processing line item
            const farmerCents = Math.max(0, Math.round((rrow[0].deposit_amount || 0) * 100));
            const platformRetainCents = totalCents - processorCents - farmerCents;

            if (farmAcct && farmerCents > 0) {
              await stripe.transfers.create({
                amount: farmerCents,
                currency: 'usd',
                destination: farmAcct,
                transfer_group: tg,
                description: `Farmer share — reservation ${reservationId}`,
                metadata: { reservation_id: reservationId, role: 'farmer' },
              });
            }
            if (procAcct && processorCents > 0) {
              await stripe.transfers.create({
                amount: processorCents,
                currency: 'usd',
                destination: procAcct,
                transfer_group: tg,
                description: `Processor share — reservation ${reservationId}`,
                metadata: { reservation_id: reservationId, role: 'processor' },
              });
            }

            // Persist the application_fee_amount so admin can see what we retained.
            if (platformRetainCents > 0) {
              await sql`UPDATE reservations
                        SET application_fee_amount = ${platformRetainCents / 100}
                        WHERE id = ${reservationId}`;
            }
            console.log(`Connect transfers issued for ${reservationId}: farmer=${!!farmAcct} processor=${!!procAcct} platformRetain=${platformRetainCents}`);
          } else {
            console.log(`Skipping Connect transfers — no connected accounts on file (farm=${!!farmAcct}, proc=${!!procAcct}). Funds settle to platform balance.`);
          }
        } catch (transferErr) {
          console.error('Connect transfer error (non-fatal):', transferErr.message);
        }

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

      case 'account.updated': {
        // Stripe Connect account onboarding/verification state changed.
        // Update farms/processors status from the live Stripe data.
        const acct = event.data.object;
        const status = acct.charges_enabled && acct.payouts_enabled ? 'active'
          : acct.requirements?.currently_due?.length ? 'restricted'
          : acct.requirements?.disabled_reason ? 'disabled'
          : 'pending';
        await sql`UPDATE farms SET stripe_connect_status = ${status} WHERE stripe_account_id = ${acct.id}`;
        await sql`UPDATE processors SET stripe_connect_status = ${status} WHERE stripe_account_id = ${acct.id}`;
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

      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
      case 'charge.dispute.funds_withdrawn':
      case 'charge.dispute.funds_reinstated': {
        const dispute = event.data.object;
        const piId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
        const amount = dispute.amount ? dispute.amount / 100 : null;

        // Bootstrap the disputes table on first hit (idempotent).
        await sql`
          CREATE TABLE IF NOT EXISTS disputes (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            stripe_dispute_id TEXT UNIQUE NOT NULL,
            stripe_charge_id  TEXT,
            stripe_payment_intent TEXT,
            reservation_id  UUID REFERENCES reservations(id) ON DELETE SET NULL,
            reason          TEXT,
            status          TEXT,
            amount          NUMERIC,
            currency        TEXT,
            evidence_due    TIMESTAMPTZ,
            response_status TEXT,
            raw             JSONB,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes(status)`;
        await sql`CREATE INDEX IF NOT EXISTS disputes_pi_idx ON disputes(stripe_payment_intent)`;

        // Try to find the matching reservation by payment_intent.
        let reservationId = null;
        if (piId) {
          const rs = await sql`SELECT id FROM reservations WHERE stripe_payment_intent = ${piId} LIMIT 1`;
          reservationId = rs[0]?.id || null;
        }

        const evidenceDue = dispute.evidence_details?.due_by
          ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
          : null;

        // Upsert by stripe_dispute_id so updates flow through cleanly.
        await sql`
          INSERT INTO disputes (
            stripe_dispute_id, stripe_charge_id, stripe_payment_intent, reservation_id,
            reason, status, amount, currency, evidence_due, raw
          ) VALUES (
            ${dispute.id}, ${chargeId || null}, ${piId || null}, ${reservationId},
            ${dispute.reason || null}, ${dispute.status || null}, ${amount},
            ${dispute.currency || 'usd'}, ${evidenceDue}, ${JSON.stringify(dispute)}
          )
          ON CONFLICT (stripe_dispute_id) DO UPDATE SET
            status = EXCLUDED.status,
            evidence_due = EXCLUDED.evidence_due,
            raw = EXCLUDED.raw,
            updated_at = NOW()
        `;

        // Auto-flag the reservation so admins see it in /admin-overview.
        if (reservationId) {
          await sql`UPDATE reservations SET updated_at = NOW() WHERE id = ${reservationId}`;
        }

        console.log(`Dispute ${event.type}: ${dispute.id} reason=${dispute.reason} status=${dispute.status} amount=${amount}`);
        break;
      }
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    return new Response(`Handler error: ${e.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}
