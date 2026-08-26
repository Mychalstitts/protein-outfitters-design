// Shared Stripe env checks — no SDK import, so unit tests can load this
// file without installing the `stripe` package.
//
// Required:
//   STRIPE_SECRET_KEY          — platform secret key (sk_live_… or sk_test_…)
//
// Optional (sample Connect only):
//   STRIPE_SAMPLE_PRICE_ID                 — platform Price for the demo subscription
//   STRIPE_SAMPLE_APPLICATION_FEE_CENTS    — Direct Charge application fee (default 123)
//   STRIPE_V2_WEBHOOK_SECRET               — thin-event destination for V2 Accounts
//   STRIPE_SAMPLE_SUBSCRIPTION_WEBHOOK_SECRET — v1 events for the demo subscription

export const MISSING_STRIPE_KEY_MESSAGE =
  'STRIPE_SECRET_KEY is not set. Add your Stripe secret key in Vercel env vars ' +
  '(Settings → Environment Variables). Use sk_test_… for preview and sk_live_… ' +
  'for production. Placeholder values like sk_*** are rejected.';

export const MISSING_SAMPLE_PRICE_MESSAGE =
  'STRIPE_SAMPLE_PRICE_ID is not set. Create a recurring Price on the platform ' +
  'Stripe account (Product catalog → Add product → Recurring), then set ' +
  'STRIPE_SAMPLE_PRICE_ID=price_… in Vercel. Do not use a listing/deposit price.';

function isPlaceholderKey(value) {
  if (!value) return true;
  const v = String(value).trim();
  return v === '' || v.includes('***') || v === 'sk_test' || v === 'sk_live';
}

/**
 * Return the platform secret key or throw a helpful error.
 * Call this before constructing a Stripe client.
 */
export function requireStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (isPlaceholderKey(key)) {
    const err = new Error(MISSING_STRIPE_KEY_MESSAGE);
    err.status = 500;
    err.code = 'STRIPE_SECRET_KEY_MISSING';
    throw err;
  }
  return key;
}

export function requireSamplePriceId() {
  const priceId = process.env.STRIPE_SAMPLE_PRICE_ID;
  if (isPlaceholderKey(priceId) || !String(priceId).startsWith('price_')) {
    const err = new Error(MISSING_SAMPLE_PRICE_MESSAGE);
    err.status = 500;
    err.code = 'STRIPE_SAMPLE_PRICE_ID_MISSING';
    throw err;
  }
  return priceId;
}

/** Sample application fee in cents. The Stripe prompt uses 123 as the demo value. */
export function sampleApplicationFeeCents() {
  const raw = process.env.STRIPE_SAMPLE_APPLICATION_FEE_CENTS;
  const n = raw == null || raw === '' ? 123 : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 123;
  return Math.round(n);
}

export function stripeErrorToResponse(e, fallback = 'Stripe request failed') {
  const status = e?.statusCode || e?.status || e?.raw?.statusCode || 500;
  const message = e?.message || fallback;
  return { status: status >= 400 && status < 600 ? status : 500, message };
}
