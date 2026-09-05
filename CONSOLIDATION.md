# Protein Outfitters — Consolidation Map

**Canonical repo:** `Mychalstitts/protein-outfitters-design`  
**Production domain:** https://www.proteinoutfitters.com  
**Vercel deploy root:** `deploy/`

This document tracks every Protein Outfitters codebase and Vercel project so work stops jumping between repos.

**Last updated:** 2026-09-05 — nested mobile workspace **moved in** from `protein-outfitters-app` (`d212c9f`) via `move-source.sh` → `mobile/{apps/mobile,packages/shared,…}`. Flat PR #26 scaffold removed. Stray Vercel projects remain **paused** (503). Still need `EXPO_TOKEN` + first EAS preview before archiving the app repo.

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
| protein-outfitters-app | **Private** | Next.js 14 + Expo + Supabase monorepo | Source **copied**; archive after first EAS preview from design |
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
| Expo iOS/Android | ✅ `mobile/apps/mobile` | ✅ (source of copy) | Landed — first EAS preview next |
| Shared package | ✅ `mobile/packages/shared` | ✅ | Landed |
| CI / EAS workflows | ✅ retargeted to nested paths | ✅ | Need `EXPO_TOKEN` secret |

---

## Mobile workspace (this repo)

```
mobile/                     ← nested npm workspaces root
  apps/mobile/              ← Expo / EAS app
  packages/shared/          ← @protein-outfitters/shared
  scripts/ docs/            ← helpers + store docs
deploy/                     ← unchanged (Vercel)
supabase/                   ← unchanged (+ functions/README.md)
.github/workflows/          ← mobile-ci, eas-preview, eas-update → nested paths
```

Install and typecheck **inside** `mobile/` (`cd mobile && npm install && npm run typecheck`).
Root `package.json` delegates via `npm run … --prefix mobile` and no longer declares
Expo as a root workspace (keeps static-site CI lean).

Runbook: [docs/mobile/MIGRATE.md](./docs/mobile/MIGRATE.md).

---

## What was merged (June 17, 2026)

Homepage hub, route/host redirects, processor profiles, map upgrade, compare page, `supabase/`, `docs/` from storefront — see git history.

## What landed (Sep 2026)

9. **Mobile workspace scaffold** (PR #26) — overlays + CI stubs.
10. **Nested mobile source move** — `move-source.sh` from `protein-outfitters-app` @ `d212c9f`; flat scaffold removed; Maps key stripped to env/`app.config.js`.

---

## Next consolidation steps

1. **Merge this mobile PR** onto `main`; on Mac fix tracking if needed:
   `git fetch && git checkout main && git reset --hard origin/main && git branch -u origin/main`
2. **GitHub Actions secret** `EXPO_TOKEN`; EAS secrets for Supabase + Maps (rotate Maps key — it was in app-repo / early move history).
3. **First EAS preview** from `mobile/apps/mobile`; then delete EAS workflows in the app repo and **archive** `protein-outfitters-app`.
4. **Vercel** — delete paused projects when ready; enable Ignored Build Step.
5. **Saved favorites** — wire `/account` to persisted follows.

---

## Environment

Shared Supabase project: see `supabase/.env.example`. Mobile Expo env:
`mobile/apps/mobile/.env.example` (`EXPO_PUBLIC_SUPABASE_*`, `GOOGLE_MAPS_ANDROID_KEY`).
