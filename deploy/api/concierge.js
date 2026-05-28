// /api/concierge — Vercel serverless function
// AI buyer concierge: answers questions about listings, certifications,
// processing options, pickup logistics. Knows the marketplace catalog.
//
// ENV: GOOGLE_GEMINI_API_KEY

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

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const messages = body.messages || [];
  if (!messages.length) return Response.json({ reply: "Ask me anything about livestock listings, cuts, or pickup." });

  if (!apiKey) {
    return Response.json({
      reply: "Concierge is offline (Gemini API key not configured). In the meantime, browse listings on /discover or message a farm directly via their profile page.",
      _noKey: true
    });
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
      return Response.json({ reply: "Concierge is having trouble reaching the AI service. Try again in a moment.", _error: r.status });
    }
    const data = await r.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Hmm, I didn't catch that — try rephrasing?";
    return Response.json({ reply });
  } catch (e) {
    return Response.json({ reply: "Concierge ran into a snag. Try again?", _error: String(e).slice(0, 200) });
  }
}
