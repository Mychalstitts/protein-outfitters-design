// /api/admin-metrics — owner dashboard data: real DB counts + Stripe balance + recent payments
//   GET → { counts, balance, recent_payments, recent_reservations }
// Stripe is loaded lazily so the function still works without STRIPE_SECRET_KEY
// or even without the stripe npm package installed.
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

// Race a promise against a timeout so a hung upstream doesn't 504 the whole page.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function safeQuery(label, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: `${label}: ${e.message}` }; }
}

export default async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  let user = null;
  try { user = await currentUser(req); } catch (e) { /* fall through */ }
  if (!user) return err(401, 'Sign in required');

  const errors = [];

  // ── Real DB counts (each query individually safe) ─────────────
  const counts = {};
  const setC = (k, def = 0) => { if (!(k in counts)) counts[k] = def; };
  setC('farms'); setC('listings_active'); setC('reservations_active');
  setC('users'); setC('processors');
  setC('pending_deposits_count'); setC('pending_deposits_sum');
  setC('paid_deposits_count'); setC('paid_deposits_sum');

  const queries = [
    ['farms',                   () => sql`SELECT COUNT(*)::int AS c FROM farms`],
    ['listings_active',         () => sql`SELECT COUNT(*)::int AS c FROM listings WHERE status = 'active'`],
    ['reservations_active',     () => sql`SELECT COUNT(*)::int AS c FROM reservations WHERE status NOT IN ('cancelled','refunded')`],
    ['users',                   () => sql`SELECT COUNT(*)::int AS c FROM users`],
    ['processors',              () => sql`SELECT COUNT(*)::int AS c FROM processors`],
  ];
  for (const [key, q] of queries) {
    const r = await safeQuery(key, q);
    if (r.ok && r.data?.[0]) counts[key] = r.data[0].c;
    else if (!r.ok) errors.push(r.error);
  }

  const pendDep = await safeQuery('pending_deposits',
    () => sql`SELECT COUNT(*)::int AS c, COALESCE(SUM(deposit_amount),0)::float AS s FROM reservations WHERE status = 'pending'`);
  if (pendDep.ok && pendDep.data?.[0]) {
    counts.pending_deposits_count = pendDep.data[0].c;
    counts.pending_deposits_sum   = pendDep.data[0].s;
  } else if (!pendDep.ok) errors.push(pendDep.error);

  const paidDep = await safeQuery('paid_deposits',
    () => sql`SELECT COUNT(*)::int AS c, COALESCE(SUM(deposit_amount),0)::float AS s FROM reservations WHERE status IN ('deposit-paid','paid','processing','ready','picked-up')`);
  if (paidDep.ok && paidDep.data?.[0]) {
    counts.paid_deposits_count = paidDep.data[0].c;
    counts.paid_deposits_sum   = paidDep.data[0].s;
  } else if (!paidDep.ok) errors.push(paidDep.error);

  // ── Recent reservations (last 10) ─────────────────────────────
  let recentReservations = [];
  const rr = await safeQuery('recent_reservations', () => sql`
    SELECT r.id, r.status, r.share_size, r.buyer_email, r.deposit_amount, r.total_estimate,
           r.created_at, l.number as animal_number, l.breed, l.species,
           f.name as farm_name
    FROM reservations r
    JOIN listings l ON l.id = r.listing_id
    JOIN farms f ON f.id = l.farm_id
    ORDER BY r.created_at DESC LIMIT 10`);
  if (rr.ok) recentReservations = rr.data;
  else errors.push(rr.error);

  // ── Stripe data (lazy import so missing package doesn't crash) ─
  let balance = null, recentPayments = [], stripeError = null;
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const StripeModule = await import('stripe');
      const Stripe = StripeModule.default || StripeModule;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const bal = await withTimeout(stripe.balance.retrieve(), 4000, 'stripe.balance');
      balance = {
        available: bal.available.map(b => ({ amount: b.amount / 100, currency: b.currency })),
        pending:   bal.pending.map(b => ({ amount: b.amount / 100, currency: b.currency }))
      };
      const pis = await withTimeout(stripe.paymentIntents.list({ limit: 10 }), 4000, 'stripe.paymentIntents');
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
  } else {
    stripeError = 'STRIPE_SECRET_KEY not configured in Vercel env vars yet.';
  }

  return json({
    counts,
    balance,
    recent_payments: recentPayments,
    recent_reservations: recentReservations,
    stripe_error: stripeError,
    errors
  });
}
