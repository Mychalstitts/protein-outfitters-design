// /api/farm-meta — server-rendered Open Graph card for /farm/:slug
//
// Why this exists:
//   The /farm/:slug route is rewritten to a static SPA shell that has the
//   same generic <meta og:*> tags for every farm. When someone shares a
//   farm link in iMessage / Slack / Twitter / Facebook, the scraper sees
//   the SPA shell (no JS executes for scrapers) and renders the generic
//   site card — same image, same headline, every time. Useless for virality.
//
// What this does:
//   1. Sniffs the User-Agent. If it's a known social-scraper bot, returns
//      a tiny HTML doc with farm-specific og:title, og:description, og:image,
//      and twitter:card tags. The bot reads the meta and is done — no JS
//      ever runs, so we don't need the full SPA.
//   2. For real humans, fetches the farm-profile.html SPA shell from the
//      same origin and returns it unchanged. URL stays /farm/:slug, the
//      SPA reads the slug from the path and renders the farm normally.
//
// Wired in via vercel.json:
//   { "source": "/farm/:slug", "destination": "/api/farm-meta?slug=:slug" }

import { sql } from './_lib/db.js';

export const config = { runtime: 'edge' };

const SOCIAL_BOT_RE = /facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot|SkypeUriPreview|Embedly|Pinterest|redditbot|Applebot|googlebot|bingbot|YandexBot|DuckDuckBot|iframely|vkShare|W3C_Validator|baiduspider|facebookcatalog|GoogleOther/i;

const SITE_ORIGIN = 'https://www.proteinoutfitters.com';
// NOTE: og-image.svg is what the rest of the site uses today. SVG works in
// modern previews (Slack, iMessage, Twitter) but is finicky on older
// scrapers — generating a proper 1200x630 PNG at /brand/og-default.png is
// a follow-up. Until then we match the existing convention.
const DEFAULT_OG_IMAGE = SITE_ORIGIN + '/brand/og-image.svg';

// HTML escape for safe meta values
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOgDoc(farm, slug) {
  const title = `${farm.name} — Reserve a whole animal | Protein Outfitters`;
  const desc = (farm.bio && farm.bio.length > 20)
    ? farm.bio.replace(/\s+/g, ' ').slice(0, 190).trim()
    : `${farm.name} raises pasture-finished livestock in ${farm.city || ''}${farm.city && farm.state ? ', ' : ''}${farm.state || ''}. Reserve your share with one tap on Protein Outfitters.`;
  const cover = farm.cover_url || farm.avatar_url || DEFAULT_OG_IMAGE;
  const url = `${SITE_ORIGIN}/farm/${slug}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Protein Outfitters">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cover)}">
<meta property="og:image:alt" content="${esc(farm.name)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(cover)}">

<link rel="canonical" href="${esc(url)}">
</head>
<body>
<h1>${esc(farm.name)}</h1>
<p>${esc(desc)}</p>
<p><a href="${esc(url)}">View this farm on Protein Outfitters</a></p>
</body>
</html>`;
}

export default async function handler(req) {
  const url = new URL(req.url, SITE_ORIGIN);
  const slug = url.searchParams.get('slug') || '';
  const ua = req.headers.get('user-agent') || '';

  // Real users → just stream the SPA shell back. URL stays /farm/:slug.
  // We return a normal 200 with the static HTML; Vercel's edge cache + CDN
  // makes this effectively free.
  if (!SOCIAL_BOT_RE.test(ua)) {
    try {
      const shellRes = await fetch(`${SITE_ORIGIN}/farm-profile.html`, {
        headers: { 'cache-control': 'public, max-age=60' }
      });
      if (!shellRes.ok) {
        return new Response('Farm profile unavailable', { status: 502 });
      }
      const html = await shellRes.text();
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        }
      });
    } catch {
      return new Response('Farm profile unavailable', { status: 502 });
    }
  }

  // Bot path — fetch farm by slug, return OG-rich tiny doc.
  if (!slug) {
    return new Response('Missing slug', { status: 400 });
  }

  let farm = null;
  try {
    const rows = await sql`
      SELECT name, bio, city, state, cover_url, avatar_url
      FROM farms
      WHERE slug = ${slug}
      LIMIT 1
    `;
    farm = rows[0] || null;
  } catch {
    /* fall through to default card */
  }

  if (!farm) {
    farm = {
      name: 'Protein Outfitters',
      bio: 'A whole animal, in three taps. Reserve pasture-finished livestock direct from family farms.',
      city: '', state: '',
      cover_url: DEFAULT_OG_IMAGE,
      avatar_url: DEFAULT_OG_IMAGE,
    };
  }

  return new Response(buildOgDoc(farm, slug), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Cache OG cards aggressively at the edge — farms don't update often,
      // and re-rendering on every share isn't free.
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
    }
  });
}
