# Protein Outfitters — Consolidation Map

**Canonical repo:** `Mychalstitts/protein-outfitters-design`  
**Production domain:** https://www.proteinoutfitters.com  
**Vercel deploy root:** `deploy/`

This document tracks every Protein Outfitters codebase and Vercel project so work stops jumping between repos.

**Last updated:** 2026-09-05 — nested mobile workspace **landed** from private `protein-outfitters-app` @ `d212c9f` (`mobile/apps/mobile` + `mobile/packages/shared`). Flat scaffold placeholders removed. Stray Vercel projects remain **paused**. Set `EXPO_TOKEN` for EAS Actions.

---

## Vercel projects (as of Sep 2026)

| Vercel project | GitHub repo | Role | Status |
|----------------|-------------|------|--------|
| `protein-outfitters-design` | `protein-outfitters-design` | **Primary production** → `www.proteinoutfitters.com` | **Active** |
| `protein-outfitters-design-3nci` | `protein-outfitters-design` | Duplicate project on same repo (legacy) | **Paused** 2026-09-05 (503) |
| `protein-outfitters-design-ycmd` | `protein-outfitters-app` | Cross-linked preview from app repo | **Paused** 2026-09-05 (503) |
| `protein-outfitters-app` | `protein-outfitters-app` | Next.js project | **Paused** 2026-09-05 (503) |
| `protein-outfitters-app1` | `protein-outfitters-app` | Old Next live site | **Paused** 2026-09-05 (503) — was the public leak |

**Rule:** All new work lands in `protein-outfitters-design` on `main`.

### Host-redirect caveat

`deploy/vercel.json` host redirects only run **inside the design Vercel project**. Confirmed 2026-09-04: `protein-outfitters-app1.vercel.app/find-processors` → **200** (old Next.js). **Paused 2026-09-05** — that host now returns **503 DEPLOYMENT_PAUSED**. Production www still **200**.

Set **Ignored Build Step** on the design project to  
`bash scripts/vercel-ignore-build.sh` (Root Directory = `deploy/`) so mobile-only commits do not redeploy www. Script: `deploy/scripts/vercel-ignore-build.sh`.

---

## GitHub repos

| Repo | Visibility | Stack | Consolidation status |
|------|------------|-------|----------------------|
| **protein-outfitters-design** | Public | Static HTML + Vercel API + nested `mobile/` workspace | **Canonical** |
| protein-outfitters-app | **Private** | Next.js 14 + Expo 51 + Supabase monorepo | README archive notice; source **copied** into design `mobile/`; archive after first EAS preview from this repo |
| protein-outfitters-storefront | — | Snapshot + Vite + Shopify | `supabase/` + `docs/` copied here |
| PO2 / PO / PO3 | Public | Early prototypes | Archive — reference only |

---

## Feature matrix

| Feature | Canonical (design) | Also in app | Action |
|---------|-------------------|-------------|--------|
| Stripe reserve + checkout | ✅ | — | Keep |
| Cut sheet / processor ops / donations / hardware | ✅ | — | Keep |
| Map / discover / compare / referral redirects | ✅ | ✅ | Done on design; app1 paused |
| Saved favorites | `/saved` → `/account` | ✅ localStorage | Wire account to persisted follows |
| Expo iOS/Android | ✅ `mobile/apps/mobile` | ✅ (source of copy) | **Landed** — run EAS from nested app |
| Shared package | ✅ `mobile/packages/shared` | ✅ (source of copy) | **Landed** with mobile |
| CI / EAS workflows | ✅ retargeted to nested paths | ✅ | Need `EXPO_TOKEN` secret |

---

## Mobile workspace (this repo)

Nested npm workspace (self-contained under `mobile/`):

```
mobile/
├── apps/mobile/       Expo / EAS app (app.config.js, eas.json, Metro)
├── packages/shared/   @protein-outfitters/shared
├── scripts/           bundle-data, build-icons, seed, check-env
├── docs/              store readiness, privacy, terms, …
├── package.json       workspaces: apps/*, packages/*
└── package-lock.json  committed for Mobile CI + EAS
```

Root `package.json` does **not** declare Expo workspaces. Convenience scripts
delegate with `npm run … --prefix mobile`. Static-site CI uses plain
`npm install` at the repo root.

Runbook / history: [docs/mobile/MIGRATE.md](./docs/mobile/MIGRATE.md).  
App README: [mobile/README.md](./mobile/README.md).

---

## What was merged (June 17, 2026)

Homepage hub, route/host redirects, processor profiles, map upgrade, compare page, `supabase/`, `docs/` from storefront — see git history.

## What landed (Sep 2026)

9. **Mobile workspace scaffold** (PR #26) — overlays, CI/EAS stubs, migrate runbook.
10. **Nested Expo + shared source** — rsync/`move-source` from `protein-outfitters-app` @ `d212c9f` into `mobile/`; root delegates; workflows point at `mobile/` + `mobile/apps/mobile`.

---

## Next consolidation steps

1. **GitHub Actions secret** `EXPO_TOKEN` on this repo; EAS secrets for Supabase + Maps (`GOOGLE_MAPS_ANDROID_KEY`, `EXPO_PUBLIC_SUPABASE_*`).
2. **Label a PR `mobile-build`** (or run EAS locally from `mobile/apps/mobile`) for the first preview binary from this repo.
3. **Vercel dashboard** — delete paused stray projects when ready; confirm Ignored Build Step.
4. **Archive** `protein-outfitters-app` after first successful EAS preview from this repo; remove its EAS workflows first.
5. **Saved favorites** — wire `/account` to persisted follows.
6. **Clean up** ~55 misplaced `audit-*.md` files at the app repo root (they audit www/design).

---

## Environment

Shared Supabase project: **`unybunaqyqrxhfyhvhfo`** (`supabase/.env.example`).

Mobile Expo env (copy examples → local `.env`; never commit secrets):

- Workspace / scripts: `mobile/.env.example`
- Expo (required for `expo start`): `mobile/apps/mobile/.env.example` → `mobile/apps/mobile/.env`
