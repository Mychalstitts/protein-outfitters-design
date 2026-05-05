// /api/checkout — create a Stripe Checkout Session for a reservation deposit
//   POST { listing_id, share_size, processor_id?, buyer_email, buyer_name?, buyer_phone? }
//     1. Validate listing + share availability
//     2. Compute deposit + processing + insurance from cumulative pricing
//     3. Create a `pending` reservation in DB (decrements share inventory)
//     4. Create a Stripe Checkout Session referencing that reservation_id
//     5. Return { url } so the client can window.location = url
//
// Webhook `/api/stripe-webhook` flips the reservation to `deposit-paid` once
// the buyer completes payment.
import Stripe from 'stripe';
import { sql, currentUser, err, json } from './_lib/db.js';

// Stripe SDK uses Node Buffer/crypto — must run on Node runtime, not edge.
export const config = { runtime: 'nodejs' };

const PRICING = {
  processingPerLbHW: 1.25,
  killFeeFlat: 100,
  insurancePerLbHW: 0.05,
  platformPerLbHW: 0.25,
  cutsYield: 0.72,
  PROCESSING_PRICE_ID: 'price_1TTXarAEMYhoRW98GApM48vP',  // $225 flat
  INSURANCE_PRICE_ID:  'price_1TTXb2AEMYhoRW98KrLcSbj3',  // $18 flat
  DEPOSIT_PRODUCT_ID:  'prod_USSVhZDnkZakBC',             // variable-price product
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

export default async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  if (!process.env.STRIPE_SECRET_KEY) return err(500, 'Stripe not configured (missing STRIPE_SECRET_KEY)');

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  const { listing_id, share_size, buyer_email, buyer_name, buyer_phone, processor_id } = body;
  if (!listing_id || !share_size || !buyer_email) {
    return err(400, 'listing_id, share_size, buyer_email all required');
  }

  // Fetch listing + farm so we have rates and metadata
  const lrows = await sql`
    SELECT l.*, f.name as farm_name, f.slug as farm_slug, f.city as farm_city, f.state as farm_state
    FROM listings l JOIN farms f ON f.id = l.farm_id
    WHERE l.id = ${listing_id} LIMIT 1`;
  if (!lrows[0]) return err(404, 'Listing not found');
  const listing = lrows[0];
  if (listing.status !== 'active') return err(409, 'Listing is no longer available');

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
  const totalEstimate = (depositCents + 22500 + 1800) / 100; // deposit + processing + insurance
  const rrows = await sql`
    INSERT INTO reservations (
      listing_id, buyer_id, buyer_email, buyer_name, buyer_phone,
      share_size, processor_id, status, total_estimate, deposit_amount
    ) VALUES (
      ${listing_id}, ${buyerId}, ${buyer_email}, ${buyer_name || null}, ${buyer_phone || null},
      ${share_size}, ${processor_id || null}, 'pending', ${totalEstimate}, ${depositCents / 100}
    )
    RETURNING id`;
  const reservationId = rrows[0].id;

  // 2. Create Stripe Checkout Session
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.get('origin') || 'https://www.proteinoutfitters.com';
  const shareLabel = share_size === 'whole' ? 'Whole animal' : share_size === 'half' ? 'Half share' : share_size === 'quarter' ? 'Quarter share' : 'Eighth share';
  const animalLabel = `${listing.number ? listing.number + ' · ' : ''}${listing.breed || listing.species} · ${listing.farm_name}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: buyer_email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: depositCents,
          product: PRICING.DEPOSIT_PRODUCT_ID,
        },
      },
      { quantity: 1, price: PRICING.PROCESSING_PRICE_ID },
      { quantity: 1, price: PRICING.INSURANCE_PRICE_ID },
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
    },
    payment_intent_data: {
      description: `${shareLabel} · ${animalLabel} (deposit + processing + insurance)`,
      metadata: {
        reservation_id: reservationId,
        listing_id,
        share_size,
      },
      statement_descriptor_suffix: 'PO RESERVE',
    },
    success_url: `${origin}/confirmed?session_id={CHECKOUT_SESSION_ID}&reservation=${reservationId}`,
    cancel_url: `${origin}/listing?id=${listing_id}&cancelled=1`,
    automatic_tax: { enabled: false },
  });

  return json({ url: session.url, reservation_id: reservationId, session_id: session.id });
}
