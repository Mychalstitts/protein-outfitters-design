// POST /api/connect-sample-checkout
//   { accountId, productId, quantity? }
//
// Direct Charge on the connected account + application fee on the platform.
// Hosted Checkout — the customer finishes on checkout.stripe.com.
//
// This is the SAMPLE storefront charge. It does not touch /api/checkout
// and does not require CHECKOUT_ENABLED (livestock deposits stay gated).

import { err, json, nodejsHandler } from './_lib/db.js';
import { getStripeClient } from './_lib/stripe-client.js';
import { sampleApplicationFeeCents, stripeErrorToResponse } from './_lib/stripe-env.js';
import { getMappingByAccountId, originFromReq } from './_lib/connect-sample.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  let stripeClient;
  try {
    stripeClient = getStripeClient();
  } catch (e) {
    return err(e.status || 500, e.message);
  }

  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

  const accountId = String(body?.accountId || '').trim();
  const productId = String(body?.productId || '').trim();
  const quantity = Math.max(1, Math.min(20, Number(body?.quantity) || 1));

  if (!accountId.startsWith('acct_')) return err(400, 'accountId (acct_…) is required');
  if (!productId.startsWith('prod_')) return err(400, 'productId (prod_…) is required');

  const mapping = await getMappingByAccountId(accountId);
  if (!mapping) return err(404, 'No sample Connect account for that id');

  try {
    const product = await stripeClient.products.retrieve(
      productId,
      { expand: ['default_price'] },
      { stripeAccount: accountId }
    );
    const price = product.default_price;
    if (!price || typeof price === 'string' || !price.unit_amount) {
      return err(409, 'This product has no default price. Create it again from the sample dashboard.');
    }

    const origin = originFromReq(req);
    const applicationFee = sampleApplicationFeeCents();

    const session = await stripeClient.checkout.sessions.create(
      {
        line_items: [
          {
            price_data: {
              currency: price.currency || 'usd',
              unit_amount: price.unit_amount,
              product_data: {
                name: product.name,
                description: product.description || undefined,
              },
            },
            quantity,
          },
        ],
        payment_intent_data: {
          // Sample application fee — platform monetization on a Direct Charge.
          application_fee_amount: applicationFee,
        },
        mode: 'payment',
        success_url: `${origin}/connect-sample/success?session_id={CHECKOUT_SESSION_ID}&accountId=${encodeURIComponent(accountId)}`,
        cancel_url: `${origin}/connect-sample/storefront?accountId=${encodeURIComponent(accountId)}`,
        metadata: {
          kind: 'connect-sample',
          connect_sample_user_id: mapping.user_id,
        },
      },
      { stripeAccount: accountId }
    );

    return json({ url: session.url, session_id: session.id });
  } catch (e) {
    const mapped = stripeErrorToResponse(e, 'Could not start hosted Checkout');
    return err(mapped.status, mapped.message);
  }
}

export default nodejsHandler(handler);
