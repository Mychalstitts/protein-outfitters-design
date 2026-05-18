// Shared helpers for test/auth/*. Integration tests hit live production
// endpoints — only the error / unauth paths are exercised, so we never
// pollute the real auth_tokens, sessions, or users tables.
//
// Override the base URL when testing a preview deploy: TEST_BASE=... node --test
export const BASE = process.env.TEST_BASE || 'https://www.proteinoutfitters.com';

export async function req(method, path, { body, headers } = {}) {
  const h = { 'accept': 'application/json', ...(headers || {}) };
  let bodyOut;
  if (body !== undefined) {
    h['content-type'] = 'application/json';
    bodyOut = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, { method, headers: h, body: bodyOut });
  let json = null;
  const text = await r.text();
  try { json = text ? JSON.parse(text) : null; } catch { /* leave as text */ }
  return { status: r.status, headers: r.headers, json, text };
}

// Some endpoints take a session cookie. These tests never have a valid one —
// they only verify the unauth gates work. Anywhere we'd need an authed call,
// the test asserts the 401 response instead of trying to authenticate.
export function noSessionHeader() {
  return { cookie: 'po_session=' };
}
