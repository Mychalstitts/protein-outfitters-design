# Protein Outfitters — Consolidation Map

**Canonical repo:** `Mychalstitts/protein-outfitters-design`  
**Production domain:** https://www.proteinoutfitters.com  
**Vercel deploy root:** `deploy/`

This document tracks every Protein Outfitters codebase and Vercel project so work stops jumping between repos.

**Last updated:** 2026-09-04 — mobile workspace scaffold landed; Expo/`shared` **source** still pending `git subtree` from private `protein-outfitters-app` ([docs/mobile/MIGRATE.md](./docs/mobile/MIGRATE.md)).

---

## Vercel projects (as of Sep 2026)

| Vercel project | GitHub repo | Role | Status |
|----------------|-------------|------|--------|
| `protein-outfitters-design` | `protein-outfitters-design` | **Primary production** → `www.proteinoutfitters.com` | **Active** |
| `protein-outfitters-design-3nci` | `protein-outfitters-design` | Duplicate project on same repo (legacy) | Delete or pause |
| `protein-outfitters-design-ycmd` | `protein-outfitters-app` | Cross-linked preview; still deploys from **app** repo | **Leak** — pause/delete |
| `protein-outfitters-app` | `protein-outfitters-app` | Next.js project | Pause/delete after mobile source lands |
| `protein-outfitters-app1` | `protein-outfitters-app` | **Still live** at `protein-outfitters-app1.vercel.app` | **Leak** — not redirected |

**Rule:** All new work lands in `protein-outfitters-design` on `main`.

### Host-redirect caveat

`deploy/vercel.json` host redirects only run **inside the design Vercel project**. Confirmed 2026-09-04: `protein-outfitters-app1.vercel.app/find-processors` → **200** (old Next.js). Fix is dashboard-only.

Set **Ignored Build Step** on the design project to  
`bash scripts/vercel-ignore-build.sh` (Root Directory = `deploy/`) so mobile-only commits do not redeploy www. Script: `deploy/scripts/vercel-ignore-build.sh`.

---

## GitHub repos

| Repo | Visibility | Stack | Consolidation status |
|------|------------|-------|----------------------|
| **protein-outfitters-design** | Public | Static HTML + Vercel API + (new) `mobile/` + `packages/shared` workspace | **Canonical** |
| protein-outfitters-app | **Private** | Next.js 14 + Expo 51 + Supabase monorepo | README archive notice; **not** GitHub-archived; still CI/deploys; source of mobile/`shared` |
| protein-outfitters-storefront | — | Snapshot + Vite + Shopify | `supabase/` + `docs/` copied here |
| PO2 / PO / PO3 | Public | Early prototypes | Archive — reference only |

---

## Feature matrix

| Feature | Canonical (design) | Also in app | Action |
|---------|-------------------|-------------|--------|
| Stripe reserve + checkout | ✅ | — | Keep |
| Cut sheet / processor ops / donations / hardware | ✅ | — | Keep |
| Map / discover / compare / referral redirects | ✅ | ✅ | Done on design; app1 still serves old Next pages |
| Saved favorites | `/saved` → `/account` | ✅ localStorage | Wire account to persisted follows |
| Expo iOS/Android | 🟡 `mobile/` scaffold + EAS/CI | ✅ full app | **Subtree source** — [MIGRATE.md](./docs/mobile/MIGRATE.md) |
| Shared package | 🟡 `packages/shared` placeholder | ✅ `@protein-outfitters/shared` | **Subtree source** with mobile |
| CI / EAS workflows | ✅ `mobile-ci`, `eas-preview`, `eas-update` | ✅ | Done (need `EXPO_TOKEN` secret) |

---

## Mobile workspace (this repo)

```
mobile/                 ← Expo app (config overlay in; source pending subtree)
packages/shared/        ← @protein-outfitters/shared (placeholder until subtree)
scripts/mobile/         ← bundle-data.mjs (+ build-icons after copy)
docs/mobile/            ← MIGRATE.md + store docs (after copy)
.github/workflows/      ← mobile-ci.yml, eas-preview.yml, eas-update.yml
```

Root `package.json` declares npm workspaces. Static-site CI uses
`npm install --workspaces=false` so Expo deps do not slow every HTML change.

---

## What was merged (June 17, 2026)

Homepage hub, route/host redirects, processor profiles, map upgrade, compare page, `supabase/`, `docs/` from storefront — see git history.

## What landed (Sep 4, 2026)

9. **Mobile workspace scaffold** — root workspaces, Expo/EAS config overlays, Metro/tsconfig for monorepo layout, path-filtered Mobile CI + EAS preview/update workflows, Vercel ignore-build script, migrate runbook. App + shared **source** still in private app repo.

---

## Next consolidation steps

1. **`git subtree` mobile + shared** from `protein-outfitters-app` into this repo ([docs/mobile/MIGRATE.md](./docs/mobile/MIGRATE.md)). Requires a Cloud Agent / machine with access to the private repo.
2. **GitHub Actions secret** `EXPO_TOKEN` on this repo; EAS secrets for Supabase + Maps.
3. **Vercel dashboard** — delete/pause `protein-outfitters-app1`, `protein-outfitters-app`, `protein-outfitters-design-ycmd`; enable Ignored Build Step.
4. **Archive** `protein-outfitters-app` after first successful EAS preview from this repo; remove its EAS workflows first.
5. **Saved favorites** — wire `/account` to persisted follows.
6. **Clean up** ~55 misplaced `audit-*.md` files at the app repo root (they audit www/design).

---

## Environment

Shared Supabase project: **`unybunaqyqrxhfyhvhfo`** (`supabase/.env.example`). Mobile uses `EXPO_PUBLIC_SUPABASE_*` in `mobile/.env` (see `mobile/.env.example`).
