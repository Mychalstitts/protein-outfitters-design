# Mobile API swap — progress

**On `main`:** App Store path (#36) + processor-requests (Slice F). See [APP-STORE-PATH.md](./APP-STORE-PATH.md) for human blockers.

## Done

| Slice | Status |
|-------|--------|
| **A+B** Map + detail reads via `GET /api/map-data` / `GET /api/processors?slug=` (+ bundled fallback); in-memory map-data cache for synthetic `neon-<uuid>` slugs | ✅ |
| **C** `EXPO_PUBLIC_API_BASE_URL`; Supabase off the read path | ✅ |
| **D** Auth bridge: Bearer in `currentUser`; JSON / deep-link verify; SecureStore; account → `/api/auth/*` + `/api/account-delete`; Apple → `/api/auth/apple` | ✅ |
| **E** Claim → `POST /api/processors` with Bearer (`claim_slug` / `claim_id`) | ✅ |
| **F** `POST /api/processor-requests` (+ Resend email) — mobile request screen uses Bearer, Neon table | ✅ |
| **G** Account delete uses `sessions.id` (not nonexistent `token` column); revokes all user sessions | ✅ |

## Still open

| Item | Notes |
|------|--------|
| Store humans | Apple $99, real ASC IDs in `eas.json` (no fakes), device QA, screenshots, AASA / assetlinks host files |

## Smoke

```bash
node mobile/apps/mobile/scripts/smoke-map-data.mjs
# Optional: exercise processor-requests (needs session + live plant slug)
node mobile/apps/mobile/scripts/smoke-processor-requests.mjs
cd mobile && npm run typecheck --workspace apps/mobile
```

## Auth transport

| Client | Session |
|--------|---------|
| Web | HttpOnly cookie `po_session` |
| Mobile | SecureStore → `Authorization: Bearer <sessionId>` |

Magic link: `POST /api/auth/request-link` with `next=proteinoutfitters://auth/callback` → verify 302s to deep link with `?session=`.

## Processor requests

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/processor-requests` | Auth required; body uses `processor_id` (Neon UUID) or `processor_slug` |
| GET | `/api/processor-requests?mine=1` | Caller's requests |
| GET | `/api/processor-requests?slug=` | Plant owner / admin |
| PATCH | `/api/processor-requests?id=` | Owner/admin status update |

Emails need `RESEND_API_KEY` (+ optional `REQUESTS_FALLBACK_EMAIL` when plant has no email). Table is created lazily and via `/api/migrate`.
