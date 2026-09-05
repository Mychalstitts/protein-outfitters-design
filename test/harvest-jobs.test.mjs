import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as HarvestNS from '../deploy/lib/stittsworth-harvest.js';
import * as J from '../deploy/lib/harvest-jobs.js';

const H = (HarvestNS && HarvestNS.default)
  || (HarvestNS && typeof HarvestNS.isoDate === 'function' ? HarvestNS : null);

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

test('pay_status normalizes to unpaid | cash | app', () => {
  assert.deepEqual(J.PAY_STATUSES, ['unpaid', 'cash', 'app']);
  assert.equal(J.normalizePayStatus(undefined), 'unpaid');
  assert.equal(J.normalizePayStatus(''), 'unpaid');
  assert.equal(J.normalizePayStatus('CASH'), 'cash');
  assert.equal(J.normalizePayStatus('App'), 'app');
  assert.equal(J.normalizePayStatus('stripe'), 'unpaid');
  assert.equal(J.isKnownPayStatus('cash'), true);
  assert.equal(J.isKnownPayStatus('card'), false);
  assert.equal(J.isPaid('unpaid'), false);
  assert.equal(J.isPaid('cash'), true);
  assert.equal(J.isPaid('app'), true);
});

test('payStamp stamps paid_at for cash/app and clears on unpaid', () => {
  const stamped = J.payStamp('cash', { pay_status: 'unpaid', paid_at: null });
  assert.equal(stamped.pay_status, 'cash');
  assert.ok(stamped.paid_at);

  const kept = J.payStamp('app', { pay_status: 'cash', paid_at: '2026-09-04T12:00:00.000Z' });
  assert.equal(kept.pay_status, 'app');
  assert.equal(kept.paid_at, '2026-09-04T12:00:00.000Z');

  const cleared = J.payStamp('unpaid', { pay_status: 'cash', paid_at: '2026-09-04T12:00:00.000Z' });
  assert.equal(cleared.pay_status, 'unpaid');
  assert.equal(cleared.paid_at, null);
});

test('payTotals split unpaid vs collected and skip cancelled', () => {
  const totals = J.payTotals([
    { total_due: 185, pay_status: 'unpaid', status: 'confirmed' },
    { total_due: 455, pay_status: 'cash', status: 'confirmed' },
    { total_due: 95, pay_status: 'app', status: 'requested' },
    { total_due: 370, pay_status: 'unpaid', status: 'cancelled' },
  ]);
  assert.equal(totals.unpaid, 185);
  assert.equal(totals.cash, 455);
  assert.equal(totals.app, 95);
  assert.equal(totals.collected, 550);
  assert.equal(totals.total, 735);
});

test('publicJob includes pay fields and defaults unpaid', () => {
  const job = J.publicJob({
    id: 'j1',
    farm_name: 'Northfield',
    town: 'Cass Lake',
    species: 'beef',
    heads: 1,
    share_kind: 'whole',
    trailer_day: '2026-09-22',
    source: 'phone',
    status: 'confirmed',
    kill_due: 185,
    trip_due: 85,
    total_due: 270,
  });
  assert.equal(job.pay_status, 'unpaid');
  assert.equal(job.paid_at, null);
  assert.equal(job.paid_note, null);

  const paid = J.publicJob(Object.assign({}, job, {
    pay_status: 'CASH',
    paid_at: '2026-09-05T15:00:00.000Z',
    paid_note: 'Collected at the trailer',
  }));
  assert.equal(paid.pay_status, 'cash');
  assert.equal(paid.paid_at, '2026-09-05T15:00:00.000Z');
  assert.equal(paid.paid_note, 'Collected at the trailer');
});

test('validateJobInput defaults pay_status unpaid and rejects unknown', () => {
  const now = new Date(2026, 8, 4);
  const ok = J.validateJobInput({
    farm_name: 'Northfield',
    town: 'Cass Lake',
    species: 'beef',
    heads: 1,
    trailer_day: '2026-09-22',
    source: 'phone',
  }, { now });
  assert.equal(ok.ok, true);
  assert.equal(ok.job.pay_status, 'unpaid');
  assert.equal(ok.job.paid_at, null);

  const cash = J.validateJobInput({
    farm_name: 'Northfield',
    town: 'Cass Lake',
    species: 'beef',
    heads: 1,
    trailer_day: '2026-09-22',
    source: 'phone',
    pay_status: 'cash',
  }, { now });
  assert.equal(cash.ok, true);
  assert.equal(cash.job.pay_status, 'cash');
  assert.ok(cash.job.paid_at);

  const bad = J.validateJobInput({
    farm_name: 'Northfield',
    town: 'Cass Lake',
    species: 'beef',
    heads: 1,
    trailer_day: '2026-09-22',
    source: 'phone',
    pay_status: 'stripe',
  }, { now });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /pay_status/.test(e)));
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
  assert.equal(ok.job.pay_status, 'unpaid');

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
  assert.equal(phone.job.pay_status, 'unpaid');

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

test('pay index is created after pay_status ALTER on A1 tables', async () => {
  const files = [
    'deploy/api/harvest-jobs.js',
    'deploy/api/migrate.js',
  ];
  for (const path of files) {
    const src = await readFile(path, 'utf8');
    const alterPay = src.indexOf('ADD COLUMN IF NOT EXISTS pay_status');
    const payIdx = src.indexOf('harvest_jobs_pay_idx');
    assert.ok(alterPay !== -1, path + ' must ALTER ADD pay_status');
    assert.ok(payIdx !== -1, path + ' must create harvest_jobs_pay_idx');
    assert.ok(payIdx > alterPay, path + ' must create pay index after ADD COLUMN pay_status');
    assert.match(src, /CHECK \(pay_status IN \('unpaid','cash','app'\)\)/);
  }
});
