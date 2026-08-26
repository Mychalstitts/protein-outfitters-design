// Helpers for the Stripe Connect V2 sample.
//
// This mapping table is the "user object → account ID" store the sample
// prompt asks for. It is separate from farms.stripe_account_id /
// processors.stripe_account_id so we never overwrite a live Express
// account with a V2 Accounts id.

import { sql } from './db.js';

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS connect_sample_accounts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id TEXT NOT NULL UNIQUE,
    subscription_status TEXT,
    subscription_id TEXT,
    subscription_price_id TEXT,
    subscription_quantity INT,
    pause_collection BOOLEAN DEFAULT FALSE,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    default_payment_method TEXT,
    last_requirements_json JSONB,
    last_event_type TEXT,
    last_event_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`;

let _ensured = false;

export async function ensureConnectSampleTable() {
  if (_ensured) return;
  await sql.unsafe(ENSURE_SQL);
  _ensured = true;
}

export async function getMappingForUser(userId) {
  await ensureConnectSampleTable();
  const rows = await sql`
    SELECT * FROM connect_sample_accounts
    WHERE user_id = ${userId}
    LIMIT 1`;
  return rows[0] || null;
}

export async function getMappingByAccountId(accountId) {
  await ensureConnectSampleTable();
  const rows = await sql`
    SELECT * FROM connect_sample_accounts
    WHERE stripe_account_id = ${accountId}
    LIMIT 1`;
  return rows[0] || null;
}

export async function saveMapping(userId, accountId) {
  await ensureConnectSampleTable();
  await sql`
    INSERT INTO connect_sample_accounts (user_id, stripe_account_id)
    VALUES (${userId}, ${accountId})
    ON CONFLICT (user_id) DO UPDATE
      SET stripe_account_id = EXCLUDED.stripe_account_id,
          updated_at = NOW()`;
}

/**
 * Live onboarding status from the Accounts v2 API.
 * The sample prompt says: do not store this in the database — always
 * retrieve the account when the dashboard loads.
 */
export async function readOnboardingStatus(stripeClient, stripeAccountId) {
  const account = await stripeClient.v2.core.accounts.retrieve(stripeAccountId, {
    include: ['configuration.merchant', 'requirements'],
  });

  const readyToProcessPayments =
    account?.configuration?.merchant?.capabilities?.card_payments?.status === 'active';

  const requirementsStatus =
    account.requirements?.summary?.minimum_deadline?.status;

  const onboardingComplete =
    requirementsStatus !== 'currently_due' && requirementsStatus !== 'past_due';

  return {
    account,
    account_id: account.id,
    display_name: account.display_name || null,
    readyToProcessPayments,
    requirementsStatus: requirementsStatus || null,
    onboardingComplete,
  };
}

export function originFromReq(req) {
  const url = new URL(req.url, 'https://www.proteinoutfitters.com');
  return `${url.protocol}//${url.host}`;
}

export function isConnectV2Unavailable(e) {
  const msg = String(e?.message || e?.raw?.message || '');
  return /signed up for connect/i.test(msg)
    || /connect is not enabled/i.test(msg)
    || /api method cannot be found/i.test(msg)
    || /accounts v2/i.test(msg);
}
