// GET /api/auth/verify?token=… — magic-link token consumption.
//
// The 302-redirect-on-success path can't be tested without a real token (which
// would be consumed on the next call anyway). We test the validation paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { req, BASE } from './_helpers.mjs';

test('GET /api/auth/verify without token → 400', async () => {
  const r = await req('GET', '/api/auth/verify');
  assert.equal(r.status, 400);
});

test('GET /api/auth/verify with empty token → 400', async () => {
  const r = await req('GET', '/api/auth/verify?token=');
  assert.equal(r.status, 400);
});

test('GET /api/auth/verify with bogus token → 400 or 401 (not 5xx)', async () => {
  // Vercel may treat unknown tokens as 400 (bad input) or 401 (no match).
  // Either is acceptable — what we never want is a 5xx.
  const r = await fetch(BASE + '/api/auth/verify?token=not-a-real-token-12345', { redirect: 'manual' });
  assert.ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
});

test('POST /api/auth/verify with token validates input the same as GET (4xx, not 5xx)', async () => {
  // verify.js doesn't enforce a method gate — it always validates the token
  // first. POST with a bogus token gets the same 400/401 as GET with one.
  const r = await req('POST', '/api/auth/verify?token=not-a-real-token');
  assert.ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
});
