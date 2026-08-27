import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositSplit } from '../deploy/api/_lib/connect-split.js';

test('deposit goes to the farm; no invented processor fee', () => {
  const s = depositSplit({ amountTotalCents: 15000, depositCents: 15000 });
  assert.equal(s.farmerCents, 15000);
  assert.equal(s.processorCents, 0);
  assert.equal(s.platformRetainCents, 0);
});

test('platform keeps anything charged above the deposit', () => {
  const s = depositSplit({ amountTotalCents: 17500, depositCents: 15000 });
  assert.equal(s.farmerCents, 15000);
  assert.equal(s.processorCents, 0);
  assert.equal(s.platformRetainCents, 2500);
});

test('never invents a $225 processing transfer', () => {
  const s = depositSplit({ amountTotalCents: 15000, depositCents: 15000 });
  assert.notEqual(s.processorCents, 22500);
  assert.equal(s.processorCents, 0);
});
