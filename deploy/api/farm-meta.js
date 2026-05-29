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
//   Always returns the full farm-profile.html SPA shell, but with the
//   farm-specific Open Graph + Twitter meta tags spliced into <head>.
//   Both bots and humans get the same response — bots read the meta,
//   humans get the same HTML the SPA expects, then JS hydrates as normal.
//   This means the CDN can cache the response by URL with no Vary on
//   User-Agent, which is critical: branching on UA inside an Edge Function
//   makes every cache lookup a coin flip and breaks viral previews.
//
// Wired in via vercel.json:
//   { "source": "/farm/:slug", "destination": "/api/farm-meta?slug=:slug" }

import { sql, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

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

function buildMetaBlock(farm, slug) {
  const title = `${farm.name} — Reserve a whole animal | Protein Outfitters`;
  const desc = (farm.bio && farm.bio.length > 20)
    ? farm.bio.replace(/\s+/g, ' ').slice(0, 190).trim()
    : `${farm.name} raises pasture-finished livestock${farm.city ? ' in ' + farm.city : ''}${farm.state ? ', ' + farm.state : ''}. Reserve your share with one tap on Protein Outfitters.`;
  const cover = farm.cover_url || farm.avatar_url || DEFAULT_OG_IMAGE;
  const url = `${SITE_ORIGIN}/farm/${slug}`;

  return `
<!-- begin /api/farm-meta server-rendered -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Protein Outfitters">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cover)}">
<meta property="og:image:alt" content="${esc(farm.name)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(cover)}">
<link rel="canonical" href="${esc(url)}">
<!-- end /api/farm-meta -->
`;
}

// Strip the existing generic <title> and any og:* / twitter:* meta from the
// SPA shell so our farm-specific block wins. Scrapers usually take the FIRST
// match, but cleaning up the duplicates avoids any ambiguity and keeps the
// served HTML clean.
function scrubGenericMeta(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name=["']description["'][\s\S]*?>/gi, '')
    .replace(/<meta\s+property=["']og:[^"']+["'][\s\S]*?>/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']+["'][\s\S]*?>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][\s\S]*?>/gi, '');
}

function injectIntoHead(html, block) {
  const headOpen = html.match(/<head[^>]*>/i);
  if (!headOpen) return block + html;
  const idx = headOpen.index + headOpen[0].length;
  return html.slice(0, idx) + block + html.slice(idx);
}

async function handler(req) {
  const url = new URL(req.url, SITE_ORIGIN);
  const slug = url.searchParams.get('slug') || '';

  // Fetch the SPA shell + farm record in parallel — both are cheap, neither
  // depends on the other, no reason to serialize.
  const [shellRes, farmRows] = await Promise.all([
    fetch(`${SITE_ORIGIN}/farm-profile.html`, { redirect: 'follow' }).catch(() => null),
    slug ? sql`SELECT name, bio, city, state, cover_url, avatar_url FROM farms WHERE slug = ${slug} LIMIT 1`.catch(() => []) : Promise.resolve([]),
  ]);

  if (!shellRes || !shellRes.ok) {
    return new Response('Farm profile unavailable', { status: 502 });
  }

  const farm = farmRows[0] || {
    name: 'Protein Outfitters',
    bio: 'A whole animal, in three taps. Reserve pasture-finished livestock direct from family farms.',
    city: '',
    state: '',
    cover_url: DEFAULT_OG_IMAGE,
    avatar_url: DEFAULT_OG_IMAGE,
  };

  let shellHtml = await shellRes.text();
  shellHtml = scrubGenericMeta(shellHtml);
  const finalHtml = injectIntoHead(shellHtml, buildMetaBlock(farm, slug));

  return new Response(finalHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Cache aggressively at the edge keyed by URL — same response served
      // to bots and humans, so no Vary needed. Farms don't change often;
      // hitting fresh data on first request after edit is fine.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    }
  });
}

export default nodejsHandler(handler);
