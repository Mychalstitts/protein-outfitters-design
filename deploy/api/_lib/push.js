// Web Push helper — data-less pushes signed with VAPID (RFC 8292).
//
// We send the push as a bodyless POST to each of the user's subscription
// endpoints. The Service Worker (deploy/sw.js, `push` handler) receives an
// empty `push` event, then fetches `/api/notifications?unread=1` with the
// SW's cookies to pull the title/body and call self.registration.showNotification.
//
// Why data-less: ECE payload encryption (RFC 8291) is complex enough that
// rolling it inline is risky, and adding a node-only npm package would break
// edge runtime. VAPID alone is just an ES256 JWT signature, which SubtleCrypto
// handles natively on Vercel's edge runtime. The downside is the SW must be
// online to render the body — which is fine for our notification-style use
// case (the message is already a server-side notifications row anyway).
//
// Env required:
//   VAPID_PUBLIC_KEY    — base64url-encoded uncompressed P-256 point (65 bytes)
//   VAPID_PRIVATE_KEY   — base64url-encoded P-256 scalar (32 bytes)
//   VAPID_SUBJECT       — "mailto:ops@proteinoutfitters.com" (or https://...)
//
// Generate locally with `npx web-push generate-vapid-keys` (one-shot, then
// paste the values into Vercel env vars) and expose the public key via
// /api/push-subscribe so the frontend can subscribe with it.
//
// All callers should be best-effort — push delivery is opportunistic, never
// the source of truth. The in-app notifications table is authoritative.

import { sql } from './db.js';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hello@proteinoutfitters.com';
const TTL_SECONDS = 4 * 60 * 60; // 4 hours — push services drop after this

// ── base64url helpers ───────────────────────────────────────
function b64urlToBytes(s) {
  // Web Push uses base64url (RFC 4648 §5) with `-`/`_` and no padding.
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function bytesToB64url(arr) {
  const u8 = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function utf8(s) { return new TextEncoder().encode(s); }

// ── Import the VAPID private key as a SubtleCrypto P-256 signing key ──
// VAPID_PUBLIC_KEY is the 65-byte uncompressed P-256 point (0x04 || X || Y);
// we strip the 0x04 prefix and split into X/Y to build a JWK.
let _privateKeyP;
async function getPrivateKey() {
  if (_privateKeyP) return _privateKeyP;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    throw new Error('VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars required');
  }
  const pub = b64urlToBytes(VAPID_PUBLIC);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY must be 65-byte uncompressed P-256 point');
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const d = VAPID_PRIVATE; // already base64url
  _privateKeyP = crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  return _privateKeyP;
}

// ── Sign a VAPID JWT for a given push-service origin ────────
async function vapidJwt(audience) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12 hours
    sub: VAPID_SUBJECT,
  };
  const head64 = bytesToB64url(utf8(JSON.stringify(header)));
  const body64 = bytesToB64url(utf8(JSON.stringify(claims)));
  const signingInput = head64 + '.' + body64;
  const key = await getPrivateKey();
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    utf8(signingInput)
  );
  return signingInput + '.' + bytesToB64url(new Uint8Array(sigBuf));
}

function originOf(endpoint) {
  try { const u = new URL(endpoint); return u.origin; } catch { return null; }
}

// ── Send a data-less push to one subscription ───────────────
async function sendOneDataless(endpoint) {
  const audience = originOf(endpoint);
  if (!audience) return { ok: false, status: 0, reason: 'bad endpoint' };
  const jwt = await vapidJwt(audience);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': String(TTL_SECONDS),
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
      'Urgency': 'normal',
      // No 'Content-Encoding'/'Content-Type' headers — bodyless push.
      'Content-Length': '0',
    },
  });
  return { ok: res.ok, status: res.status, reason: res.ok ? null : await res.text().catch(() => '') };
}

// ── Public entrypoint — best-effort, never throws ───────────
//
//   await sendPushTo({ email: 'user@x.com' });
//   await sendPushTo({ userId: 'uuid-...' });
//
// Looks up live subscriptions, sends one push per endpoint in parallel,
// and prunes subscriptions whose endpoint returns 404/410 (browser revoked).
export async function sendPushTo(target) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { sent: 0, skipped: true, reason: 'VAPID env not configured' };
  try {
    let subs;
    if (target?.userId) {
      subs = await sql`SELECT endpoint FROM push_subscriptions WHERE user_id = ${target.userId} LIMIT 20`;
    } else if (target?.email) {
      subs = await sql`
        SELECT ps.endpoint FROM push_subscriptions ps
        JOIN users u ON u.id = ps.user_id
        WHERE u.email = ${String(target.email).toLowerCase()} LIMIT 20`;
    } else {
      return { sent: 0, skipped: true, reason: 'no target' };
    }
    if (!subs.length) return { sent: 0, skipped: true, reason: 'no subscriptions' };

    const results = await Promise.all(subs.map(s => sendOneDataless(s.endpoint).catch(e => ({ ok: false, status: 0, reason: e.message, endpoint: s.endpoint }))));

    // Prune dead subscriptions (404 = endpoint gone, 410 = unsubscribed).
    const dead = [];
    results.forEach((r, i) => { if (r.status === 404 || r.status === 410) dead.push(subs[i].endpoint); });
    if (dead.length) {
      try { await sql`DELETE FROM push_subscriptions WHERE endpoint = ANY(${dead})`; } catch { /* best effort */ }
    }

    return { sent: results.filter(r => r.ok).length, total: results.length, pruned: dead.length };
  } catch (e) {
    return { sent: 0, error: e.message };
  }
}
