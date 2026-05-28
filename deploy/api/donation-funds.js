// /api/donation-funds — donation program ledger
//
//   GET                     → admin: full ledger + computed balance
//   GET ?summary=public     → public: aggregate balance + counts only (for impact page)
//   POST   { source_type, source_name, amount, ... } → admin: record an incoming pledge / received gift
//   PATCH  ?id=…            → admin: flip status, attach Stripe payment intent
//   POST   ?disburse=1      → admin: record an outbound disbursement against a donation
//
// Schema bootstrapped via /api/migrate.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOWED_SOURCE_TYPES = ['grant','corporate','individual','platform','match'];
const ALLOWED_FUND_STATUSES = ['pledged','received','disbursed','refunded','cancelled'];
const ALLOWED_DISBURSE_CATEGORIES = ['kill_fee','processing','transport','other'];

async function computeBalance() {
  const inflow = await sql`SELECT COALESCE(SUM(amount), 0)::float AS total FROM donation_funds WHERE status = 'received'`;
  const outflow = await sql`SELECT COALESCE(SUM(amount), 0)::float AS total FROM donation_disbursements WHERE status IN ('sent','pending')`;
  return Number(inflow[0]?.total || 0) - Number(outflow[0]?.total || 0);
}

export default async function handler(req) {
  const url = new URL(req.url);

  // ── GET: ledger or public summary ──
  if (req.method === 'GET') {
    const summary = url.searchParams.get('summary');
    if (summary === 'public') {
      // Public-facing — only aggregates, no donor names
      const balance = await computeBalance();
      const inflow = await sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total FROM donation_funds WHERE status = 'received'`;
      const outflow = await sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total FROM donation_disbursements WHERE status = 'sent'`;
      const distinctSources = await sql`SELECT COUNT(DISTINCT source_name)::int AS n FROM donation_funds WHERE status = 'received' AND source_name IS NOT NULL`;
      return json({
        balance,
        funded_amount_total: Number(inflow[0]?.total || 0),
        contributors_count: Number(distinctSources[0]?.n || 0),
        fees_paid_total: Number(outflow[0]?.total || 0),
        fees_paid_count: Number(outflow[0]?.n || 0),
      });
    }

    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    const funds = await sql`SELECT * FROM donation_funds ORDER BY created_at DESC LIMIT 200`;
    const disbursements = await sql`
      SELECT db.*, d.recipient_org, l.number AS animal_number, l.breed, l.species, p.name AS processor_name
      FROM donation_disbursements db
      LEFT JOIN donations d ON d.id = db.donation_id
      LEFT JOIN listings l ON l.id = d.listing_id
      LEFT JOIN processors p ON p.id = db.processor_id
      ORDER BY db.created_at DESC LIMIT 200`;
    const balance = await computeBalance();
    return json({ funds, disbursements, balance });
  }

  // ── POST disbursement (admin) ──
  if (req.method === 'POST' && url.searchParams.get('disburse') === '1') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { donation_id, processor_id, amount, category, notes, stripe_transfer_id } = body;
    if (!donation_id) return err(400, 'donation_id required');
    if (!amount || Number(amount) <= 0) return err(400, 'amount > 0 required');
    if (!ALLOWED_DISBURSE_CATEGORIES.includes(category)) return err(400, `Invalid category: ${category}`);

    // Confirm donation exists
    const donRow = await sql`SELECT id, status FROM donations WHERE id = ${donation_id} LIMIT 1`;
    if (!donRow[0]) return err(404, 'Donation not found');

    // Verify there's enough balance to cover this disbursement
    const balance = await computeBalance();
    if (Number(amount) > balance + 0.01) {
      return err(409, `Insufficient fund balance (${balance.toFixed(2)} available, ${amount} requested). Record more incoming gifts first.`, {
        current_balance: balance,
      });
    }

    const rows = await sql`
      INSERT INTO donation_disbursements (donation_id, processor_id, amount, category, stripe_transfer_id, status, notes)
      VALUES (${donation_id}, ${processor_id || null}, ${Number(amount)}, ${category}, ${stripe_transfer_id || null}, 'sent', ${notes || null})
      RETURNING *`;
    return json({ disbursement: rows[0], balance: await computeBalance() });
  }

  // ── POST: record an incoming gift (admin or public via Stripe webhook) ──
  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { source_type, source_name, contact_email, amount, currency, designation, status, stripe_payment_intent, notes } = body;
    if (!source_type || !ALLOWED_SOURCE_TYPES.includes(source_type)) return err(400, `Invalid source_type: ${source_type}`);
    if (!amount || Number(amount) <= 0) return err(400, 'amount > 0 required');
    const finalStatus = status && ALLOWED_FUND_STATUSES.includes(status) ? status : 'pledged';

    const rows = await sql`
      INSERT INTO donation_funds (source_type, source_name, contact_email, amount, currency, designation, status, stripe_payment_intent, received_at, received_by, notes)
      VALUES (
        ${source_type},
        ${source_name || null},
        ${contact_email || null},
        ${Number(amount)},
        ${currency || 'usd'},
        ${designation || null},
        ${finalStatus},
        ${stripe_payment_intent || null},
        ${finalStatus === 'received' ? new Date().toISOString() : null},
        ${finalStatus === 'received' ? user.id : null},
        ${notes || null}
      )
      RETURNING *`;
    return json({ fund: rows[0], balance: await computeBalance() });
  }

  // ── PATCH: flip status (admin only) ──
  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    const id = url.searchParams.get('id');
    if (!id) return err(400, 'id required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { status, notes, amount } = body;
    if (status && !ALLOWED_FUND_STATUSES.includes(status)) return err(400, `Invalid status: ${status}`);

    const updates = {};
    if (status) {
      updates.status = status;
      if (status === 'received') updates.received_at = new Date().toISOString();
    }
    if (notes != null) updates.notes = notes;
    if (amount != null) updates.amount = Number(amount);

    if (!Object.keys(updates).length) return err(400, 'Nothing to update');

    // Build the dynamic SET clause manually using the rawQuery helper.
    const { rawQuery } = await import('./_lib/db.js');
    const sets = [];
    const params = [];
    let i = 1;
    if (updates.status)       { sets.push(`status = $${i++}`); params.push(updates.status); }
    if (updates.received_at)  { sets.push(`received_at = $${i++}`); params.push(updates.received_at); }
    if (updates.notes != null){ sets.push(`notes = $${i++}`); params.push(updates.notes); }
    if (updates.amount != null){ sets.push(`amount = $${i++}`); params.push(updates.amount); }
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const rows = await rawQuery(`UPDATE donation_funds SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (!rows[0]) return err(404, 'Fund not found');
    return json({ fund: rows[0], balance: await computeBalance() });
  }

  return err(405, 'Method not allowed');
}
