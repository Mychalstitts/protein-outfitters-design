// Shared CORS headers for Edge Functions.
// Webhooks come from Supabase itself (no CORS), but having these lets us call
// the function manually from a browser during development.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
