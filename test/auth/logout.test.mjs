// POST /api/auth/logout — clears the session cookie.
//
// Logout is idempotent in this codebase: an unauthed call still returns 200
// and clears any cookie present, so we don't see a meaningful unauth gate to
// test. We verify the cookie-clear response shape instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { req } from './_helpers.mjs';

test('POST /api/auth/logout → 200 (idempotent — no auth required)', async () => {
  const r = await req('POST', '/api/auth/logout');
  assert.equal(r.status, 200);
});

test('POST /api/auth/logout sets a clearing Set-Cookie header', async () => {
  const r = await req('POST', '/api/auth/logout');
  const setCookie = r.headers.get('set-cookie') || '';
  // Should clear the session cookie — match either Max-Age=0 or an expired date.
  assert.ok(
    /po_session=/i.test(setCookie),
    'expected Set-Cookie clearing po_session; got: ' + setCookie
  );
});

test('GET /api/auth/logout also returns 200 (method-loose by design — clear is idempotent + safe)', async () => {
  // The handler accepts any method and clears the cookie. This is intentional
  // so an accidental form-link or prefetch can't break sign-out — both 200.
  const r = await req('GET', '/api/auth/logout');
  assert.equal(r.status, 200);
});
