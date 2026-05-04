// /api/parse-search — Vercel serverless function
// Parses natural-language meat marketplace queries into structured filters
// using Google Gemini 2.0 Flash. Falls back gracefully if the API key isn't set.
//
// ENV: GOOGLE_GEMINI_API_KEY  (set in Vercel project settings)

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You parse natural-language meat marketplace queries into structured filters.

Return ONLY valid JSON, no preamble, no markdown fences. Schema:
{
  "filters": {
    "species": "cattle" | "hog" | "lamb" | "poultry" | "bison" | null,
    "practice": ["grass-fed" | "grain-finished" | "pasture-raised" | "regenerative" | "heritage" | "dry-aged"],
    "certs": ["organic" | "non-gmo" | "amwa" | "aga" | "usda-insp" | "state-insp"],
    "identity": ["veteran" | "woman" | "bipoc" | "family" | "indigenous"],
    "priceMin": number | null,
    "priceMax": number | null,
    "distance": number | null,
    "window": "this-month" | "3mo" | "6mo" | null
  },
  "summary": ["short", "human-readable", "filter labels"]
}

Notes:
- "beef", "steer", "cow", "angus", "wagyu" → species: cattle
- "pork", "hog", "berkshire", "mangalitsa" → species: hog
- "$8/lb" or "under $8" → priceMax: 8
- "within 100 miles" → distance: 100
- "ready July" or "ready in July" → window: based on current month
- "veteran-owned" → identity: ["veteran"]
- "regenerative" or "no-till" → practice includes "regenerative"

Be conservative — only include fields the user explicitly requested.`;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const query = (body.query || '').slice(0, 500);
  if (!query) return Response.json({ filters: {}, summary: [] });

  // No key configured — return a signal so client falls back to local parser.
  if (!apiKey) {
    return Response.json({ filters: {}, summary: [], _noKey: true }, { status: 200 });
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: query }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        })
      }
    );
    if (!r.ok) {
      const text = await r.text();
      return Response.json({ filters: {}, summary: [], _error: `Gemini ${r.status}: ${text.slice(0,200)}` }, { status: 200 });
    }
    const data = await r.json();
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(txt); } catch { return Response.json({ filters: {}, summary: [], _badResponse: txt.slice(0,200) }, { status: 200 }); }
    return Response.json(parsed);
  } catch (e) {
    return Response.json({ filters: {}, summary: [], _error: String(e).slice(0,200) }, { status: 200 });
  }
}
