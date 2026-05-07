// /api/donation-funds — read endpoint for the public Producer Partnership fund balance.
//
// GET ?summary=public  → public fund stats (no auth):
//      { balance, funded_amount_total, contributors_count,
//        fees_paid_total, fees_paid_count }
//
// GET (no params, admin) → recent donation_funds rows + disbursements rollup.
//
// POST (admin only) — manual ledger entry:
//      { source_type, source_name?, contact_email?, amount, designation?, status? }
//
// Schema lives in api/migrate.js → CREATE TABLE donation_funds (...) and
// CREATE TABLE donation_disbursements (...).
import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

const ALLOWED_SOURCE_TYPES = ['grant', 'corporate', 'individual', 'platform', 'match'];
const ALLOWED_STATUSES = ['pledged', 'received', 'disbursed', 'refunded', 'cancelled'];

async function publicSummary() {
  // Money in: any "received" inflow counts toward funded_amount_total.
  // Pledges not yet received are excluded so the public balance never
  // shows money we can't actually pay out.
  const fundsRows = await sql`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status = 'received'),  0) AS funded_amount_total,
      COUNT(DISTINCT contact_email) FILTER (WHERE status IN ('received','disbursed')) AS contributors_count
    FROM donation_funds`;
  const f = fundsRows[0] || {};

  // Money out: anything in donation_disbursements with status 'sent'.
  const disbRows = await sql`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status = 'sent'), 0) AS fees_paid_total,
      COUNT(*)              FILTER (WHERE status = 'sent')   AS fees_paid_count
    FROM donation_disbursements`;
  const d = disbRows[0] || {};

  const funded = Number(f.funded_amount_total || 0);
  const paid   = Number(d.fees_paid_total || 0);
  return {
    balance:            Math.max(0, funded - paid),
    funded_amount_total: funded,
    contributors_count: Number(f.contributors_count || 0),
    fees_paid_total:    paid,
    fees_paid_count:    Number(d.fees_paid_count || 0),
  };
}

export default async function handler(req) {
  const url = new URL(req.url);

  // ── GET: public summary or admin ledger ──
  if (req.method === 'GET') {
    if (url.searchParams.get('summary') === 'public') {
      try {
        const summary = await publicSummary();
        return json(summary, {
          headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
        });
      } catch (e) {
        // If the schema isn't migrated yet, the donation flow shouldn't 500 —
        // surface a zeroed payload so the page still renders.
        return json({
          balance: 0, funded_amount_total: 0, contributors_count: 0,
          fees_paid_total: 0, fees_paid_count: 0,
          note: 'fund tables not yet provisioned',
        });
      }
    }
    // Admin-only: full ledger.
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    const rows = await sql`
      SELECT * FROM donation_funds ORDER BY created_at DESC LIMIT 200`;
    return json({ funds: rows });
  }

  // ── POST: admin manual entry ──
  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin only');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const { source_type, source_name, contact_email, amount, designation, status, notes } = body || {};
    if (!ALLOWED_SOURCE_TYPES.includes(source_type)) return err(400, 'Invalid source_type');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return err(400, 'amount must be > 0');
    const st = ALLOWED_STATUSES.includes(status) ? status : 'pledged';
    const rows = await sql`
      INSERT INTO donation_funds (
        source_type, source_name, contact_email, amount, designation, status, notes,
        received_at, received_by
      ) VALUES (
        ${source_type}, ${source_name || null}, ${contact_email || null}, ${amt},
        ${designation || null}, ${st}, ${notes || null},
        ${st === 'received' || st === 'disbursed' ? new Date().toISOString() : null},
        ${user.id}
      ) RETURNING *`;
    return json({ fund: rows[0] });
  }

  return err(405, 'Method not allowed');
}
