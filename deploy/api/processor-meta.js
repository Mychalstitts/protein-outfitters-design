// /api/processor-meta — server-rendered Open Graph for /p/:slug
// Same pattern as farm-meta.js: splice processor-specific meta into the SPA shell.

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

function buildMetaBlock(proc, slug) {
  const where = [proc.city, proc.state].filter(Boolean).join(', ');
  const title = `${proc.name} · ${where || 'Meat processor'} | Protein Outfitters`;
  const desc = (proc.bio && proc.bio.length > 20)
    ? proc.bio.replace(/\s+/g, ' ').slice(0, 190).trim()
    : `${proc.name} is a USDA/state-inspected meat processor${where ? ' in ' + where : ''}. Submit a custom processing request on Protein Outfitters.`;
  const cover = proc.cover_url || proc.avatar_url || DEFAULT_OG_IMAGE;
  const url = `${SITE_ORIGIN}/p/${slug}`;

  return `
<!-- begin /api/processor-meta server-rendered -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Protein Outfitters">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cover)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(cover)}">
<link rel="canonical" href="${esc(url)}">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: proc.name,
    url,
    address: {
      '@type': 'PostalAddress',
      addressLocality: proc.city || undefined,
      addressRegion: proc.state || undefined,
      postalCode: proc.zip || undefined,
      addressCountry: 'US',
    },
  })}</script>
<!-- end /api/processor-meta -->
`;
}

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

  const [shellRes, procRows] = await Promise.all([
    fetch(`${SITE_ORIGIN}/processor-profile.html`, { redirect: 'follow' }).catch(() => null),
    slug ? sql`SELECT name, bio, city, state, zip, cover_url, avatar_url, inspection FROM processors WHERE slug = ${slug} LIMIT 1`.catch(() => []) : Promise.resolve([]),
  ]);

  if (!shellRes || !shellRes.ok) {
    return new Response('Processor profile unavailable', { status: 502 });
  }

  const proc = procRows[0] || {
    name: 'Protein Outfitters Processor',
    bio: 'USDA and state-inspected meat processing on Protein Outfitters.',
    city: '', state: '', zip: '', inspection: 'usda',
    cover_url: DEFAULT_OG_IMAGE, avatar_url: DEFAULT_OG_IMAGE,
  };

  let shellHtml = await shellRes.text();
  shellHtml = scrubGenericMeta(shellHtml);
  const finalHtml = injectIntoHead(shellHtml, buildMetaBlock(proc, slug));

  return new Response(finalHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}

export default nodejsHandler(handler);