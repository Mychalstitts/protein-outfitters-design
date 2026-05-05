// /api/config — return public client-side config (Maps key, etc.)
//   GET → { mapsKey, ... }
// Maps key is restricted by HTTP referrer (proteinoutfitters.com) in Google Cloud Console.

export const config = { runtime: 'edge' };

export default async function handler() {
  const body = {
    mapsKey: process.env.GOOGLE_MAPS_KEY || '',
    geminiAvailable: !!process.env.GOOGLE_GEMINI_API_KEY,
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 's-maxage=300' }
  });
}
