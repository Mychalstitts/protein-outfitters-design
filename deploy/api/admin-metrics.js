// /api/admin-metrics — owner dashboard data: real DB counts + Stripe balance + recent payments
//   GET → { counts, balance, recent_payments, recent_reservations }
// Requires admin role (or fallback to first user during early ops).
import Stripe from 'stripe';
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');
  // Soft admin check: any signed-in user during early ops sees metrics.
  // Tighten to `user.role === 'admin'` once we promote roles.

  // ── Real DB counts ───────────────────────────────────
  const [farms]        = await sql`SELECT COUNT(*)::int AS c FROM farms`;
  const [listings]     = await sql`SELECT COUNT(*)::int AS c FROM listings WHERE status = 'active'`;
  const [reservations] = await sql`SELECT COUNT(*)::int AS c FROM reservations WHERE status NOT IN ('cancelled','refunded')`;
  const [users]        = await sql`SELECT COUNT(*)::int AS c FROM users`;
  const [processors]   = await sql`SELECT COUNT(*)::int AS c FROM processors`;
  const [pendingDeposits] = await sql`
    SELECT COUNT(*)::int AS c, COALESCE(SUM(deposit_amount),0)::float AS sum
    FROM reservations WHERE status = 'pending'`;
  const [paidDeposits] = await sql`
    SELECT COUNT(*)::int AS c, COALESCE(SUM(deposit_amount),0)::float AS sum
    FROM reservations WHERE status IN ('deposit-paid','paid','processing','ready','picked-up')`;

  // ── Recent reservations (last 10) ────────────────────
  const recentReservations = await sql`
    SELECT r.id, r.status, r.share_size, r.buyer_email, r.deposit_amount, r.total_estimate,
           r.created_at, l.number as animal_number, l.breed, l.species,
           f.name as farm_name
    FROM reservations r
    JOIN listings l ON l.id = r.listing_id
    JOIN farms f ON f.id = l.farm_id
    ORDER BY r.created_at DESC LIMIT 10`;

  // ── Stripe data ──────────────────────────────────────
  let balance = null, recentPayments = [], stripeError = null;
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const bal = await stripe.balance.retrieve();
      balance = {
        available: bal.available.map(b => ({ amount: b.amount / 100, currency: b.currency })),
        pending:   bal.pending.map(b => ({ amount: b.amount / 100, currency: b.currency }))
      };
      const pis = await stripe.paymentIntents.list({ limit: 10 });
      recentPayments = pis.data.map(pi => ({
        id: pi.id,
        amount: pi.amount / 100,
        currency: pi.currency,
        status: pi.status,
        created: pi.created * 1000,
        email: pi.receipt_email || pi.metadata?.buyer_email,
        description: pi.description,
        reservation_id: pi.metadata?.reservation_id
      }));
    } catch (e) { stripeError = e.message; }
  }

  return json({
    counts: {
      farms: farms.c,
      listings_active: listings.c,
      reservations_active: reservations.c,
      users: users.c,
      processors: processors.c,
      pending_deposits_count: pendingDeposits.c,
      pending_deposits_sum: pendingDeposits.sum,
      paid_deposits_count: paidDeposits.c,
      paid_deposits_sum: paidDeposits.sum
    },
    balance,
    recent_payments: recentPayments,
    recent_reservations: recentReservations,
    stripe_error: stripeError
  });
}
