// POST/GET /api/connect-onboarding — unauth parse gates only.
//
// Live production used to return 400 "kind must be farm or processor" on a
// valid POST body because peekJson called req.clone(), which the Node adapter
// does not provide. These tests lock the deployed contract:
//   valid kind → 401 Sign in required
//   missing kind → 400 kind
//   bad JSON → 400 Bad JSON
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, req } from './auth/_helpers.mjs';

test('POST /api/connect-onboarding {kind:farm,id} unsigned → 401 not 400 kind', async () => {
  const r = await req('POST', '/api/connect-onboarding', { body: { kind: 'farm', id: '123' } });
  assert.equal(r.status, 401);
  assert.equal(r.json?.error, 'Sign in required');
});

test('POST /api/connect-onboarding {kind:processor,id} unsigned → 401', async () => {
  const r = await req('POST', '/api/connect-onboarding', { body: { kind: 'processor', id: '123' } });
  assert.equal(r.status, 401);
  assert.equal(r.json?.error, 'Sign in required');
});

test('POST /api/connect-onboarding?kind=farm with {id} unsigned → 401', async () => {
  const r = await req('POST', '/api/connect-onboarding?kind=farm', { body: { id: '123' } });
  assert.equal(r.status, 401);
  assert.equal(r.json?.error, 'Sign in required');
});

test('POST /api/connect-onboarding missing kind → 400 kind', async () => {
  const r = await req('POST', '/api/connect-onboarding', { body: { id: '123' } });
  assert.equal(r.status, 400);
  assert.match(String(r.json?.error || ''), /kind must be "farm" or "processor"/);
});

test('POST /api/connect-onboarding malformed JSON → 400 Bad JSON', async () => {
  const r = await fetch(BASE + '/api/connect-onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(r.status, 400);
  const json = await r.json();
  assert.equal(json.error, 'Bad JSON');
});

test('GET /api/connect-onboarding?kind=farm unsigned → 401', async () => {
  const r = await req('GET', '/api/connect-onboarding?kind=farm');
  assert.equal(r.status, 401);
  assert.equal(r.json?.error, 'Sign in required');
});

test('GET /api/connect-onboarding without kind → 400 kind', async () => {
  const r = await req('GET', '/api/connect-onboarding');
  assert.equal(r.status, 400);
  assert.match(String(r.json?.error || ''), /kind must be "farm" or "processor"/);
});
