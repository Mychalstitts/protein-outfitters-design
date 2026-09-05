# Mobile API swap — PR A+B (map + detail reads)

**Status:** Implemented on branch `cursor/mobile-api-map-data-8023` (2026-09-05).

## What changed

| Path | Role |
|------|------|
| `apps/mobile/src/lib/api.ts` | `EXPO_PUBLIC_API_BASE_URL` (default `https://www.proteinoutfitters.com`) + `apiGet` |
| `apps/mobile/src/lib/neonAdapter.ts` | Neon `/api/map-data` + `/api/processors?slug=` → `Processor` |
| `apps/mobile/src/lib/processors.ts` | Load order: **map-data → Supabase (optional) → bundled**; keeps the last map-data set in memory |
| Detail / claim / request screens | Reads via `loadProcessorBySlug` (API → in-memory map-data → bundled → Supabase) |
| Claim / request submit | `resolveSupabaseProcessorId` maps a Neon-sourced read back to the Supabase directory id by slug before writing; refuses (friendly alert) when there is no Supabase counterpart |
| `scripts/smoke-map-data.mjs` | Live probe; expects ≥2000 adapted pins |

Writes (claim/request submit) and auth remain on Supabase until later PRs (D–F in `API-SWAP.md`).

## Notes

- ~60% of Neon map rows lack `slug` (live probe 2026-09-05: 1,405 / 2,321). We synthesize `neon-<uuid>` so pins still render; `/api/processors?slug=` 404s for these, so detail is served from the in-memory map-data set (cold start / deep link re-fetches map-data first). Backfilling `slug` in Neon removes the need for this.
- Neon UUIDs ≠ bundled/Supabase `mamp-*` ids. Until PRs D–F move writes to `/api`, claim/request writes resolve the Supabase id by slug (`resolveSupabaseProcessorId`) and never send a Neon UUID into Supabase. Listings with only a synthetic slug can't be claimed/requested in-app yet.
- Smoke: `node mobile/apps/mobile/scripts/smoke-map-data.mjs`
