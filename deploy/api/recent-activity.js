// /api/recent-activity — emits a feed of recent marketplace events for FOMO tickers.
//
// Used by the live "X people just reserved" badge on /, /discover, /listing,
// /producers, /farm/{slug}. Pulled lazily from the homepage (low priority,
// won't block render).
//
// Privacy: never returns full names. Uses first name + last initial + city.
// Returns activities from the last 7 days, capped at 24 events.

import { sql, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

function maskName(name) {
  if (!name) return 'Someone';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || 'Someone';
  const last = parts[1] ? parts[1][0] + '.' : '';
  return last ? `${first} ${last}` : first;
}

function fuzzyTime(dt) {
  if (!dt) return 'recently';
  const ms = Date.now() - new Date(dt).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const layer = url.searchParams.get('layer'); // optional: 'reservations', 'farms', 'all'
  const includeStats = url.searchParams.get('stats') === '1';

  const out = { events: [], stats: null };

  try {
    // Recent reservations — share size + buyer city + animal label
    const reservations = (!layer || layer === 'reservations' || layer === 'all') ? await sql`
      SELECT
        r.id,
        r.share_size,
        r.created_at,
        u.name AS buyer_name,
        u.zip AS buyer_zip,
        l.id AS listing_id, l.number, l.breed, l.species,
        f.name AS farm_name, f.city AS farm_city, f.state AS farm_state, f.slug AS farm_slug
      FROM reservations r
      JOIN listings l ON l.id = r.listing_id
      JOIN farms f ON f.id = l.farm_id
      LEFT JOIN users u ON u.id = r.buyer_id
      WHERE r.created_at > NOW() - INTERVAL '7 days'
        AND r.status NOT IN ('cancelled','refunded')
      ORDER BY r.created_at DESC
      LIMIT 12` : [];

    for (const r of reservations) {
      const share = ({whole:'the whole animal', half:'a half', quarter:'a quarter', eighth:'an eighth'})[r.share_size] || 'a portion';
      const animal = r.breed || r.species || 'animal';
      out.events.push({
        kind: 'reservation',
        text: `${maskName(r.buyer_name)} reserved ${share} of ${animal} from ${r.farm_name}`,
        time: fuzzyTime(r.created_at),
        link: r.listing_id ? `/listing?id=${r.listing_id}` : (r.farm_slug ? `/farm/${r.farm_slug}` : null),
        emoji: '🥩',
        ts: r.created_at,
      });
    }

    // Recently joined farms
    if (!layer || layer === 'farms' || layer === 'all') {
      const farms = await sql`
        SELECT name, city, state, slug, created_at
        FROM farms
        WHERE created_at > NOW() - INTERVAL '14 days'
          AND owner_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5`;
      for (const f of farms) {
        out.events.push({
          kind: 'farm_joined',
          text: `${f.name} joined Protein Outfitters · ${f.city || ''}${f.state ? ', ' + f.state : ''}`,
          time: fuzzyTime(f.created_at),
          link: `/farm/${f.slug}`,
          emoji: '🌾',
          ts: f.created_at,
        });
      }
    }

    // Sort merged feed by timestamp DESC, cap at 24
    out.events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    out.events = out.events.slice(0, 24);
    // Strip ts before returning (internal only)
    out.events = out.events.map(({ ts, ...rest }) => rest);

    // Optional rolling stats for the home page banner
    if (includeStats) {
      const stats = await sql`
        SELECT
          (SELECT COUNT(*) FROM reservations WHERE created_at > NOW() - INTERVAL '7 days' AND status NOT IN ('cancelled','refunded'))::int AS reservations_week,
          (SELECT COUNT(*) FROM reservations WHERE created_at > NOW() - INTERVAL '24 hours' AND status NOT IN ('cancelled','refunded'))::int AS reservations_today,
          (SELECT COUNT(*) FROM farms WHERE created_at > NOW() - INTERVAL '30 days' AND owner_id IS NOT NULL)::int AS farms_month,
          (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '30 days')::int AS members_month`;
      out.stats = stats[0] || null;
    }
  } catch (e) {
    return new Response(JSON.stringify({ events: [], error: (e.message || '').slice(0, 200) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, s-maxage=30, max-age=10',
    },
  });
}

export default nodejsHandler(handler);
