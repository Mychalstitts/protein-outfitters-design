// POST /api/auth/request-link — magic-link emission.
//
// We exercise only the validation + 405/400 paths. The 200 path would create
// an auth_tokens row in production, so we skip it (or gate on TEST_E2E=1 if
// you want to run it locally against a Preview deploy with a throwaway email).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { req } from './_helpers.mjs';

test('GET /api/auth/request-link → 405 (POST only)', async () => {
  const r = await req('GET', '/api/auth/request-link');
  assert.equal(r.status, 405);
});

test('POST /api/auth/request-link without body → 400', async () => {
  const r = await req('POST', '/api/auth/request-link');
  assert.equal(r.status, 400);
});

test('POST /api/auth/request-link with malformed JSON → 400', async () => {
  const r = await fetch('https://www.proteinoutfitters.com/api/auth/request-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(r.status, 400);
});

test('POST /api/auth/request-link with empty email → 400', async () => {
  const r = await req('POST', '/api/auth/request-link', { body: { email: '' } });
  assert.equal(r.status, 400);
});

test('POST /api/auth/request-link with invalid email (no @) → 400', async () => {
  const r = await req('POST', '/api/auth/request-link', { body: { email: 'notanemail' } });
  assert.equal(r.status, 400);
});

test('POST /api/auth/request-link with null email → 400', async () => {
  const r = await req('POST', '/api/auth/request-link', { body: { email: null } });
  assert.equal(r.status, 400);
});
