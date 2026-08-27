import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositSplit } from '../deploy/api/_lib/connect-split.js';
import { PLATFORM_FEE_RATE, farmerPayoutCents, platformFeeCents } from '../deploy/api/_lib/fees.js';

test('deposit keeps 10% on the platform and sends 90% to the farm', () => {
  const s = depositSplit({ amountTotalCents: 15000, depositCents: 15000 });
  assert.equal(s.farmerCents, 13500);
  assert.equal(s.processorCents, 0);
  assert.equal(s.platformRetainCents, 1500);
  assert.equal(s.feeRate, 0.1);
  assert.equal(PLATFORM_FEE_RATE, 0.1);
});

test('platform keeps the 10% fee plus anything charged above the deposit', () => {
  const s = depositSplit({ amountTotalCents: 17500, depositCents: 15000 });
  assert.equal(s.farmerCents, 13500);
  assert.equal(s.processorCents, 0);
  assert.equal(s.platformRetainCents, 4000);
});

test('never invents a $225 processing transfer', () => {
  const s = depositSplit({ amountTotalCents: 15000, depositCents: 15000 });
  assert.notEqual(s.processorCents, 22500);
  assert.equal(s.processorCents, 0);
});

test('fee helpers stay on the meat line only', () => {
  assert.equal(platformFeeCents(50000), 5000);
  assert.equal(farmerPayoutCents(50000), 45000);
  assert.equal(platformFeeCents(0), 0);
});
