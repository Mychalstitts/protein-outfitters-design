import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const H = require('../deploy/lib/stittsworth-harvest.js');

test('platform fee is 10% — never 5%', () => {
  assert.equal(H.PLATFORM_FEE_RATE, 0.10);
  assert.equal(H.platformFeeOnGross(3780), 378);
  assert.equal(H.farmerKeep(3780), 3402);
  assert.notEqual(H.platformFeeOnGross(3780), 189);
});

test('share splits are whole / side / quarter of hanging dollars', () => {
  const t = H.shareTotals(5.25, 720);
  assert.equal(t.whole, 3780);
  assert.equal(t.half, 1890);
  assert.equal(t.side, 1890);
  assert.equal(t.quarter, 945);
  assert.equal(H.SHARE_FRACTIONS.whole, 1);
  assert.equal(H.SHARE_FRACTIONS.half, 0.5);
  assert.equal(H.SHARE_FRACTIONS.quarter, 0.25);
  assert.equal(H.SHARE_LABELS.half, 'Side (½)');
});

test('trip fee is $0 at 0 mi; floor applies only when miles > 0', () => {
  assert.equal(H.tripFeeDollars(0), 0);
  assert.equal(H.tripFeeDollars(H.resolveTown('Turtle River')), 0);
  assert.equal(H.harvestDue('beef', 'Turtle River', 1).trip, 0);
  assert.equal(H.tripFeeDollars(18), 85);
  assert.equal(H.tripFeeDollars(34), 85);
  assert.equal(H.tripFeeDollars(55), 137.5);
  assert.equal(H.tripFeeDollars(60), 150);
  assert.equal(H.tripFeeDollars(80), 150);
  assert.equal(H.tripFeeDollars(H.resolveTown('Blackduck')), 85);
  assert.equal(H.tripFeeDollars(H.resolveTown('Park Rapids')), 137.5);
  assert.equal(H.tripRateLabel(0), '$0 trip');
  assert.equal(H.tripRateLabel('Turtle River'), '$0 trip');
  assert.equal(H.tripRateLabel('Blackduck'), '$85 minimum');
  assert.equal(H.tripRateLabel('Park Rapids'), '$2.50/mi');
});

test('unknown town defaults to 60 miles and south', () => {
  const t = H.resolveTown('NotATown');
  assert.equal(t.miles, 60);
  assert.equal(t.quadrant, 'south');
  assert.equal(t.hub, false);
  assert.equal(t.unknown, true);
  assert.equal(H.tripFeeDollars(t), 150);
  const empty = H.resolveTown('');
  assert.equal(empty.miles, 60);
  assert.equal(empty.quadrant, 'south');
});

test('town table matches Bemidji compass miles', () => {
  assert.equal(H.resolveTown('Turtle River').hub, true);
  assert.equal(H.resolveTown('Bemidji').miles, 9);
  assert.equal(H.resolveTown('Blackduck').quadrant, 'north');
  assert.equal(H.resolveTown('Solway').quadrant, 'west');
  assert.equal(H.resolveTown('Walker').quadrant, 'south');
  assert.equal(H.resolveTown('Cass Lake').miles, 20);
  assert.equal(H.resolveTown('Cass Lake').quadrant, 'east');
  assert.equal(H.TOWNS.length, 20);
});

test('kill fees and default hanging numbers', () => {
  assert.equal(H.killFeePerHead('beef'), 185);
  assert.equal(H.killFeePerHead('cattle'), 185);
  assert.equal(H.killFeePerHead('hog'), 95);
  assert.equal(H.killFeePerHead('lamb'), 70);
  assert.equal(H.killFeePerHead('goat'), 70);
  assert.equal(H.killFeePerHead('bison'), 250);
  assert.equal(H.killFeeDollars('beef', 2), 370);
  assert.equal(H.DEFAULT_HANGING_LB.beef, 720);
  assert.equal(H.DEFAULT_HANGING_PER_LB.beef, 5.25);
  assert.equal(H.CUT_WRAP_PER_LB, 0.90);
  assert.equal(H.cutWrapHint(720), 648);
});

test('harvest due is kill + one trip for 1–4 head', () => {
  const q = H.harvestDue('beef', 'Blackduck', 1);
  assert.equal(q.kill, 185);
  assert.equal(q.trip, 85);
  assert.equal(q.total, 270);
  const two = H.harvestDue('beef', 'Blackduck', 2);
  assert.equal(two.kill, 370);
  assert.equal(two.trip, 85);
  assert.equal(two.total, 455);
});

test('draft 123 locks hanging at $4.50 and does not take beef 5.25', () => {
  assert.equal(H.isLockedDraft123('123'), true);
  assert.equal(H.isLockedDraft123('#123'), true);
  assert.equal(H.isLockedDraft123('124'), false);
  const locked = H.hangingDefaults('beef', { number: '123' });
  assert.equal(locked.hangingPerLb, 4.50);
  assert.equal(locked.locked, true);
  const fresh = H.hangingDefaults('beef', {});
  assert.equal(fresh.hangingPerLb, 5.25);
});

test('compass weeks: 1 north, 2 west, 3 south, 4–5 east', () => {
  assert.equal(H.compassQuadrantForDate(new Date(2026, 8, 4)), 'north');
  assert.equal(H.compassQuadrantForDate(new Date(2026, 8, 10)), 'west');
  assert.equal(H.compassQuadrantForDate(new Date(2026, 8, 18)), 'south');
  assert.equal(H.compassQuadrantForDate(new Date(2026, 8, 22)), 'east');
  assert.equal(H.compassQuadrantForDate(new Date(2026, 8, 30)), 'east');
});

test('hub towns can pick any open harvest weekday; others only their quadrant week', () => {
  const now = new Date(2026, 8, 4); // Fri Sep 4, 2026 — this week is North
  const cass = H.resolveTown('Cass Lake');
  const blackduck = H.resolveTown('Blackduck');
  const bemidji = H.resolveTown('Bemidji');

  const eastTue = new Date(2026, 8, 22);
  const northThu = new Date(2026, 9, 1);
  const westWed = new Date(2026, 8, 9);
  const sunday = new Date(2026, 8, 27);

  assert.equal(H.isSelectableTrailerDay(eastTue, cass, { now: now }), true);
  assert.equal(H.isSelectableTrailerDay(eastTue, blackduck, { now: now }), false);
  assert.equal(H.isSelectableTrailerDay(northThu, blackduck, { now: now }), true);
  assert.equal(H.isSelectableTrailerDay(westWed, cass, { now: now }), false);
  assert.equal(H.isSelectableTrailerDay(eastTue, bemidji, { now: now }), true);
  assert.equal(H.isSelectableTrailerDay(westWed, bemidji, { now: now }), true);
  assert.equal(H.isSelectableTrailerDay(sunday, bemidji, { now: now }), false);
  assert.equal(H.isSelectableTrailerDay(new Date(2026, 8, 3), blackduck, { now: now }), false);
});

test('next Blackduck trailer week after Sep 4 2026 is October North days', () => {
  const now = new Date(2026, 8, 4);
  const win = H.nextHarvestWindow('Blackduck', { now: now });
  assert.ok(win);
  assert.equal(H.isoDate(win.headline), '2026-10-01');
  assert.equal(win.quadrant, 'north');
  const isos = win.days.map((d) => d.iso);
  assert.ok(isos.includes('2026-10-01'));
  assert.ok(isos.includes('2026-10-06'));
  assert.ok(isos.includes('2026-10-07'));
});
