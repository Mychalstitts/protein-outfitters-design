// /api/referrals — invite codes per user + redemption tracking
//
//   GET                          → returns my code (creates one if I don't have one)
//   GET    ?code=XYZ123          → public lookup: validate the code (used on signup pages)
//   POST   { code, reservation_id? } → record a redemption (anonymous OK; user_id captured if signed in)
//
// Reward is captured but defaults to "pending" — the actual credit application
// is done by an admin sweep once the reservation pays/picks up. Reservation
// linkage is optional so a code can be redeemed at signup before any reservation.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

// ─── Code generator: 6 alphanumeric upper, no ambiguous chars ──
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
function newCode() {
  let s = '';
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  for (const n of a) s += ALPHABET[n % ALPHABET.length];
  return s;
}

async function ensureUserCode(userId) {
  const existing = await sql`SELECT code FROM referral_codes WHERE owner_user_id = ${userId} LIMIT 1`;
  if (existing[0]) return existing[0].code;
  for (let i = 0; i < 50; i++) {
    const c = newCode();
    const taken = await sql`SELECT 1 FROM referral_codes WHERE code = ${c} LIMIT 1`;
    if (!taken[0]) {
      await sql`INSERT INTO referral_codes (code, owner_user_id) VALUES (${c}, ${userId})`;
      return c;
    }
  }
  throw new Error('Could not allocate referral code');
}

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const lookup = url.searchParams.get('code');
    if (lookup) {
      // Public validation — used on signup/checkout pages to confirm a code is real.
      const rows = await sql`
        SELECT rc.code, rc.created_at, u.name AS owner_name, u.zip AS owner_zip
        FROM referral_codes rc
        JOIN users u ON u.id = rc.owner_user_id
        WHERE rc.code = ${lookup.toUpperCase()} LIMIT 1`;
      if (!rows[0]) return err(404, 'Code not found');
      return json({ code: rows[0].code, owner_name: rows[0].owner_name, valid: true });
    }
    // Otherwise return my own code (creating it on first call) + balance.
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const code = await ensureUserCode(user.id);
    const redemptions = await sql`
      SELECT id, redeemed_email, reward_status, reward_amount, created_at
      FROM referral_redemptions WHERE code = ${code}
      ORDER BY created_at DESC LIMIT 50`;
    const balRow = await sql`SELECT referral_credit_cents FROM users WHERE id = ${user.id} LIMIT 1`;
    const balanceCents = Number(balRow[0]?.referral_credit_cents || 0);
    const creditedCount = redemptions.filter(r => r.reward_status === 'credited').length;
    return json({
      code,
      url: (process.env.PUBLIC_BASE_URL || 'https://www.proteinoutfitters.com') + '?ref=' + code,
      redemptions,
      balance_cents: balanceCents,
      balance_dollars: balanceCents / 100,
      credited_count: creditedCount,
      reward_per_side_cents: 2500,
    });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const code = (body.code || '').toUpperCase().trim();
    if (!/^[A-Z2-9]{6}$/.test(code)) return err(400, 'Invalid code format');
    const codeRow = await sql`SELECT code, owner_user_id FROM referral_codes WHERE code = ${code} LIMIT 1`;
    if (!codeRow[0]) return err(404, 'Code not found');

    const user = await currentUser(req);
    if (user && user.id === codeRow[0].owner_user_id) {
      return err(409, "You can't redeem your own referral code");
    }

    const rows = await sql`
      INSERT INTO referral_redemptions (code, redeemed_by, redeemed_email, reservation_id, reward_status)
      VALUES (
        ${code},
        ${user?.id || null},
        ${body.email || user?.email || null},
        ${body.reservation_id || null},
        'pending'
      )
      RETURNING *`;
    return json({ redemption: rows[0] });
  }

  return err(405, 'Method not allowed');
}
