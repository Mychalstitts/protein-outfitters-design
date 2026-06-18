// /api/admin-analytics — marketplace analytics for the admin dashboard.
//   GET → { supply, funnel, gmv, reservations_by_week, signups_by_week,
//           geo, referrals, top_farms, errors }
// Admin-only. Every query is individually wrapped so one failure (e.g. a
// missing optional table) degrades that section to a default instead of
// 500-ing the whole dashboard. GMV figures are estimate-based (sum of
// reservation total_estimate); deposits_collected is real money taken.
// Status filters are static literals (no user input) so they're written
// inline rather than interpolated.
import { sql, currentUser, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function safe(label, fn, def, errors) {
  try { return await fn(); }
  catch (e) { errors.push(`${label}: ${e.message}`); return def; }
}

async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  let user = null;
  try { user = await currentUser(req); } catch {}
  if (!user) return err(401, 'Sign in required');
  if (user.role !== 'admin') return err(403, 'Admin only');

  const errors = [];

  // ── Supply side ──
  const supply = await safe('supply', async () => {
    const [farms, procs, active, species] = await Promise.all([
      sql`SELECT COUNT(*)::int c FROM farms`,
      sql`SELECT COUNT(*)::int c FROM processors`,
      sql`SELECT COUNT(*)::int c FROM listings WHERE status = 'active'`,
      sql`SELECT COALESCE(species,'other') species, COUNT(*)::int c FROM listings WHERE status = 'active' GROUP BY species ORDER BY c DESC`,
    ]);
    return {
      farms: farms[0]?.c || 0,
      processors: procs[0]?.c || 0,
      active_listings: active[0]?.c || 0,
      listings_by_species: species,
    };
  }, { farms: 0, processors: 0, active_listings: 0, listings_by_species: [] }, errors);

  // ── Reservation funnel (by status) ──
  const funnel = await safe('funnel', async () => {
    const rows = await sql`
      SELECT status, COUNT(*)::int c, COALESCE(SUM(total_estimate),0)::float gmv
      FROM reservations GROUP BY status`;
    const by_status = {};
    let total = 0;
    for (const r of rows) { by_status[r.status] = { count: r.c, gmv: r.gmv }; total += r.c; }
    const get = s => by_status[s]?.count || 0;
    const paid = get('deposit-paid') + get('paid') + get('processing') + get('ready') + get('picked-up');
    const cancelled = get('cancelled') + get('refunded');
    return {
      total,
      by_status,
      pending: get('pending'),
      paid,
      picked_up: get('picked-up'),
      cancelled,
      deposit_conversion: (total - cancelled) > 0 ? Math.round((paid / (total - cancelled)) * 100) : 0,
    };
  }, { total: 0, by_status: {}, pending: 0, paid: 0, picked_up: 0, cancelled: 0, deposit_conversion: 0 }, errors);

  // ── GMV + money ──
  const gmv = await safe('gmv', async () => {
    const g = await sql`SELECT COALESCE(SUM(total_estimate),0)::float gmv, COUNT(*)::int c
                        FROM reservations WHERE status NOT IN ('cancelled','refunded')`;
    const d = await sql`SELECT COALESCE(SUM(deposit_amount),0)::float dep
                        FROM reservations WHERE status IN ('deposit-paid','paid','processing','ready','picked-up')`;
    const total = g[0]?.gmv || 0, count = g[0]?.c || 0;
    return {
      gmv_total: total,
      reservations_counted: count,
      avg_order: count ? Math.round(total / count) : 0,
      deposits_collected: d[0]?.dep || 0,
    };
  }, { gmv_total: 0, reservations_counted: 0, avg_order: 0, deposits_collected: 0 }, errors);

  // ── Time series (last 12 weeks) ──
  const reservations_by_week = await safe('reservations_by_week',
    () => sql`SELECT to_char(date_trunc('week', created_at),'YYYY-MM-DD') week, COUNT(*)::int c,
                     COALESCE(SUM(total_estimate),0)::float gmv
              FROM reservations
              WHERE created_at > NOW() - INTERVAL '84 days'
              GROUP BY 1 ORDER BY 1`, [], errors);

  const signups_by_week = await safe('signups_by_week',
    () => sql`SELECT to_char(date_trunc('week', created_at),'YYYY-MM-DD') week, COUNT(*)::int c
              FROM users
              WHERE created_at > NOW() - INTERVAL '84 days'
              GROUP BY 1 ORDER BY 1`, [], errors);

  // ── Geography ──
  const geo = await safe('geo', async () => {
    const res_state = await sql`
      SELECT COALESCE(f.state,'—') state, COUNT(*)::int c
      FROM reservations r JOIN listings l ON l.id = r.listing_id JOIN farms f ON f.id = l.farm_id
      WHERE r.status NOT IN ('cancelled','refunded')
      GROUP BY 1 ORDER BY c DESC LIMIT 12`;
    const farm_state = await sql`
      SELECT COALESCE(state,'—') state, COUNT(*)::int c FROM farms GROUP BY 1 ORDER BY c DESC LIMIT 12`;
    return { reservations_by_state: res_state, farms_by_state: farm_state };
  }, { reservations_by_state: [], farms_by_state: [] }, errors);

  // ── Referral performance ──
  const referrals = await safe('referrals', async () => {
    const codes = await sql`SELECT COUNT(*)::int c FROM referral_codes`;
    const reds = await sql`
      SELECT COUNT(*)::int total,
             COUNT(*) FILTER (WHERE reward_status = 'credited')::int credited,
             COUNT(*) FILTER (WHERE reward_status = 'pending')::int pending
      FROM referral_redemptions`;
    const credit = await sql`SELECT COALESCE(SUM(referral_credit_cents),0)::int c FROM users`;
    return {
      codes: codes[0]?.c || 0,
      redemptions: reds[0]?.total || 0,
      credited: reds[0]?.credited || 0,
      pending: reds[0]?.pending || 0,
      credit_outstanding_cents: credit[0]?.c || 0,
    };
  }, { codes: 0, redemptions: 0, credited: 0, pending: 0, credit_outstanding_cents: 0 }, errors);

  // ── Top farms by GMV ──
  const top_farms = await safe('top_farms',
    () => sql`
      SELECT f.name farm, f.slug, COUNT(*)::int reservations, COALESCE(SUM(r.total_estimate),0)::float gmv
      FROM reservations r JOIN listings l ON l.id = r.listing_id JOIN farms f ON f.id = l.farm_id
      WHERE r.status NOT IN ('cancelled','refunded')
      GROUP BY f.name, f.slug ORDER BY gmv DESC LIMIT 8`, [], errors);

  return json({ supply, funnel, gmv, reservations_by_week, signups_by_week, geo, referrals, top_farms, errors });
}

export default nodejsHandler(handler);
