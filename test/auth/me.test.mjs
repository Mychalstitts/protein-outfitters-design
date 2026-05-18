// GET /api/auth/me + the un-namespaced /api/me alias.
//
// Both return { user: null } when there's no session — they don't 401, by
// design (the bell badge / nav uses them to decide signed-in vs signed-out
// without showing a flash of auth-error).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { req } from './_helpers.mjs';

test('GET /api/auth/me without session → 200 { user: null }', async () => {
  const r = await req('GET', '/api/auth/me');
  assert.equal(r.status, 200);
  assert.ok(r.json, 'expected JSON body');
  assert.equal(r.json.user, null, 'expected user: null when unauth');
});

test('GET /api/me (alias) without session → 200 { user: null }', async () => {
  const r = await req('GET', '/api/me');
  assert.equal(r.status, 200);
  assert.ok(r.json, 'expected JSON body');
  assert.equal(r.json.user, null);
});

test('PATCH /api/auth/me without session → 401', async () => {
  const r = await req('PATCH', '/api/auth/me', { body: { name: 'test' } });
  assert.equal(r.status, 401);
});

test('PATCH /api/me (alias) without session → 401', async () => {
  const r = await req('PATCH', '/api/me', { body: { name: 'test' } });
  assert.equal(r.status, 401);
});

test('GET /api/auth/me responds fast (<2s — proves edge runtime, not nodejs cold-start)', async () => {
  const t0 = Date.now();
  const r = await req('GET', '/api/auth/me');
  const ms = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(ms < 2000, `expected <2s, took ${ms}ms`);
});
