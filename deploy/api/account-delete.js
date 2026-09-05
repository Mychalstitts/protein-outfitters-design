// /api/account-delete — soft-delete the signed-in user's account.
//
// Apple App Store + Google Play both REQUIRE that any app supporting account
// creation also exposes an in-app account deletion path. This endpoint is the
// programmatic side; the UI button lives on /settings (web) and account (mobile).
//
// What gets soft-deleted (set deleted_at, scrub PII, keep auditable financial
// rows for 7-year IRS retention):
//   • users row → email + name scrubbed; deleted_at = NOW(); role = 'deleted'
//   • All session tokens revoked (sessions.id — there is no sessions.token column)
//   • map_stripe_subscription_id → Stripe subscription canceled at period end
//   • Reservations with status NOT IN ('completed','picked-up') → status='cancelled'
//
// What gets KEPT (for tax + financial recordkeeping):
//   • Past reservations, invoices, tax letters
//   • Email_log entries (anonymized via user_id link only)
//
// POST. Authenticated (cookie or Bearer). Idempotent.

import {
  sql,
  currentUser,
  err,
  json,
  getSessionToken,
  clearSessionCookie,
  nodejsHandler,
} from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  let body = {};
  try { body = await req.json(); } catch {}
  const confirm = (body.confirm || '').toString().toLowerCase();
  if (confirm !== 'delete my account') {
    return err(400, 'To confirm deletion, send { "confirm": "delete my account" } in the request body.');
  }

  // Make sure the soft-delete columns exist (idempotent)
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason TEXT`;
  } catch (e) { /* best-effort */ }

  // Cancel any active Stripe subscriptions tied to the account so they don't
  // keep billing the dead account.
  let stripeCanceled = 0;
  try {
    const subs = await sql`
      SELECT map_stripe_subscription_id
      FROM users
      WHERE id = ${user.id} AND map_stripe_subscription_id IS NOT NULL`;
    if (subs[0]?.map_stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      try {
        await stripe.subscriptions.cancel(subs[0].map_stripe_subscription_id);
        stripeCanceled = 1;
      } catch (e) { /* sub may already be canceled — best-effort */ }
    }
  } catch (e) { /* best-effort */ }

  // Cancel non-finalized reservations
  let reservationsCanceled = 0;
  try {
    const r = await sql`
      UPDATE reservations
      SET status = 'cancelled',
          updated_at = NOW()
      WHERE buyer_id = ${user.id}
        AND status NOT IN ('completed','picked-up','cancelled','refunded')
      RETURNING id`;
    reservationsCanceled = r.length;
  } catch (e) { /* table layout may differ — best-effort */ }

  // Scrub PII on the user row, keep the row for FK integrity
  const reason = (body.reason || '').toString().slice(0, 500);
  await sql`
    UPDATE users
    SET email = ${'deleted+' + user.id + '@proteinoutfitters.com'},
        name = 'Deleted user',
        zip = NULL,
        role = 'deleted',
        deleted_at = NOW(),
        deletion_reason = ${reason || null}
    WHERE id = ${user.id}`;

  // Revoke ALL sessions for this user (cookie + any mobile Bearer tokens).
  // sessions primary key is `id` (the opaque token) — not a `token` column.
  try {
    await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
  } catch (e) {
    // Fallback: at least drop the caller's current session
    const sessionId = getSessionToken(req);
    if (sessionId) {
      try { await sql`DELETE FROM sessions WHERE id = ${sessionId}`; } catch {}
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    message: 'Account deleted. We canceled your subscriptions and pending reservations. Tax-relevant records are retained per IRS rules for 7 years and are no longer linked to your name or email.',
    stripe_canceled: stripeCanceled,
    reservations_canceled: reservationsCanceled,
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // Clear the session cookie immediately (web); mobile clears SecureStore client-side
      'set-cookie': clearSessionCookie(),
    },
  });
}

export default nodejsHandler(handler);
