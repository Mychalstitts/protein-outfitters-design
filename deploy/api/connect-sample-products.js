// GET  /api/connect-sample-products?accountId=acct_…
//   List products on the connected account (Stripe-Account header).
//   Public so the storefront can render. The account must exist in our
//   user→account mapping — we do not list products for arbitrary acct ids.
//
// POST /api/connect-sample-products
//   { name, description, priceInCents, currency? }
//   Create a product + default price ON the signed-in user's connected
//   account via the Stripe-Account header (`stripeAccount` in node).

import { currentUser, err, json, nodejsHandler } from './_lib/db.js';
import { getStripeClient } from './_lib/stripe-client.js';
import { stripeErrorToResponse } from './_lib/stripe-env.js';
import { getMappingForUser, getMappingByAccountId } from './_lib/connect-sample.js';

export const config = { runtime: 'nodejs' };

function serializeProduct(p) {
  const price = p.default_price && typeof p.default_price === 'object'
    ? p.default_price
    : null;
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    active: p.active,
    default_price_id: price?.id || (typeof p.default_price === 'string' ? p.default_price : null),
    unit_amount: price?.unit_amount ?? null,
    currency: price?.currency || 'usd',
  };
}

async function handler(req) {
  let stripeClient;
  try {
    stripeClient = getStripeClient();
  } catch (e) {
    return err(e.status || 500, e.message);
  }

  const url = new URL(req.url, 'https://www.proteinoutfitters.com');

  if (req.method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    if (!accountId || !accountId.startsWith('acct_')) {
      return err(400, 'accountId (acct_…) is required');
    }
    const mapping = await getMappingByAccountId(accountId);
    if (!mapping) return err(404, 'No sample Connect account for that id');

    try {
      // stripeAccount sets the Stripe-Account header (Direct Charge / connected account).
      const products = await stripeClient.products.list(
        { limit: 20, active: true, expand: ['data.default_price'] },
        { stripeAccount: accountId }
      );
      return json({
        account_id: accountId,
        // Demo URL uses the Stripe account id. Use a farm slug later.
        storefront_url: `/connect-sample/storefront?accountId=${encodeURIComponent(accountId)}`,
        products: (products.data || []).map(serializeProduct),
      });
    } catch (e) {
      const mapped = stripeErrorToResponse(e, 'Could not list products');
      return err(mapped.status, mapped.message);
    }
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const name = String(body?.name || '').trim();
    const description = String(body?.description || '').trim();
    const priceInCents = Number(body?.priceInCents);
    const currency = String(body?.currency || 'usd').toLowerCase();

    if (!name) return err(400, 'name is required');
    if (!Number.isFinite(priceInCents) || priceInCents < 50) {
      return err(400, 'priceInCents must be an integer ≥ 50 (50¢)');
    }

    const mapping = await getMappingForUser(user.id);
    if (!mapping?.stripe_account_id) {
      return err(409, 'Onboard a connected account before creating products.');
    }
    const accountId = mapping.stripe_account_id;

    try {
      const product = await stripeClient.products.create(
        {
          name,
          description: description || undefined,
          default_price_data: {
            unit_amount: Math.round(priceInCents),
            currency,
          },
        },
        { stripeAccount: accountId }
      );
      // Re-retrieve with expand so the UI can show the price immediately.
      const full = await stripeClient.products.retrieve(
        product.id,
        { expand: ['default_price'] },
        { stripeAccount: accountId }
      );
      return json({ product: serializeProduct(full), account_id: accountId }, { status: 201 });
    } catch (e) {
      const mapped = stripeErrorToResponse(e, 'Could not create product on the connected account');
      return err(mapped.status, mapped.message);
    }
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
