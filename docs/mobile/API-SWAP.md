# Mobile → Vercel API swap map (consolidation step 2)

**Status:** Mapping only (2026-09-05). Do **not** treat this as implemented.  
**Canonical web API:** `https://www.proteinoutfitters.com/api/*` (Neon via `deploy/api`, ~84 route files).  
**Mobile today:** Supabase project `unybunaqyqrxhfyhvhfo` + offline `processors.bundled.json`.  
**Nested app paths:** `mobile/apps/mobile`, `mobile/packages/shared`.

Evidence base: call sites under `mobile/`, route inventory under `deploy/api/`, live probes of `/api/map-data` and `/api/processors` (2026-09-05).

---

## Verdict

| Layer | Reality |
|-------|---------|
| Map first paint | **Bundled JSON only** — works with **zero** network / Supabase / API |
| Live processor list | Supabase `processors` table via shared `getAllProcessors` |
| Live detail / claim / request | Supabase tables + RPCs; **no bundled fallback** on those screens |
| Auth | **Supabase Auth** (OTP deep link + Apple identity token) |
| Web marketplace | **Neon + cookie `po_session`** — different schema, different auth, different claim model |

A naive “point Expo at `/api/*`” swap is **not** a URL change. It needs a **shape adapter**, a **session strategy for RN**, and at least one **new write route** for custom processing requests.

---

## 1. Mobile call sites → current source → candidate API

### Actively used by Expo screens

| Mobile call site | Current source | Candidate `/api/*` | Status |
|------------------|----------------|--------------------|--------|
| `app/map.tsx` → `loadBundledProcessors()` | `src/data/processors.bundled.json` (472 rows w/ lat/lng) | n/a (offline) | **exists** (ship-ready) |
| `app/map.tsx` → `loadProcessors()` → `getAllProcessors(supabase)` | Supabase `.from('processors').select('*')` | `GET /api/map-data` (processors[]) **or** `GET /api/processors` | **partial** — see notes |
| `app/processor/[slug].tsx` → `getProcessorBySlug` | Supabase `.from('processors').eq('slug')` | `GET /api/processors?slug=` | **exists** (shape differs) |
| `app/request/[slug].tsx` → `getProcessorBySlug` | same | same | **exists** (shape differs) |
| `app/request/[slug].tsx` → `submitRequest` | Supabase `.from('processor_requests').insert` | *(none)* | **missing** |
| `app/claim/[slug].tsx` → `getProcessorBySlug` | Supabase | `GET /api/processors?slug=` | **exists** |
| `app/claim/[slug].tsx` → `submitClaim` | Supabase `.from('processor_claims').insert` (pending review) | `POST /api/processors` body `{ claim_id \| claim_slug }` | **partial** — instant claim, not review queue |
| `app/account.tsx` → `signInWithOtp` | Supabase Auth OTP → deep link tokens | `POST /api/auth/request-link` | **partial** — email exists; verify UX differs |
| `app/auth/callback.tsx` → `setSession({ access_token, refresh_token })` | Supabase session | `GET /api/auth/verify?token=` | **partial** — sets **HttpOnly cookie** + 302 HTML; not RN tokens |
| `app/account.tsx` → Apple `signInWithIdToken` | Supabase Auth Apple provider | *(none on Vercel API)* | **missing** |
| `app/account.tsx` → `auth.getUser` / `onAuthStateChange` / `signOut` | Supabase Auth | `GET /api/auth/me` (+ `/api/me`), `POST /api/auth/logout` | **partial** — cookie session only today |
| `app/account.tsx` → `rpc('delete_my_account')` | Supabase RPC | `POST /api/account-delete` `{ confirm: "delete my account" }` | **exists** (needs Neon session) |

### Exported in shared but **not** called by current Expo UI

| Shared API (`packages/shared/src/lib/queries.ts`) | Current source | Candidate | Status |
|--------------------------------------------------|----------------|-----------|--------|
| `getProcessorsNear` | RPC `processors_within` | Client-side haversine on `/api/map-data` set, or new geo query | **unused / missing server geo** |
| `getProcessorsInBounds` | RPC `processors_in_bounds` | same | **unused / missing** |
| `getProcessorsCountInBounds` | RPC `processors_count_in_bounds` | `map-data` counts / client length | **unused / missing** |

Map already filters/sorts **client-side** (`filterProcessors` + haversine in `map.tsx`), so those RPCs are not blockers for v1.

### Supabase edge functions (email) — not called from mobile JS

| Trigger | Source | Design-repo equivalent |
|---------|--------|------------------------|
| `processor_requests` INSERT → `send-request-emails` | `supabase/functions/` | None for custom requests; marketplace mail lives in `deploy/api/_lib/email.js` |
| `processor_claims` INSERT → `send-claim-emails` | `supabase/functions/` | Claim-on-POST has no review-email path |

---

## 2. Route notes (what “exists” actually means)

### `GET /api/map-data` — best list source for the map

Live probe (2026-09-05): **2321** processors with `{ id, slug, name, city, state, zip, lat, lng, inspection, species, claimable }` (+ farms, demand, opportunity).

- Public read, no auth.
- Slimmer than mobile `Processor` type (no nested `address`, `services[]`, `claim_status`, directory `source`).
- Count ≫ bundled (472) and ≫ default `/api/processors` page size.

### `GET /api/processors`

- `?slug=` → full Neon row (UUID id, flat city/state/zip, `capabilities` JSONB, `owner_id`, phone/email/website/address/lat/lng).
- List without filters: `ORDER BY created_at DESC LIMIT` default **100**, max **300** — **not** a national dump. Do **not** use bare list for map refresh.
- `?claimable=1`, `?state=`, `?q=` supported.

### Claim model mismatch

| | Mobile (Supabase) | Web API (Neon) |
|--|-------------------|----------------|
| Write | Insert `processor_claims` row, admin reviews | `POST /api/processors` with `claim_id`/`claim_slug` sets `owner_id` immediately |
| Auth | `claimant_user_id` must be signed-in Supabase user | `currentUser(req)` via `po_session` cookie |
| Evidence | `evidence_url` / notes required in UI | Not part of claim POST |

### Request model — gap

Mobile `processor_requests` (custom processing inquiry) has **no** Neon table or `/api/*` route. Closest web concepts:

- `/api/bookings`, `/api/reservations`, `/api/listings` — **animal marketplace** shares, not directory “request a custom cut.”
- `/api/concierge`, `/api/hardware-lead` — unrelated lead capture.

**New route needed** (e.g. `POST /api/processor-requests`) before request screen can leave Supabase.

---

## 3. Schema / ID mismatch (must map)

Bundled / Supabase directory shape (`Processor` in shared):

```text
id: "mamp-564" | slug | nested address{} | services[] | claim_status | role | source
```

Neon / Vercel shape (live `?slug=2nd-ave-sausage-company`):

```text
id: UUID | slug | city,state,zip,address TEXT | capabilities JSONB | owner_id | inspection
```

Same slug can exist in both datasets with **different IDs**. After swap, claim/request must use **Neon UUID**, not bundled `mamp-*` ids. Prefer resolving by **slug** for reads; never mix ID namespaces.

---

## 4. Auth implications

| Concern | Web (`deploy/api`) | Mobile today |
|---------|-------------------|--------------|
| Identity store | Neon `users` + `sessions` | Supabase Auth users |
| Session transport | HttpOnly cookie `po_session` | AsyncStorage JWT (access/refresh) |
| Magic link | `request-link` → email → `verify` **302 + Set-Cookie** | OTP → `proteinoutfitters://auth/callback?access_token&refresh_token` |
| Apple Sign In | Not implemented | `signInWithIdToken({ provider: 'apple' })` |
| `currentUser()` | Cookie only — **no Bearer** | n/a |

**Blockers for authenticated mobile writes against Neon:**

1. Extend `currentUser` (and verify flow) to accept a **Bearer session token** (or mobile-friendly verify that returns `{ sessionId }` JSON instead of only Set-Cookie redirect).
2. Decide: keep Apple via a new `/api/auth/apple` that creates Neon sessions, or drop Apple until later.
3. Deep link: web verify currently opens **browser** and sets cookie; RN needs an app-handled token response + `SecureStore`/`AsyncStorage` for `po_session` id sent as `Authorization: Bearer …` or `Cookie` header (RN can send Cookie manually if not HttpOnly-from-webview).

Until auth is bridged, **read-only** API swap (map + detail) can ship; claim / account delete / owned processors cannot.

---

## 5. First phone build **without** this swap

**Confirmed:** map + list + filters + onboarding + legal ship on **bundled** data alone.

| Feature | Without Supabase env / without API swap |
|---------|------------------------------------------|
| Map pins / search / filters | ✅ `loadBundledProcessors()` then soft-upgrade if Supabase configured |
| Home / onboarding | ✅ local |
| Processor detail | ❌ needs Supabase (no bundled lookup by slug today) |
| Request / claim | ❌ needs Supabase |
| Account magic link / Apple / delete | ❌ needs Supabase |

`mobile/apps/mobile/src/lib/supabase.ts` already stubs the client when `EXPO_PUBLIC_SUPABASE_*` missing so the app does not crash — reviewers still see the map (“cached”).

**Recommendation for first EAS preview:** ship with bundled path; optional Supabase keys only if you want live detail before API swap. Do **not** block the binary on Neon auth.

Bundle source of truth: `supabase/seed/processors.bundled.json` → `npm run mobile:bundle-data` → `mobile/apps/mobile/src/data/processors.bundled.json`.

---

## 6. API that exists but mobile does **not** use

Examples (web marketplace / ops — out of scope for directory v1 phone):

`/api/listings`, `/api/listing`, `/api/reservations`, `/api/checkout`, `/api/bookings`, `/api/cut-sheets`, `/api/farms`, `/api/farm-*`, `/api/donations*`, `/api/social-*`, `/api/stripe-webhook`, `/api/connect-onboarding`, `/api/processor-ops`, `/api/admin-*`, import/seed/cron routes, etc.

Useful later for phone: listings + reservations + checkout once buyer marketplace is in-app.

---

## 7. Recommended swap order (smallest safe PRs)

| PR | Scope | Risk | Unlocks |
|----|-------|------|---------|
| **A** | `mapApi.ts` + Neon→`Processor` adapter; `loadProcessors()` tries `GET /api/map-data` then bundled; keep Supabase as optional tertiary | Low | Live national pins without auth |
| **B** | Detail (and request/claim **reads**) via `GET /api/processors?slug=` + **bundled fallback by slug** | Low | Detail works offline / no Supabase |
| **C** | Env: `EXPO_PUBLIC_API_BASE=https://www.proteinoutfitters.com`; stop requiring Supabase for reads | Low | Cleaner EAS secrets |
| **D** | Auth bridge: Bearer/session JSON for magic link; wire account screen to `/api/auth/*` + `/api/me` | Medium | Neon identity |
| **E** | Claim writes → `POST /api/processors` claim; align UI copy with instant claim (or add review queue later) | Medium | Claim without Supabase |
| **F** | New `POST /api/processor-requests` (+ email) | Medium | Request screen off Supabase |
| **G** | Account delete → `/api/account-delete`; remove `@supabase/supabase-js` when unused | Low after D | Single backend |
| **H** (optional) | Apple Sign In → Neon; geo endpoints if map grows past client filter | — | Parity |

Do **not** combine A–F in one PR. Ship A+B before touching auth.

---

## 8. Exact files to touch (when implementing)

### Mobile / shared (primary)

| File | Change |
|------|--------|
| `mobile/packages/shared/src/lib/queries.ts` | Replace Supabase client param with fetch/API client, or add parallel `apiQueries.ts` |
| `mobile/packages/shared/src/types/processor.ts` | Keep UI type; add `fromNeonProcessor` / `fromMapDataRow` mappers |
| `mobile/packages/shared/src/index.ts` | Export new API helpers |
| `mobile/apps/mobile/src/lib/processors.ts` | Prefer `/api/map-data`, then bundled (drop or demote Supabase) |
| `mobile/apps/mobile/src/lib/supabase.ts` | Eventually delete or narrow to unused |
| **new** `mobile/apps/mobile/src/lib/api.ts` | Base URL, fetch wrapper, session header |
| `mobile/apps/mobile/app/map.tsx` | No change if `loadProcessors` keeps same contract |
| `mobile/apps/mobile/app/processor/[slug].tsx` | API + bundled fallback |
| `mobile/apps/mobile/app/request/[slug].tsx` | API read; wait for F for write |
| `mobile/apps/mobile/app/claim/[slug].tsx` | API read; wait for D+E for write |
| `mobile/apps/mobile/app/account.tsx` | Auth rewrite (D) |
| `mobile/apps/mobile/app/auth/callback.tsx` | Handle Neon verify deep link (D) |
| `mobile/apps/mobile/.env.example` | `EXPO_PUBLIC_API_BASE`; deprecate Supabase keys |
| `mobile/apps/mobile/app.config.js` / EAS secrets | Same |
| `mobile/package.json` / `apps/mobile/package.json` | Drop `@supabase/supabase-js` after G |

### API (only when auth / requests need it)

| File | Change |
|------|--------|
| `deploy/api/_lib/db.js` | `currentUser`: accept `Authorization: Bearer <sessionId>` |
| `deploy/api/auth/verify.js` | Optional `?format=json` / mobile redirect that returns session id |
| `deploy/api/auth/request-link.js` | Mobile deep-link `next` / redirect URL |
| **new** `deploy/api/processor-requests.js` | Custom request insert + email |
| `deploy/api/account-delete.js` | Already OK once session works |

### Docs / consolidation

| File | Change |
|------|--------|
| `CONSOLIDATION.md` | Point step 2 at this doc; stop listing Supabase as long-term mobile backend |
| `mobile/docs/setup-guide.md` | API base URL setup |

---

## 9. Out of scope for this map

- Implementing the swap (separate PRs per §7).
- Re-seeding Neon from Supabase directory tables.
- Moving buyer marketplace (listings/reservations) into Expo.

---

## Quick reference — live counts (2026-09-05)

| Dataset | Processors |
|---------|------------|
| Mobile bundled JSON | 472 (geo-filtered) |
| Live `/api/map-data` | 2321 |
| Live `/api/processors` default page | ≤100 (≤300 max) |
