// /api/farm-meta — server-rendered Open Graph card for /farm/:slug
//
// Always returns farm-profile.html with farm-specific meta, then JS hydrates.
// Critical: under /farm/:slug the browser resolves relative ./theme.css as
// /farm/theme.css — so we force root-absolute asset URLs in the served HTML.
//
// Wired via vercel.json: /farm/:slug → /api/farm-meta?slug=:slug

import fs from 'fs';
import path from 'path';
import { sql, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const SITE_ORIGIN = 'https://www.proteinoutfitters.com';
const DEFAULT_OG_IMAGE = SITE_ORIGIN + '/brand/og-image.svg';

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
<base href="/">
<!-- end /api/farm-meta -->
`;
}

function scrubGenericMeta(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name=["']description["'][\s\S]*?>/gi, '')
    .replace(/<meta\s+property=["']og:[^"']+["'][\s\S]*?>/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']+["'][\s\S]*?>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][\s\S]*?>/gi, '')
    .replace(/<base\s[^>]*>/gi, '');
}

/** Force ./theme.css → /theme.css so nested /farm/:slug routes load CSS/JS. */
function absolutizeAssets(html) {
  return html
    .replace(/\b(href|src)=["']\.\/([^"']+)["']/g, '$1="/$2"')
    .replace(/\b(href|src)=["'](?!\/|https?:|data:|blob:|#|mailto:|tel:)([^"']+\.(?:css|js|svg|png|jpg|jpeg|webp|gif|woff2?))["']/gi, '$1="/$2"');
}

function injectIntoHead(html, block) {
  const headOpen = html.match(/<head[^>]*>/i);
  if (!headOpen) return block + html;
  const idx = headOpen.index + headOpen[0].length;
  return html.slice(0, idx) + block + html.slice(idx);
}

async function loadShellHtml() {
  const candidates = [
    path.join(process.cwd(), 'farm-profile.html'),
    path.join(process.cwd(), 'deploy', 'farm-profile.html'),
    path.join(process.cwd(), 'public', 'farm-profile.html'),
  ];
  for (const p of candidates) {
    try {
      return await fs.promises.readFile(p, 'utf8');
    } catch { /* try next */ }
  }
  // Fallback: live origin (cache-busted) if file not bundled into the function
  const r = await fetch(`${SITE_ORIGIN}/farm-profile.html?v=${Date.now()}`, {
    redirect: 'follow',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!r.ok) return null;
  return r.text();
}

async function handler(req) {
  const url = new URL(req.url, SITE_ORIGIN);
  const slug = url.searchParams.get('slug') || '';

  const [shellHtmlRaw, farmRows] = await Promise.all([
    loadShellHtml(),
    slug
      ? sql`SELECT name, bio, city, state, cover_url, avatar_url FROM farms WHERE slug = ${slug} LIMIT 1`.catch(() => [])
      : Promise.resolve([]),
  ]);

  if (!shellHtmlRaw) {
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

  let shellHtml = scrubGenericMeta(shellHtmlRaw);
  shellHtml = absolutizeAssets(shellHtml);
  const finalHtml = injectIntoHead(shellHtml, buildMetaBlock(farm, slug));

  return new Response(finalHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short edge cache so asset-path fixes ship quickly; still CDN-friendly
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
    },
  });
}

export default nodejsHandler(handler);
