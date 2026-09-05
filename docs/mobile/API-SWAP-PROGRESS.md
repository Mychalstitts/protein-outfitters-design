# Mobile API swap — progress

**Branch:** `cursor/mobile-app-store-path-8023` (folds PR #32 map/detail + auth bridge + claim)

## Done

| Slice | Status |
|-------|--------|
| **A+B** Map + detail reads via `GET /api/map-data` / `GET /api/processors?slug=` (+ bundled fallback) | ✅ |
| **C** `EXPO_PUBLIC_API_BASE_URL`; Supabase off the read path | ✅ |
| **D** Auth bridge: Bearer in `currentUser`; JSON / deep-link verify; SecureStore; account → `/api/auth/*` + `/api/account-delete`; Apple → `/api/auth/apple` | ✅ |
| **E** Claim → `POST /api/processors` with Bearer (`claim_slug` / `claim_id`) | ✅ |
| **G** Account delete uses `sessions.id` (not nonexistent `token` column); revokes all user sessions | ✅ |

## Still open (not this PR)

| Slice | Notes |
|-------|--------|
| **F** `POST /api/processor-requests` (+ email) | Request screen still uses Supabase `submitRequest` |
| Store humans | Apple $99, ASC IDs in `eas.json`, device QA, screenshots |

## Smoke

```bash
node mobile/apps/mobile/scripts/smoke-map-data.mjs
cd mobile && npm run typecheck --workspace apps/mobile
```

## Auth transport

| Client | Session |
|--------|---------|
| Web | HttpOnly cookie `po_session` |
| Mobile | SecureStore → `Authorization: Bearer <sessionId>` |

Magic link: `POST /api/auth/request-link` with `next=proteinoutfitters://auth/callback` → verify 302s to deep link with `?session=`.
