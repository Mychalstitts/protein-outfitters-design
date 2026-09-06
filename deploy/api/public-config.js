// /api/public-config — emits frontend-safe configuration values.
//
// Why a server endpoint instead of inline globals: env vars are stored in
// Vercel and we don't want to redeploy the static HTML every time we toggle
// a tracker. The frontend caches this for the page life.
//
// Currently exposes:
//   clarity_project_id  — Microsoft Clarity tracker ID (env: CLARITY_PROJECT_ID)
//   posthog_key         — PostHog public key (env: POSTHOG_PUBLIC_KEY) — optional
//   posthog_host        — PostHog host (env: POSTHOG_HOST) — optional
//
// Intentionally NOT exposed: CARTO_API_KEY / MAPBOX_*. Opportunity Radar
// (/admin-hotspots) and /map use keyless Esri (+ OSM fallback) in po-basemap.js.
// Do not mint a Carto key unless we switch back to cartocdn tiles.
//
// CORS-friendly, cached at the edge for 5 minutes.

import { json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const body = {
    clarity_project_id: process.env.CLARITY_PROJECT_ID || null,
    posthog_key: process.env.POSTHOG_PUBLIC_KEY || null,
    posthog_host: process.env.POSTHOG_HOST || null,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, s-maxage=300, max-age=60',
      'access-control-allow-origin': '*',
    },
  });
}

export default nodejsHandler(handler);
