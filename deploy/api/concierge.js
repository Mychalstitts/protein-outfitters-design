// /api/concierge — Vercel serverless function
// AI buyer concierge: answers questions about listings, certifications,
// processing options, pickup logistics. Knows the marketplace catalog.
//
// ENV: GOOGLE_GEMINI_API_KEY

import { nodejsHandler } from './_lib/db.js';
export const config = { runtime: 'nodejs' };

const SYSTEM = `You are the Protein Outfitters concierge — a friendly, knowledgeable assistant helping buyers navigate a marketplace where small farms sell whole, half, and quarter livestock direct to consumers.

You know:
- Cattle (beef): a half-beef yields ~200-225 lb of cuts, freezer space ~5 cu ft. Whole = ~400 lb.
- Hog: whole hog yields ~120-150 lb of cuts, freezer space ~3 cu ft. Half is more typical for first-timers.
- Lamb: whole lamb yields ~25-35 lb of cuts.
- "Hanging weight" = the weight after slaughter and basic dress, before cuts. Cuts come in at ~60-65% of hanging weight for beef.
- Custom-exempt vs USDA-inspected: custom-exempt is fine for buyer's own consumption; USDA is required if buyer plans to resell.
- Pickup: cuts ready ~10-21 days after slaughter (aging time). Buyers pick up cuts at the processor — Protein Outfitters can show options.
- Common certifications: USDA Organic (no synthetic pesticides/fertilizers), AGA Grassfed (100% forage), Animal Welfare Approved (AWA), Non-GMO Project Verified.

Tone: Warm, direct, never salesy. Speak like the user's friend who happens to know cattle. Default short paragraphs over bullets. If the user asks about a specific listing, surface the farm slug and price and route them with: "Tap **Reserve** on /listing?id=XX to lock it in."

If you don't know something specific (live inventory counts, exact processor availability), say so and suggest they reach the producer through the farm's profile page.

Keep responses under 180 words unless they're explicitly asking for a deep dive.`;

function fallbackReply(messages) {
  const last = String(messages[messages.length - 1]?.content || '').toLowerCase();
  if (last.includes('cut') || last.includes('ribeye') || last.includes('brisket')) {
    return 'Cut sheets lock in how your share gets broken down — ribeyes, ground, roasts, the works. After you reserve on a listing, you\'ll get a cut-sheet link in your account. Not sure what to pick? A balanced "processor\'s choice" default works great for first-timers.';
  }
  if (last.includes('pickup') || last.includes('processor')) {
    return 'Pickup happens at the USDA processor once your animal is cut and wrapped — usually 10–21 days after slaughter depending on dry-age. Your reservation confirmation shows the processor name, address, and pickup window. Browse processors on /map or compare side-by-side at /compare.';
  }
  if (last.includes('organic') || last.includes('grass') || last.includes('cert')) {
    return 'Certifications vary by farm — USDA Organic, AGA grassfed, Animal Welfare Approved, and more show on each listing and farm profile. Filter on /discover or open a farm at /farm/{slug} to see exactly what that producer claims.';
  }
  if (last.includes('price') || last.includes('cost') || last.includes('how much')) {
    return 'Pricing is per-pound hanging weight on each listing — a quarter beef might run $800–$1,400 all-in depending on the animal and farm. Tap any listing for the live price, deposit amount, and estimated take-home weight.';
  }
  if (last.includes('reserve') || last.includes('buy') || last.includes('fraction')) {
    return 'Three taps: pick a listing on /discover, choose your fraction (whole, half, or quarter), and pay the deposit to lock the animal. We coordinate the processor and pickup — you fill out the cut sheet before harvest.';
  }
  return 'Browse live animals on /discover, compare processors on /map, or check /faq for deposits, pickup, and cut sheets. I can also help if you ask about cuts, certifications, or pricing.';
}

async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const messages = body.messages || [];
  if (!messages.length) return Response.json({ reply: "Ask me anything about livestock listings, cuts, or pickup." });

  if (!apiKey) {
    return Response.json({ reply: fallbackReply(messages), _noKey: true, _fallback: true });
  }

  try {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      }
    );
    if (!r.ok) {
      return Response.json({ reply: fallbackReply(messages), _fallback: true, _error: r.status });
    }
    const data = await r.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      return Response.json({ reply: fallbackReply(messages), _fallback: true });
    }
    return Response.json({ reply });
  } catch (e) {
    return Response.json({ reply: fallbackReply(messages), _fallback: true, _error: String(e).slice(0, 200) });
  }
}

export default nodejsHandler(handler);
