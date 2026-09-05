import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import * as J from '../deploy/lib/harvest-jobs.js';

const require = createRequire(import.meta.url);
const H = require('../deploy/lib/stittsworth-harvest.js');

test('Smokehouse slug is hardcoded — not a national desk', () => {
  assert.equal(J.PROCESSOR_SLUG, 'stittsworth-smokehouse');
  assert.equal(J.PROCESSOR_NAME, 'Stittsworth Smokehouse');
  assert.equal(J.isPlantStaff({ role: 'processor' }), true);
  assert.equal(J.isPlantStaff({ role: 'admin' }), true);
  assert.equal(J.isPlantStaff({ role: 'producer' }), false);
});

test('heads clamp 1–4 and share/source/status normalize', () => {
  assert.equal(J.clampHeads(0), 1);
  assert.equal(J.clampHeads(9), 4);
  assert.equal(J.clampHeads('3'), 3);
  assert.equal(J.normalizeShare('side'), 'half');
  assert.equal(J.normalizeShare('quarter'), 'quarter');
  assert.equal(J.normalizeSource('PHONE'), 'phone');
  assert.equal(J.normalizeSource('web'), 'app');
  assert.equal(J.normalizeStatus('capacity_used'), 'capacity_used');
  assert.equal(J.normalizeStatus('nope'), 'requested');
  assert.equal(J.defaultStatusForSource('phone'), 'confirmed');
  assert.equal(J.defaultStatusForSource('app'), 'requested');
});

test('job quote is kill + one trip — Turtle River trip is $0', () => {
  const tr = J.quoteJob('beef', 'Turtle River', 1);
  assert.equal(tr.kill_due, 185);
  assert.equal(tr.trip_due, 0);
  assert.equal(tr.total_due, 185);
  const two = J.quoteJob('beef', 'Blackduck', 2);
  assert.equal(two.kill_due, 370);
  assert.equal(two.trip_due, 85);
  assert.equal(two.total_due, 455);
});

test('booked heads ignore cancelled jobs and cap leftover at 4', () => {
  const jobs = [
    { id: 'a', trailer_day: '2026-09-22', heads: 2, status: 'requested' },
    { id: 'b', trailer_day: '2026-09-22', heads: 1, status: 'phone' },
    { id: 'c', trailer_day: '2026-09-22', heads: 2, status: 'cancelled' },
    { id: 'd', trailer_day: '2026-09-23', heads: 4, status: 'capacity_used' },
  ];
  jobs[1].status = 'confirmed';
  const booked = J.bookedHeadsByDay(jobs);
  assert.equal(booked['2026-09-22'], 3);
  assert.equal(booked['2026-09-23'], 4);
  assert.equal(J.remainingCapacity('2026-09-22', booked, 4), 1);
  assert.equal(J.remainingCapacity('2026-09-23', booked, H.DAILY_HARVEST_CAPACITY), 0);
  assert.equal(J.canFitJob(jobs, { day: '2026-09-22', heads: 1 }), true);
  assert.equal(J.canFitJob(jobs, { day: '2026-09-22', heads: 2 }), false);
  assert.equal(J.canFitJob(jobs, { day: '2026-09-23', heads: 1, excludeId: 'd' }), true);
});

test('validateJobInput quotes due and rejects unknown towns / over-capacity', () => {
  const now = new Date(2026, 8, 4);
  const ok = J.validateJobInput({
    farm_name: 'Northfield',
    town: 'Cass Lake',
    species: 'beef',
    heads: 2,
    share: 'half',
    trailer_day: '2026-09-22',
    source: 'app',
  }, { now });
  assert.equal(ok.ok, true);
  assert.equal(ok.job.processor_slug, 'stittsworth-smokehouse');
  assert.equal(ok.job.share_kind, 'half');
  assert.equal(ok.job.kill_due, 370);
  assert.equal(ok.job.trip_due, 85);
  assert.equal(ok.job.total_due, 455);
  assert.equal(ok.job.status, 'requested');

  const phone = J.validateJobInput({
    farm_name: 'Call-in ranch',
    town: 'Turtle River',
    species: 'hog',
    heads: 1,
    trailer_day: '2026-09-09',
    source: 'phone',
    phone: '218-555-0100',
  }, { now: new Date(2026, 8, 8) });
  assert.equal(phone.ok, true);
  assert.equal(phone.job.source, 'phone');
  assert.equal(phone.job.status, 'confirmed');
  assert.equal(phone.job.trip_due, 0);

  const badTown = J.validateJobInput({
    farm_name: 'X',
    town: 'Minneapolis',
    species: 'beef',
    heads: 1,
    trailer_day: '2026-09-22',
    source: 'phone',
  }, { now });
  assert.equal(badTown.ok, false);
  assert.ok(badTown.errors.some((e) => /town/.test(e)));

  const full = J.validateJobInput({
    farm_name: 'Overflow',
    town: 'Cass Lake',
    species: 'beef',
    heads: 2,
    trailer_day: '2026-09-22',
    source: 'app',
  }, {
    now,
    existingJobs: [{ id: 'z', trailer_day: '2026-09-22', heads: 3, status: 'requested' }],
  });
  assert.equal(full.ok, false);
  assert.ok(full.errors.some((e) => /leftover/.test(e)));
});

test('cancelled jobs do not consume leftover harvest', () => {
  const now = new Date(2026, 8, 4);
  const checked = J.validateJobInput({
    farm_name: 'Fits',
    town: 'Cass Lake',
    species: 'beef',
    heads: 2,
    trailer_day: '2026-09-22',
    source: 'app',
  }, {
    now,
    existingJobs: [{ id: 'z', trailer_day: '2026-09-22', heads: 4, status: 'cancelled' }],
  });
  assert.equal(checked.ok, true);
});
