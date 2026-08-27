// /api/checkout — create a Stripe Checkout Session for a reservation deposit
//   POST { listing_id, share_size, buyer_email, buyer_name?, buyer_phone? }
//     1. Validate listing + share availability
//     2. Compute deposit + processing from cumulative pricing
//     3. Create a `pending` reservation in DB (decrements share inventory)
//     4. Create a Stripe Checkout Session referencing that reservation_id
//     5. Return { url } so the client can window.location = url
//
// Webhook `/api/stripe-webhook` flips the reservation to `deposit-paid` once
// the buyer completes payment.
import Stripe from 'stripe';
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

// Stripe SDK uses Node Buffer/crypto — must run on Node runtime, not edge.
export const config = { runtime: 'nodejs' };

// Price/product IDs come from env vars. Defaults are LIVE — set test-mode IDs
// in Vercel Preview/Development env to test with sk_test keys.
const PRICING = {
  DEPOSIT_PRODUCT_ID: process.env.STRIPE_DEPOSIT_PRODUCT_ID || 'prod_USSVhZDnkZakBC',
};

function shareFraction(key) {
  return key === 'whole' ? 1 : key === 'half' ? 0.5 : key === 'quarter' ? 0.25 : 0.125;
}

function computeDepositCents({ farmerPerLb, share_size, hangingWeight }) {
  const lbsHW = hangingWeight * shareFraction(share_size);
  const meatEstimate = (Number(farmerPerLb) || 0) * lbsHW;
  const deposit = Math.min(500, Math.max(50, Math.round(meatEstimate * 0.10)));
  return Math.round(deposit * 100);
}

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  if (process.env.CHECKOUT_ENABLED !== 'true') {
    return err(503, 'Checkout is paused pending terms sign-off.');
  }
  if (!process.env.STRIPE_SECRET_KEY) return err(500, 'Stripe not configured (missing STRIPE_SECRET_KEY)');

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const { listing_id, share_size, buyer_email, buyer_name, buyer_phone } = body;
  if (!listing_id || !share_size || !buyer_email) {
    return err(400, 'listing_id, share_size, buyer_email all required');
  }

  // Fetch listing + farm so we have rates and metadata + Stripe Connect account ids
  const lrows = await sql`
    SELECT l.*,
           f.name as farm_name, f.slug as farm_slug, f.city as farm_city, f.state as farm_state,
           f.stripe_account_id as farm_stripe_account_id,
           f.stripe_connect_status as farm_stripe_connect_status,
           f.id as farm_id_full
    FROM listings l JOIN farms f ON f.id = l.farm_id
    WHERE l.id = ${listing_id} LIMIT 1`;
  if (!lrows[0]) return err(404, 'Listing not found');
  const listing = lrows[0];
  if (listing.status !== 'active') return err(409, 'Listing is no longer available');

  // Do not charge a card unless the farm can actually be paid.
  const farmAcct = listing.farm_stripe_account_id;
  const farmStatus = String(listing.farm_stripe_connect_status || '').toLowerCase();
  const farmCanBePaid = !!(farmAcct && (
    farmStatus === 'active' ||
    farmStatus === 'charges_enabled' ||
    farmStatus === 'payouts_enabled'
  ));
  if (!farmCanBePaid) {
    return err(409, 'This farm cannot receive payouts yet. The producer must finish Stripe Connect onboarding (charges and payouts enabled) before a card can be charged.');
  }

  // Ranch books the locker after the share sells. Buyer does not pick a plant
  // at checkout, so we do not require a processor connected account here.

  const shares = listing.shares || {};
  const share = shares[share_size];
  if (!share || (share.available || 0) <= 0) return err(409, `No ${share_size} share available`);
  const farmerPerLb = Number(share.price || listing.price_per_lb || 0);
  const hangingWeight = Number(listing.estimated_hanging_weight || 700);

  const depositCents = computeDepositCents({ farmerPerLb, share_size, hangingWeight });
  const lbsHW = hangingWeight * shareFraction(share_size);
  const meatEstimateCents = Math.round(farmerPerLb * lbsHW * 100);

  // 1. Decrement share + create pending reservation
  const newShares = JSON.parse(JSON.stringify(shares));
  newShares[share_size].available -= 1;
  newShares[share_size].reserved = (newShares[share_size].reserved || 0) + 1;
  await sql`UPDATE listings SET shares = ${newShares}, updated_at = NOW() WHERE id = ${listing_id}`;

  const user = await currentUser(req);
  const buyerId = user?.id || null;
  const totalEstimate = depositCents / 100;

  // Stripe transfer_group anchors all subsequent Connect transfers
  // (farmer payout, processor payout, platform fee retention) to this reservation.
  // Format: "po_<reservation_id>" — set before INSERT so it lands in the row.
  const transferGroup = `po_${listing_id}_${Date.now().toString(36)}`;

  const rrows = await sql`
    INSERT INTO reservations (
      listing_id, buyer_id, buyer_email, buyer_name, buyer_phone,
      share_size, processor_id, status, total_estimate, deposit_amount,
      stripe_transfer_group
    ) VALUES (
      ${listing_id}, ${buyerId}, ${buyer_email}, ${buyer_name || null}, ${buyer_phone || null},
      ${share_size}, ${null}, 'pending', ${totalEstimate}, ${depositCents / 100},
      ${transferGroup}
    )
    RETURNING id`;
  const reservationId = rrows[0].id;

  // Social: first sale / fully sold milestones + auto-follow ranch
  try {
    const { emitMilestone, autoFollowFarm, sharesFullySold } = await import('./_lib/social.js');
    const label = `${listing.number ? listing.number + ' · ' : ''}${listing.breed || listing.species || 'animal'}`;
    const farmId = listing.farm_id_full || listing.farm_id;
    // Count prior paid/pending reservations to detect first share
    const prior = await sql`
      SELECT COUNT(*)::int AS n FROM reservations
      WHERE listing_id = ${listing_id} AND id <> ${reservationId}
        AND status NOT IN ('cancelled','refunded')`;
    if ((prior[0]?.n || 0) === 0) {
      await emitMilestone({ listing_id, milestone: 'first_share_sold', ctx: { label } });
    }
    if (sharesFullySold(newShares)) {
      await emitMilestone({ listing_id, milestone: 'fully_sold', ctx: { label } });
    }
    if (buyerId && farmId) await autoFollowFarm(buyerId, farmId);
  } catch (_) { /* social best-effort */ }

  // Ranch books the locker from /farmer after shares sell.

  // 2. Create Stripe Checkout Session
  // Share inventory was already decremented above. If Stripe fails, restore it
  // and cancel the pending reservation so buyers never lose stock to a dead session.
  async function releaseHold(reason) {
    try {
      const restore = JSON.parse(JSON.stringify(shares));
      if (restore[share_size]) {
        restore[share_size].available = (restore[share_size].available || 0) + 1;
        restore[share_size].reserved = Math.max(0, (restore[share_size].reserved || 0) - 1);
      }
      await sql`UPDATE listings SET shares = ${restore}, updated_at = NOW() WHERE id = ${listing_id}`;
      await sql`UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE id = ${reservationId}`;
      console.error('Checkout hold released:', reason, reservationId);
    } catch (e) {
      console.error('Failed to release checkout hold:', e.message);
    }
  }

  let session;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = req.headers.get('origin') || 'https://www.proteinoutfitters.com';
    const shareLabel = share_size === 'whole' ? 'Whole animal' : share_size === 'half' ? 'Half share' : share_size === 'quarter' ? 'Quarter share' : 'Eighth share';
    const animalLabel = `${listing.number ? listing.number + ' · ' : ''}${listing.breed || listing.species} · ${listing.farm_name}`;

    // ── Apply referral credit ────────────────────────────────────
    // If the buyer is signed in and has a credit balance from a successful
    // referral, knock it off the deposit. Cap at depositCents-100 so Stripe
    // still has at least $1 to charge (Stripe rejects $0 sessions). The
    // amount actually consumed is stamped into metadata; the webhook
    // decrements the user's balance only after payment succeeds, so a
    // failed/cancelled checkout doesn't burn the credit.
    let appliedCreditCents = 0;
    let finalDepositCents = depositCents;
    if (user?.id) {
      const balRow = await sql`SELECT referral_credit_cents FROM users WHERE id = ${user.id} LIMIT 1`;
      const available = Math.max(0, Number(balRow[0]?.referral_credit_cents || 0));
      if (available > 0) {
        const cap = Math.max(0, depositCents - 100);
        appliedCreditCents = Math.min(available, cap);
        finalDepositCents = depositCents - appliedCreditCents;
      }
    }

    if (finalDepositCents < 50) {
      await releaseHold('deposit too small');
      return err(400, 'Deposit amount too small to charge');
    }

    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: buyer_email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: finalDepositCents,
            product: PRICING.DEPOSIT_PRODUCT_ID,
          },
        },
      ],
      metadata: {
        reservation_id: reservationId,
        listing_id,
        share_size,
        farm_slug: listing.farm_slug,
        farm_name: listing.farm_name,
        animal_number: listing.number || '',
        meat_estimate_cents: String(meatEstimateCents),
        hanging_weight_lbs: String(hangingWeight),
        buyer_user_id: buyerId || '',
        referral_credit_cents: String(appliedCreditCents),
        farm_stripe_account_id: listing.farm_stripe_account_id || '',
      },
      payment_intent_data: {
        description: `${shareLabel} · ${animalLabel} (deposit)`,
        metadata: {
          reservation_id: reservationId,
          listing_id,
          share_size,
          farm_stripe_account_id: listing.farm_stripe_account_id || '',
        },
        statement_descriptor_suffix: 'PO RESERVE',
        // transfer_group lets us issue Stripe Transfers from the platform balance
        // to the farmer's and processor's connected accounts after payment settles.
        // Webhook-driven payout logic should: total amount → farmer share + processor share + platform retain.
        transfer_group: transferGroup,
      },
      success_url: `${origin}/cut-sheet?reservation=${reservationId}&paid=1`,
      cancel_url: `${origin}/listing?id=${listing_id}&cancelled=1`,
      automatic_tax: { enabled: false },
    });
  } catch (stripeErr) {
    await releaseHold(stripeErr.message || 'stripe session failed');
    return err(502, 'Payment session failed: ' + (stripeErr.message || 'unknown').slice(0, 160));
  }

  return json({ url: session.url, reservation_id: reservationId, session_id: session.id });
}

export default nodejsHandler(handler);
