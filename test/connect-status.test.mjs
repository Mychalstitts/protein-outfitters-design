// Connect status helpers + /farmer wiring.
// These do not hit the network — they lock the restricted/pending resume path
// that used to hide behind the completion-meter top-3 slice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const lib = require('../deploy/lib/connect-status.js');
const { connectPayoutsReady, connectBannerState, pinConnectMissing } = lib;

test('restricted with an Express account id is not payouts-ready', () => {
  assert.equal(connectPayoutsReady({
    stripe_account_id: 'acct_stitty',
    stripe_connect_status: 'restricted',
  }), false);
});

test('pending with an Express account id is not payouts-ready', () => {
  assert.equal(connectPayoutsReady({
    stripe_account_id: 'acct_stitty',
    stripe_connect_status: 'pending',
  }), false);
});

test('account id alone is not payouts-ready', () => {
  assert.equal(connectPayoutsReady({ stripe_account_id: 'acct_stitty' }), false);
});

test('active / charges_enabled / payouts_enabled are ready', () => {
  assert.equal(connectPayoutsReady({ stripe_account_id: 'acct_1', stripe_connect_status: 'active' }), true);
  assert.equal(connectPayoutsReady({ stripe_account_id: 'acct_1', stripe_connect_status: 'charges_enabled' }), true);
  assert.equal(connectPayoutsReady({ stripe_account_id: 'acct_1', stripe_connect_status: 'payouts_enabled' }), true);
});

test('restricted banner is a resume CTA', () => {
  const state = connectBannerState({
    stripe_account_id: 'acct_stitty',
    stripe_connect_status: 'restricted',
  });
  assert.equal(state.level, 'warn');
  assert.equal(state.status, 'restricted');
  assert.equal(state.resume, true);
  assert.equal(state.label, 'Continue Stripe →');
  assert.match(state.message, /still needs a few details/);
});

test('requirements_due also counts as restricted', () => {
  const state = connectBannerState({
    stripe_account_id: 'acct_stitty',
    stripe_connect_status: 'pending',
    requirements_due: ['external_account'],
  });
  assert.equal(state.status, 'restricted');
  assert.equal(state.resume, true);
});

test('pending banner is a resume CTA', () => {
  const state = connectBannerState({
    stripe_account_id: 'acct_stitty',
    stripe_connect_status: 'pending',
  });
  assert.equal(state.status, 'pending');
  assert.equal(state.resume, true);
  assert.match(state.message, /reviewing your account/);
});

test('ready accounts get no banner state', () => {
  assert.equal(connectBannerState({
    stripe_account_id: 'acct_stitty',
    stripe_connect_status: 'active',
  }), null);
});

test('pinConnectMissing keeps Stripe in front of the top-3 slice', () => {
  const missing = [
    { label: 'Add a profile photo', weight: 15 },
    { label: 'Tell your farm story', weight: 15 },
    { label: 'List at least one animal', weight: 25 },
    { label: 'Connect Stripe payouts', action: 'connect', weight: 15 },
  ];
  const dropped = missing.slice().sort((a, b) => b.weight - a.weight).slice(0, 3);
  assert.equal(dropped.some((c) => c.action === 'connect'), false, 'old top-3 slice hid Stripe');

  const top = pinConnectMissing(missing, 3);
  assert.equal(top.length, 3);
  assert.equal(top[0].action, 'connect');
  assert.ok(top.some((c) => c.label === 'List at least one animal'));
});

test('farmer.html paints Connect on load and pins the Stripe row', () => {
  const html = readFileSync(join(root, 'deploy/farmer.html'), 'utf8');
  assert.match(html, /lib\/connect-status\.js/);
  assert.match(html, /pinConnectMissing/);
  assert.match(html, /function paintFarmerConnect/);
  assert.match(html, /paintFarmerConnect\(primaryFarm\)/);
  assert.match(html, /connectStatus\('farm'/);
  assert.match(html, /kind:\s*'farm'/);
  assert.match(html, /c\.action === 'connect'/);
  assert.doesNotMatch(html, /missing\.sort\(\(a, b\) => b\.weight - a\.weight\)\.slice\(0, 3\)/);
});

test('resume still POSTs /api/connect-onboarding via startConnect', () => {
  const api = readFileSync(join(root, 'deploy/po-api.js'), 'utf8');
  assert.match(api, /jsonFetch\('\/api\/connect-onboarding', \{ method: 'POST', body: \{ kind, id \} \}\)/);
  assert.match(api, /po-connect-resume/);
  assert.match(api, /api\.startConnect\(opts\.kind, opts\.id\)/);
});
