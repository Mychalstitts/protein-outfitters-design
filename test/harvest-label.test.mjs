import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { harvestLabel } = require('../deploy/lib/harvest-label.js');

test('range when both harvest window columns exist', () => {
  assert.equal(
    harvestLabel({
      harvest_window_start: '2025-06-20',
      harvest_window_end: '2026-09-15',
      expected_finish_date: '2025-06-20',
      birth_date: '2023-12-20',
    }),
    'Jun 20, 2025 – Sep 15, 2026'
  );
});

test('earliest only — does not invent an end from birth_date', () => {
  assert.equal(
    harvestLabel({
      expected_finish_date: '2025-06-20',
      birth_date: '2023-12-20',
    }),
    'Jun 20, 2025'
  );
  assert.equal(
    harvestLabel({
      harvest_window_start: '2025-06-20',
      birth_date: '2023-12-20',
    }),
    'Jun 20, 2025'
  );
});

test('TBD when no start or finish date — still ignores birth_date', () => {
  assert.equal(harvestLabel({ birth_date: '2023-12-20' }), 'TBD');
  assert.equal(harvestLabel({ harvest_window_end: '2026-09-15' }), 'TBD');
  assert.equal(harvestLabel({}), 'TBD');
  assert.equal(harvestLabel(null), 'TBD');
});
