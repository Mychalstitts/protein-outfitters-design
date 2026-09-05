/**
 * Smoke-test /api/processor-requests auth gate (no session → 401).
 * Full POST requires a live Bearer session — skip unless SMOKE_SESSION is set.
 *
 *   node mobile/apps/mobile/scripts/smoke-processor-requests.mjs
 *   SMOKE_SESSION=… SMOKE_SLUG=stittsworth-smokehouse node …/smoke-processor-requests.mjs
 */
const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL || 'https://www.proteinoutfitters.com';

const unauth = await fetch(`${BASE}/api/processor-requests`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({
    processor_slug: 'does-not-matter',
    contact_name: 'Smoke Test',
    contact_email: 'smoke@example.com',
    animal_type: 'beef',
    service_requested: 'consultation',
  }),
});

const unauthBody = await unauth.json().catch(() => ({}));
if (unauth.status !== 401) {
  console.error('Expected 401 without auth, got', unauth.status, unauthBody);
  process.exit(1);
}

const summary = {
  ok: true,
  unauthStatus: unauth.status,
  unauthError: unauthBody.error || null,
  base: BASE,
};

const session = process.env.SMOKE_SESSION;
const slug = process.env.SMOKE_SLUG;
if (session && slug) {
  const res = await fetch(`${BASE}/api/processor-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${session}`,
    },
    body: JSON.stringify({
      processor_slug: slug,
      contact_name: 'Smoke Test',
      contact_email: 'smoke+processor-request@proteinoutfitters.com',
      animal_type: 'beef',
      service_requested: 'consultation',
      notes: 'agent smoke — safe to ignore',
    }),
  });
  const body = await res.json().catch(() => ({}));
  summary.authedStatus = res.status;
  summary.requestId = body.request?.id || null;
  summary.email = body.email || null;
  if (res.status !== 201) {
    console.error(JSON.stringify({ ...summary, body }, null, 2));
    process.exit(1);
  }
}

console.log(JSON.stringify(summary, null, 2));
