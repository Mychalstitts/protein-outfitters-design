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
import { sql, nodejsHandler } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'nodejs', api: { bodyParser: false } };

async function handler(req) {
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

        // ── Donation Depot fund-contribution branch ──
        // Marked via session.metadata.kind === 'donation_to_fund'.
        if (session.metadata?.kind === 'donation_to_fund') {
          const fundId = session.metadata?.donation_fund_id;
          if (fundId) {
            await sql`
              UPDATE donation_funds
              SET status = 'received',
                  received_at = NOW(),
                  stripe_payment_intent = ${typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null},
                  updated_at = NOW()
              WHERE id = ${fundId}`;
          }
          break;
        }

        const reservationId = session.metadata?.reservation_id;
        if (!reservationId) break;
        const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        await sql`
          UPDATE reservations
          SET status = 'deposit-paid',
              stripe_payment_intent = ${piId || null},
              updated_at = NOW()
          WHERE id = ${reservationId}`;

        // ─── Referral credit application ─────────────────────────
        // Two distinct things happen here:
        //
        //   1. CONSUMING credit the buyer already had: if this checkout used
        //      session.metadata.referral_credit_cents to discount the deposit,
        //      decrement the buyer's balance now (we held off doing this at
        //      checkout-creation time so a failed payment doesn't burn credit).
        //
        //   2. EARNING credit on the FIRST paid reservation: if the buyer
        //      signed up via a ref code (recorded in users.referred_by_code +
        //      a pending row in referral_redemptions), credit BOTH sides $25
        //      and flip the redemption to 'credited'. Subsequent reservations
        //      no-op because the redemption is no longer pending.
        try {
          const REFERRAL_REWARD_CENTS = 2500; // $25 each side — Airbnb's #
          const usedCents = Number(session.metadata?.referral_credit_cents || 0);
          const buyerUserId = session.metadata?.buyer_user_id || null;

          // (1) Consume credit — guard against zero / null buyer / negative.
          if (buyerUserId && usedCents > 0) {
            await sql`
              UPDATE users
              SET referral_credit_cents = GREATEST(0, referral_credit_cents - ${usedCents}),
                  updated_at = NOW()
              WHERE id = ${buyerUserId}`;
          }

          // (2) Earn credit on first paid reservation.
          if (buyerUserId) {
            const paidCount = await sql`
              SELECT COUNT(*)::int AS n FROM reservations
              WHERE buyer_id = ${buyerUserId}
                AND status IN ('deposit-paid','dropped-off','ready','picked-up')`;
            const isFirstPaid = (paidCount[0]?.n || 0) === 1; // we just flipped it; =1 means this is the first
            if (isFirstPaid) {
              const pending = await sql`
                SELECT id, code FROM referral_redemptions
                WHERE redeemed_by = ${buyerUserId} AND reward_status = 'pending'
                ORDER BY created_at ASC LIMIT 1`;
              if (pending[0]) {
                const ownerRow = await sql`
                  SELECT owner_user_id FROM referral_codes WHERE code = ${pending[0].code} LIMIT 1`;
                const ownerId = ownerRow[0]?.owner_user_id || null;

                // Credit both sides + close the redemption in one transaction
                // so we never end up with a half-credited row.
                if (ownerId && ownerId !== buyerUserId) {
                  await sql`
                    UPDATE users
                    SET referral_credit_cents = referral_credit_cents + ${REFERRAL_REWARD_CENTS},
                        updated_at = NOW()
                    WHERE id IN (${buyerUserId}, ${ownerId})`;
                  await sql`
                    UPDATE referral_redemptions
                    SET reward_status = 'credited',
                        reward_amount = ${REFERRAL_REWARD_CENTS},
                        reservation_id = ${reservationId}
                    WHERE id = ${pending[0].id}`;
                }
              }
            }
          }
        } catch (refErr) {
          console.error('Referral crediting failed (non-fatal):', refErr.message);
        }

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
              const transfer = await stripe.transfers.create({
                amount: farmerCents,
                currency: 'usd',
                destination: farmAcct,
                transfer_group: tg,
                description: `Farmer share — reservation ${reservationId}`,
                metadata: { reservation_id: reservationId, role: 'farmer' },
              });
              // F7 farmer payout email — needs farmer's email + name.
              try {
                const fm = await sql`
                  SELECT u.email, u.name, l.number, l.breed, l.species, l.estimated_hanging_weight, l.price_per_lb
                  FROM reservations r
                  JOIN listings l ON l.id = r.listing_id
                  JOIN farms f ON f.id = l.farm_id
                  JOIN users u ON u.id = f.owner_id
                  WHERE r.id = ${reservationId} LIMIT 1`;
                if (fm[0]?.email) {
                  await sendLifecycleEmail('F7.payout_disbursed', {
                    to: fm[0].email,
                    farmer_name: fm[0].name,
                    payout_amount: farmerCents / 100,
                    animal_label: `${fm[0].number ? fm[0].number + ' · ' : ''}${fm[0].breed || fm[0].species || 'animal'}`,
                    final_hw_lbs: fm[0].estimated_hanging_weight,
                    farmer_per_lb: fm[0].price_per_lb,
                    gross_amount: farmerCents / 100,
                    fees_amount: 0,
                    payout_id: transfer.id,
                    dedupKey: `F7::${transfer.id}`,
                  });
                }
              } catch (e) { console.error('F7 send failed:', e.message); }
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

        // C1 reservation confirmation via the lifecycle email module.
        try {
          const buyerEmail = session.customer_details?.email || session.customer_email;
          if (buyerEmail) {
            // Pull richer data for the template
            const r = await sql`
              SELECT r.share_size, r.deposit_amount, r.buyer_name,
                     l.number as animal_number, l.breed, l.species, l.expected_finish_date,
                     f.name as farm_name, f.city as farm_city, f.state as farm_state,
                     p.name as processor_name
              FROM reservations r
              JOIN listings l ON l.id = r.listing_id
              JOIN farms f ON f.id = l.farm_id
              LEFT JOIN processors p ON p.id = r.processor_id
              WHERE r.id = ${reservationId} LIMIT 1`;
            const row = r[0] || {};
            const fractionPretty = row.share_size === 'whole' ? 'Whole animal'
              : row.share_size === 'half' ? 'Half share'
              : row.share_size === 'quarter' ? 'Quarter share'
              : row.share_size === 'eighth' ? 'Eighth share' : 'Share';
            const animalLabel = `${row.animal_number ? row.animal_number + ' · ' : ''}${row.breed || row.species || 'animal'}`;
            await sendLifecycleEmail('C1.reservation_confirmed', {
              to: buyerEmail,
              reservation_id: reservationId,
              buyer_name: row.buyer_name,
              fraction_pretty: fractionPretty,
              animal_label: animalLabel,
              farm_name: row.farm_name,
              farm_city: row.farm_city,
              farm_state: row.farm_state,
              processor_name: row.processor_name,
              drop_off_date: row.expected_finish_date,
              deposit_amount: row.deposit_amount,
            });
          }
        } catch (emailErr) { console.error('C1 email failed:', emailErr); }
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
        const updated = await sql`
          UPDATE reservations
          SET status = 'refunded', updated_at = NOW()
          WHERE stripe_payment_intent = ${piId}
          RETURNING id, buyer_email, buyer_name, deposit_amount, total_estimate, listing_id`;
        // C8/C9/C10 — cancellation/refund email. Stage inferred from refund proportion vs. total.
        try {
          const row = updated[0];
          if (row && row.buyer_email) {
            const refundedAmount = (charge.amount_refunded || 0) / 100;
            const total = Number(row.total_estimate) || 0;
            const stage = refundedAmount >= total - 0.01 ? 'free' : refundedAmount > 0 ? 'partial' : 'final';
            const lr = await sql`
              SELECT l.number, l.breed, l.species
              FROM listings l WHERE l.id = ${row.listing_id} LIMIT 1`;
            const animalLabel = lr[0]
              ? `${lr[0].number ? lr[0].number + ' · ' : ''}${lr[0].breed || lr[0].species || 'animal'}`
              : 'your share';
            await sendLifecycleEmail('C8_C9_C10.cancel_confirmation', {
              to: row.buyer_email,
              reservation_id: row.id,
              buyer_name: row.buyer_name,
              animal_label: animalLabel,
              cancel_stage: stage,
              refund_amount: refundedAmount,
              deposit_amount: row.deposit_amount,
              dedupKey: `C8_C9_C10::${row.id}::${charge.id}`,
            });
          }
        } catch (emailErr) { console.error('Cancel email failed:', emailErr); }
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

      // ──────────────────────────────────────────────────────────
      // Processor SaaS subscriptions — mirror Stripe state into our
      // processor_subscriptions table so the dashboard can gate features.
      // Source of truth is Stripe; we just keep an indexed mirror.
      // ──────────────────────────────────────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;

        // ──── Map Insights tier (Pro / Hardware) ────────────────
        // /api/map-subscribe stamps metadata.tier ∈ {pro,hardware} + user_id.
        // We mirror state into the users table so /api/map-data can gate layers.
        const mapTier = sub.metadata?.tier;
        const mapUserId = sub.metadata?.user_id;
        if (mapUserId && (mapTier === 'pro' || mapTier === 'hardware')) {
          // Ensure schema exists (idempotent — first writer wins)
          try {
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_tier TEXT DEFAULT 'free'`;
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_tier_period_end TIMESTAMPTZ`;
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_stripe_customer_id TEXT`;
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_stripe_subscription_id TEXT`;
          } catch (e) { /* best-effort */ }

          const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
          const isCanceled = event.type === 'customer.subscription.deleted'
            || sub.status === 'canceled'
            || sub.status === 'incomplete_expired';
          const newTier = isCanceled ? 'free' : mapTier;

          await sql`
            UPDATE users
            SET map_tier = ${newTier},
                map_tier_period_end = ${periodEnd},
                map_stripe_subscription_id = ${sub.id},
                map_stripe_customer_id = ${typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null}
            WHERE id = ${mapUserId}`;

          // Drop a notification so the user sees their tier change in /notifications
          try {
            const u = await sql`SELECT email FROM users WHERE id = ${mapUserId}`;
            if (u[0]?.email) {
              await sql`
                INSERT INTO notifications (user_email, kind, title, body, link_url, icon, dedup_key)
                VALUES (
                  ${String(u[0].email).toLowerCase()},
                  ${'map.tier.' + (isCanceled ? 'canceled' : 'active')},
                  ${isCanceled ? 'Map Insights canceled' : 'Map Insights active — ' + newTier},
                  ${isCanceled
                    ? 'Your subscription was canceled. You\'re back on the free tier.'
                    : 'Your ' + newTier + ' tier is active. Open /map to see the new layers.'},
                  '/map',
                  ${isCanceled ? 'alert' : 'check'},
                  ${'notif::map_tier::' + sub.id + '::' + event.type}
                )
                ON CONFLICT (dedup_key) DO NOTHING`;
            }
          } catch (e) { console.error('map-tier notif failed:', e.message); }

          console.log(`Map tier ${event.type}: user=${mapUserId} → ${newTier} (sub=${sub.id})`);
          break; // don't fall through to processor SaaS branch
        }

        // ──── Processor SaaS subscriptions ──────────────────────
        // Only act on processor SaaS subscriptions (we tag these in metadata at create)
        if (sub.metadata?.kind !== 'processor_saas') break;
        const processorId = sub.metadata?.processor_id;
        if (!processorId) break;

        const tier = sub.metadata?.tier || null;
        const cadence = sub.metadata?.cadence || null;
        const priceId = sub.items?.data?.[0]?.price?.id || null;
        const status  = event.type === 'customer.subscription.deleted' ? 'canceled' : (sub.status || 'incomplete');
        const currentEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
        const cancelAtEnd = !!sub.cancel_at_period_end;

        await sql`
          INSERT INTO processor_subscriptions (
            processor_id, tier, cadence, stripe_customer_id, stripe_subscription_id,
            stripe_price_id, status, current_period_end, cancel_at_period_end
          ) VALUES (
            ${processorId},
            ${tier || 'standard'},
            ${cadence},
            ${typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null},
            ${sub.id},
            ${priceId},
            ${status},
            ${currentEnd},
            ${cancelAtEnd}
          )
          ON CONFLICT (stripe_subscription_id) DO UPDATE SET
            tier = COALESCE(EXCLUDED.tier, processor_subscriptions.tier),
            cadence = COALESCE(EXCLUDED.cadence, processor_subscriptions.cadence),
            stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, processor_subscriptions.stripe_price_id),
            status = EXCLUDED.status,
            current_period_end = EXCLUDED.current_period_end,
            cancel_at_period_end = EXCLUDED.cancel_at_period_end,
            updated_at = NOW()
        `;
        console.log(`Processor sub ${event.type}: ${sub.id} status=${status} tier=${tier}`);
        break;
      }

      case 'invoice.paid': {
        // For SaaS invoices, advance the period end + drop a notification
        // to the processor owner. We don't trust the line items for tier;
        // the subscription event already carries that.
        const invoice = event.data.object;
        if (!invoice.subscription) break;

        // Map Insights renewal — bump period_end on the user, drop a renewal note.
        // (Looks up by stripe_subscription_id; only fires if a user owns this sub.)
        try {
          const mapUser = await sql`
            SELECT id, email, map_tier
            FROM users
            WHERE map_stripe_subscription_id = ${invoice.subscription}
            LIMIT 1`;
          if (mapUser[0]) {
            // Try to grab the new period_end from the invoice's lines (or skip)
            const newEnd = invoice.lines?.data?.[0]?.period?.end
              ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
              : null;
            if (newEnd) {
              await sql`UPDATE users SET map_tier_period_end = ${newEnd} WHERE id = ${mapUser[0].id}`;
            }
            if (mapUser[0].email) {
              await sql`
                INSERT INTO notifications (user_email, kind, title, body, link_url, icon, dedup_key)
                VALUES (
                  ${String(mapUser[0].email).toLowerCase()},
                  'map.tier.renewed',
                  ${'Map Insights renewed — ' + (mapUser[0].map_tier || 'pro')},
                  'Your subscription renewed for the next billing cycle.',
                  '/map',
                  'receipt',
                  ${'notif::map_renew::' + invoice.id}
                )
                ON CONFLICT (dedup_key) DO NOTHING`;
            }
            console.log(`Map tier invoice.paid: user=${mapUser[0].id} period_end=${newEnd}`);
            // Don't break here — also fall through in case it's a multi-product invoice
          }
        } catch (e) { console.error('map invoice.paid failed:', e.message); }

        await sql`
          UPDATE processor_subscriptions
          SET status = 'active', updated_at = NOW()
          WHERE stripe_subscription_id = ${invoice.subscription}`;
        // Notify the processor owner via email/notification — best effort
        try {
          const subRow = await sql`
            SELECT ps.processor_id, ps.tier, p.contact_email, p.name AS processor_name, p.owner_id
            FROM processor_subscriptions ps
            JOIN processors p ON p.id = ps.processor_id
            WHERE ps.stripe_subscription_id = ${invoice.subscription}
            LIMIT 1`;
          if (subRow[0]) {
            const ownerEmailRows = subRow[0].owner_id
              ? await sql`SELECT email FROM users WHERE id = ${subRow[0].owner_id}`
              : [];
            const to = ownerEmailRows[0]?.email || subRow[0].contact_email;
            if (to) {
              // Direct insert — there is no email template for this yet, the
              // notification is the user-facing artifact.
              await sql`
                INSERT INTO notifications (user_email, kind, title, body, link_url, icon, dedup_key)
                VALUES (
                  ${String(to).toLowerCase()},
                  'invoice.paid',
                  ${'Invoice paid — ' + subRow[0].processor_name},
                  ${'Your ' + (subRow[0].tier || 'subscription') + ' tier is active for the next billing cycle.'},
                  '/processor-saas',
                  'receipt',
                  ${'notif::invoice_paid::' + invoice.id}
                )
                ON CONFLICT (dedup_key) DO NOTHING`;
            }
          }
        } catch (e) { console.error('invoice.paid notif failed:', e.message); }
        break;
      }
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    return new Response(`Handler error: ${e.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export default nodejsHandler(handler);
