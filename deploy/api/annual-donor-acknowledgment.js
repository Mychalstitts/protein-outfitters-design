// /api/annual-donor-acknowledgment — once-a-year cron sweeper
//
// Triggers D3 (annual consolidated tax letter) for every individual donor
// with at least one qualifying donation in the prior calendar year.
//
//   POST /api/annual-donor-acknowledgment            → run for last year (default)
//   POST /api/annual-donor-acknowledgment?year=2025  → run for a specific year
//   GET  /api/annual-donor-acknowledgment?dryRun=1   → preview without sending
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}". For ad-hoc
// runs you can pass ?secret=$EMAIL_TICK_SECRET in the URL.
//
// Idempotency: each donor+year combination has a stable dedup_key
// `D3::donor::<donor_id>::<year>` so re-running the sweep is safe — already-sent
// rows are skipped at the email_log layer.
//
// Vercel cron config (vercel.json — schedule for January 15th of each year):
//   { "path": "/api/annual-donor-acknowledgment", "schedule": "0 15 15 1 *" }

import { sql, err, json, nodejsHandler } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'nodejs' };

function authorized(req, url) {
  const authHeader = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  const querySecret = url.searchParams.get('secret');
  if (process.env.EMAIL_TICK_SECRET && querySecret === process.env.EMAIL_TICK_SECRET) return true;
  // Vercel cron also sets x-vercel-cron header to '1' when triggered by a cron.
  if (req.headers.get('x-vercel-cron') === '1' && process.env.CRON_SECRET) return true;
  return false;
}

async function handler(req) {
  const url = new URL(req.url, 'https://www.proteinoutfitters.com');
  if (!authorized(req, url)) return err(401, 'Unauthorized');
  if (!['GET', 'POST'].includes(req.method)) return err(405, 'Method not allowed');

  const year = parseInt(url.searchParams.get('year') || (new Date().getFullYear() - 1), 10);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) return err(400, 'Invalid year');
  const dryRun = url.searchParams.get('dryRun') === '1';

  // Find every distinct individual donor with ≥1 non-cancelled donation in the year.
  // Aggregates totals so the email body has the year summary numbers.
  const donors = await sql`
    SELECT u.id AS donor_id, u.name AS donor_name, u.email AS donor_email,
           COUNT(d.id)::int AS donation_count,
           COALESCE(SUM(COALESCE(l.estimated_hanging_weight, d.estimated_lb)), 0)::int AS total_lb,
           COALESCE(SUM(d.fmv), 0)::float AS total_fmv,
           MIN(d.created_at) AS oldest_date,
           MAX(d.created_at) AS newest_date
    FROM donations d
    JOIN users u ON u.id = d.donor_id
    LEFT JOIN listings l ON l.id = d.listing_id
    WHERE d.status NOT IN ('cancelled')
      AND EXTRACT(YEAR FROM d.created_at) = ${year}
      AND u.email IS NOT NULL
    GROUP BY u.id, u.name, u.email
  `;

  const results = [];
  for (const donor of donors) {
    if (dryRun) {
      results.push({ donor_email: donor.donor_email, donations: donor.donation_count, totalFmv: donor.total_fmv, dryRun: true });
      continue;
    }
    const out = await sendLifecycleEmail('D3.annual_acknowledgment', {
      to: donor.donor_email,
      donor_name: donor.donor_name,
      year,
      donation_count: donor.donation_count,
      total_lb: donor.total_lb,
      total_fmv: donor.total_fmv,
      oldest_date: donor.oldest_date,
      newest_date: donor.newest_date,
      dedupKey: `D3::donor::${donor.donor_id}::${year}`,
    });
    results.push({ donor_email: donor.donor_email, donations: donor.donation_count, ...out });
  }

  return json({
    year,
    eligibleDonors: donors.length,
    sent: results.filter(r => r.sent).length,
    skipped: results.filter(r => r.skipped).length,
    failed: results.filter(r => r.error).length,
    dryRun,
    results,
  });
}

export default nodejsHandler(handler);
