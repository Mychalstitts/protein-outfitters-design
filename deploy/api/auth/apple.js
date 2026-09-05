// POST /api/auth/apple — body: { identityToken, email?, fullName? }
// Verifies an Apple identity JWT, finds/creates a Neon user, returns a session.
// Mobile stores sessionToken in SecureStore and sends Authorization: Bearer.
import crypto from 'node:crypto';
import {
  sql,
  err,
  json,
  createSession,
  setSessionCookie,
  nodejsHandler,
} from '../_lib/db.js';

export const config = { runtime: 'nodejs' };

const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISS = 'https://appleid.apple.com';
const DEFAULT_AUD = 'com.proteinoutfitters.app';

let _keysCache = { at: 0, keys: null };
const KEYS_TTL_MS = 60 * 60 * 1000;

function b64urlToBuf(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from((s + pad).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function getAppleKeys() {
  if (_keysCache.keys && Date.now() - _keysCache.at < KEYS_TTL_MS) {
    return _keysCache.keys;
  }
  const res = await fetch(APPLE_KEYS_URL);
  if (!res.ok) throw new Error(`Apple JWKS ${res.status}`);
  const body = await res.json();
  _keysCache = { at: Date.now(), keys: body.keys || [] };
  return _keysCache.keys;
}

async function verifyAppleIdentityToken(identityToken, audience) {
  const parts = String(identityToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed identity token');
  const [hB64, pB64, sB64] = parts;
  const header = JSON.parse(b64urlToBuf(hB64).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('Unexpected alg');

  const keys = await getAppleKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');

  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${hB64}.${pB64}`),
    key,
    b64urlToBuf(sB64),
  );
  if (!ok) throw new Error('Invalid signature');

  const payload = JSON.parse(b64urlToBuf(pB64).toString('utf8'));
  if (payload.iss !== APPLE_ISS) throw new Error('Invalid issuer');
  const audOk = Array.isArray(payload.aud)
    ? payload.aud.includes(audience)
    : payload.aud === audience;
  if (!audOk) throw new Error('Invalid audience');
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    throw new Error('Token expired');
  }
  if (!payload.sub) throw new Error('Missing sub');
  return payload;
}

async function ensureAppleSubColumn() {
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_sub TEXT`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_apple_sub_uidx ON users (apple_sub) WHERE apple_sub IS NOT NULL`;
  } catch (e) {
    /* best-effort — query path still works via email */
  }
}

async function handler(req) {
  if (req.method !== 'POST') return err(405, 'POST only');
  let body;
  try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
  if (!body || typeof body !== 'object') return err(400, 'JSON body required');

  const identityToken = body.identityToken || body.identity_token;
  if (!identityToken || typeof identityToken !== 'string') {
    return err(400, 'identityToken required');
  }

  const audience =
    (typeof body.audience === 'string' && body.audience) ||
    process.env.APPLE_CLIENT_ID ||
    DEFAULT_AUD;

  let claims;
  try {
    claims = await verifyAppleIdentityToken(identityToken, audience);
  } catch (e) {
    return err(401, e instanceof Error ? e.message : 'Apple token invalid');
  }

  await ensureAppleSubColumn();

  const appleSub = String(claims.sub);
  const emailFromToken =
    typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const emailFromBody =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const email = emailFromToken || emailFromBody || `apple+${appleSub.slice(0, 24)}@users.proteinoutfitters.com`;

  const fullName =
    body.fullName && typeof body.fullName === 'object'
      ? [body.fullName.givenName, body.fullName.familyName].filter(Boolean).join(' ').trim()
      : typeof body.fullName === 'string'
        ? body.fullName.trim()
        : '';

  // Prefer apple_sub match; fall back to email.
  let userId = null;
  try {
    const bySub = await sql`SELECT id FROM users WHERE apple_sub = ${appleSub} LIMIT 1`;
    if (bySub[0]) userId = bySub[0].id;
  } catch { /* column may be missing on first race */ }

  if (!userId) {
    const byEmail = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    if (byEmail[0]) {
      userId = byEmail[0].id;
      try {
        await sql`UPDATE users SET apple_sub = ${appleSub}, updated_at = NOW() WHERE id = ${userId} AND apple_sub IS NULL`;
      } catch { /* ignore */ }
    }
  }

  if (!userId) {
    const inserted = await sql`
      INSERT INTO users (email, name, role)
      VALUES (${email}, ${fullName || null}, 'buyer')
      ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    userId = inserted[0].id;
    try {
      await sql`UPDATE users SET apple_sub = ${appleSub}, updated_at = NOW() WHERE id = ${userId}`;
    } catch { /* ignore */ }
    if (fullName) {
      try {
        await sql`UPDATE users SET name = COALESCE(name, ${fullName}) WHERE id = ${userId}`;
      } catch { /* ignore */ }
    }
  }

  const sessionToken = await createSession(userId);
  const profile = await sql`
    SELECT id, email, name, role, zip, avatar_url, phone
    FROM users WHERE id = ${userId} LIMIT 1
  `;

  return json(
    { ok: true, sessionToken, user: profile[0] || { id: userId, email } },
    { headers: { 'Set-Cookie': setSessionCookie(sessionToken), 'Cache-Control': 'no-store' } },
  );
}

export default nodejsHandler(handler);
