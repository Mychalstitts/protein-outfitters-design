import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSING_STRIPE_KEY_MESSAGE,
  MISSING_SAMPLE_PRICE_MESSAGE,
  requireStripeSecretKey,
  requireSamplePriceId,
  sampleApplicationFeeCents,
} from '../deploy/api/_lib/stripe-env.js';

describe('stripe env helpers', () => {
  const prev = {};

  beforeEach(() => {
    for (const k of [
      'STRIPE_SECRET_KEY',
      'STRIPE_SAMPLE_PRICE_ID',
      'STRIPE_SAMPLE_APPLICATION_FEE_CENTS',
    ]) {
      prev[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('rejects a missing secret key with a fill-in hint', () => {
    delete process.env.STRIPE_SECRET_KEY;
    assert.throws(
      () => requireStripeSecretKey(),
      (err) => err.code === 'STRIPE_SECRET_KEY_MISSING' && err.message === MISSING_STRIPE_KEY_MESSAGE
    );
  });

  it('rejects a placeholder secret key', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_***';
    assert.throws(() => requireStripeSecretKey(), /STRIPE_SECRET_KEY is not set/);
  });

  it('returns a real-looking secret key', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_placeholder';
    assert.equal(requireStripeSecretKey(), 'sk_test_not_a_placeholder');
  });

  it('rejects a missing sample price id', () => {
    delete process.env.STRIPE_SAMPLE_PRICE_ID;
    assert.throws(
      () => requireSamplePriceId(),
      (err) => err.code === 'STRIPE_SAMPLE_PRICE_ID_MISSING' && err.message.includes('STRIPE_SAMPLE_PRICE_ID')
    );
    assert.match(MISSING_SAMPLE_PRICE_MESSAGE, /Product catalog/);
  });

  it('defaults the sample application fee to 123 cents', () => {
    delete process.env.STRIPE_SAMPLE_APPLICATION_FEE_CENTS;
    assert.equal(sampleApplicationFeeCents(), 123);
  });

  it('reads a custom application fee', () => {
    process.env.STRIPE_SAMPLE_APPLICATION_FEE_CENTS = '250';
    assert.equal(sampleApplicationFeeCents(), 250);
  });
});
