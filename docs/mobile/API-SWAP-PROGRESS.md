# Mobile API swap — PR A+B (map + detail reads)

**Status:** Implemented on branch `cursor/mobile-api-map-data-8023` (2026-09-05).

## What changed

| Path | Role |
|------|------|
| `apps/mobile/src/lib/api.ts` | `EXPO_PUBLIC_API_BASE_URL` (default `https://www.proteinoutfitters.com`) + `apiGet` |
| `apps/mobile/src/lib/neonAdapter.ts` | Neon `/api/map-data` + `/api/processors?slug=` → `Processor` |
| `apps/mobile/src/lib/processors.ts` | Load order: **map-data → Supabase (optional) → bundled** |
| Detail / claim / request screens | Reads via `loadProcessorBySlug` (API → bundled → Supabase) |
| `scripts/smoke-map-data.mjs` | Live probe; expects ≥2000 adapted pins |

Writes (claim/request submit) and auth remain on Supabase until later PRs (D–F in `API-SWAP.md`).

## Notes

- ~60% of Neon map rows lack `slug`; we synthesize `neon-<id>` so pins still render. Prefer real Neon slugs when linking to detail.
- Neon UUIDs ≠ bundled `mamp-*` ids — always key writes by **slug** after auth bridge.
- Smoke: `node mobile/apps/mobile/scripts/smoke-map-data.mjs`
