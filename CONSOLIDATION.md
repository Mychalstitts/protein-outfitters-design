# Protein Outfitters — Consolidation Map

**Canonical repo:** `Mychalstitts/protein-outfitters-design`  
**Production domain:** https://www.proteinoutfitters.com  
**Vercel deploy root:** `deploy/`

This document tracks every Protein Outfitters codebase and Vercel project so work stops jumping between repos.

**Last audited:** 2026-09-04 (read-only pass on private `protein-outfitters-app` @ `d212c9f` + live HTTP checks).

---

## Vercel projects (as of Sep 2026)

| Vercel project | GitHub repo | Role | Status |
|----------------|-------------|------|--------|
| `protein-outfitters-design` | `protein-outfitters-design` | **Primary production** → `www.proteinoutfitters.com` | **Active** |
| `protein-outfitters-design-3nci` | `protein-outfitters-design` | Duplicate project on same repo (legacy) | Delete or pause |
| `protein-outfitters-design-ycmd` | `protein-outfitters-app` | Cross-linked preview; still deploys from **app** repo | **Leak** — pause/delete in dashboard |
| `protein-outfitters-app` | `protein-outfitters-app` | Next.js project (`protein-outfitters-app.vercel.app`) | Pause/delete after mobile move |
| `protein-outfitters-app1` | `protein-outfitters-app` (or unlinked) | **Still live** at `protein-outfitters-app1.vercel.app` | **Leak** — not redirected |

**Rule:** All new work lands in `protein-outfitters-design` on `main`. Other Vercel projects should redirect to `www.proteinoutfitters.com` or be deleted from the Vercel dashboard.

### Host-redirect caveat (important)

`deploy/vercel.json` lists host redirects for `protein-outfitters-app1.vercel.app`, `protein-outfitters-design-3nci`, and `protein-outfitters-design-ycmd`. Those rules only run **inside the design Vercel project**. Requests that hit the old app projects never see that file.

**Confirmed 2026-09-04:** `https://protein-outfitters-app1.vercel.app/find-processors` → **200** (old Next.js), not a redirect to `/map` on www.

**Fix is dashboard-only:** pause/delete the stray projects, or point their domains at the design project. Repo redirects alone cannot close the leak.

---

## GitHub repos

| Repo | Visibility | Stack | Best features | Consolidation status |
|------|------------|-------|---------------|----------------------|
| **protein-outfitters-design** | Public | Static HTML + Vercel serverless API | Full marketplace: reserve/checkout, cut-sheet, processor-ops, donations, hardware, admin, PWA, 70+ API routes | **Canonical** |
| protein-outfitters-app | **Private** | Next.js 14 + Expo 51 + Supabase monorepo under `app/` | Map viewport search, find-processors/suppliers, compare/saved, processor profiles, Expo mobile, `@protein-outfitters/shared` | README archive notice present; **not** GitHub-archived; still CI + deploys on `main` |
| protein-outfitters-storefront | — | Static deploy snapshot + Vite app + Shopify frontend | `supabase/` migrations, `docs/` specs | `supabase/` + `docs/` copied here |
| PO2 | Public | Vite React SPA | Early mobile nav patterns | Archive — UX reference only |
| PO / PO3 | Public | Early prototypes | — | Archive |

**Do not merge:** Shopify storefronts under Stittsworth repos — separate e-commerce product.

---

## Feature matrix (what lives where)

| Feature | Canonical (design) | Also in app | Action |
|---------|-------------------|-------------|--------|
| Stripe reserve + checkout | ✅ | — | Keep |
| Cut sheet builder | ✅ | — | Keep |
| Processor ops + QR check-in | ✅ | — | Keep |
| Donation depot flow | ✅ | — | Keep |
| Hardware / MPU leads | ✅ | — | Keep |
| Farm / processor map | ✅ ZIP + search-this-area | ✅ Leaflet viewport + `processors_in_bounds` | Verify design map uses same RPC; else port |
| Discover / listings | ✅ live API | ✅ Supabase processors | Keep design API |
| Directory hub CTAs | ✅ merged | ✅ was homepage | Done |
| `/find-processors` | redirect → `/map` (design project only) | ✅ live on app1 | Done on design; **app1 still serves old page** |
| `/find-suppliers` | redirect → `/discover` | ✅ empty (no supplier seed) | Done on design |
| Compare processors | ✅ `compare.html` (localStorage pins) | ✅ `/compare` | Matrix was stale — design has it |
| Saved favorites | `/saved` → `/account`; follows API exists | ✅ `/saved` (localStorage) | Wire account to persisted follows |
| Referral `/r/[code]` | redirect → `/?ref=` | ✅ `/r/[code]` | Done on design |
| Expo iOS/Android | — | ✅ `app/apps/mobile` | Move → `mobile/` **with** shared package |
| Shared package | — | ✅ `app/packages/shared` (`@protein-outfitters/shared`) | Move → `packages/shared` (required by mobile) |
| CI / EAS workflows | — | ✅ `ci.yml`, `eas-preview.yml` (`mobile-build` label), `eas-update.yml` | Port when mobile lands here |
| Supabase migrations | ✅ copied — project `unybunaqyqrxhfyhvhfo` | ✅ same project per app `SHIPPED.md` | Wire env; avoid dual-write drift |
| Platform docs / runbooks | ✅ in `docs/` | partial + ~55 misplaced design audits at app root | Move or delete audits |

---

## App monorepo map (private repo, Sep 2026)

Real code lives under `app/`; repo root is mostly docs and audit debris.

| Path | What it is |
|------|------------|
| `.github/workflows/` | `ci.yml`, `eas-preview.yml` (label `mobile-build`), `eas-update.yml` (manual OTA) |
| `app/apps/web/` | Next.js 14.2 App Router — find-processors/suppliers, compare, saved, admin opportunities, affiliate, OG API |
| `app/apps/mobile/` | Expo SDK 51 / RN 0.74 / Expo Router — map, processor, request, claim, account, Apple auth, offline `processors.bundled.json` |
| `app/packages/shared/` | `@protein-outfitters/shared` — types, geo, search, Supabase queries, theme, discovery, attribution + Vitest |
| `app/supabase/` | 7 migrations, RPCs (`processors_within`, `processors_in_bounds`, …), edge `send-request-emails` / `send-claim-emails` |
| `app/scripts/`, `app/docs/` | seed/bundle/icons; store listing + privacy copy |
| repo root | Archive README notice, `SHIPPED.md`, `DEPLOY.md`, many `audit-*.md` (those audits target **www / design**, not this app) |

### Live vs stubbed (app)

**Working:** CI green (as of audit); app1 still public; Supabase seeded (~472 processors); request/claim email path verified historically; mobile features present in code but **never EAS-built/submitted**.

**Stubbed / blocked:** web `/map` client returns null; AskAI “coming soon”; activity ticker synthetic; `/find-suppliers` empty; affiliate routes unseeded; `eas.json` iOS submit placeholders; no `EXPO_TOKEN` Actions secret; store assets 🔴; plaintext Google Maps Android key in `app.json` (restrict in GCP).

---

## What was merged (June 17, 2026)

1. **Homepage directory hub** from `protein-outfitters-app` — three-path entry (processors, producers, supply intel) plus live animal listings below.
2. **Route redirects** — `/find-processors`, `/find-suppliers`, `/admin/opportunities`, `/saved`, `/r/:code` → canonical pages.
3. **Host redirects** — listed in `deploy/vercel.json` (see caveat above — ineffective for traffic that never hits this project).
4. **Processor profiles** — `/p/:slug` via `processor-profile.html` + `api/processor-meta.js`.
5. **Map upgrade** — ZIP search, “Search this area”, viewport-filtered sidebar, compare pins.
6. **Compare page** — `/compare` reads `localStorage` pins from map/profiles.
7. **`supabase/`** — migrations, edge functions, seed from storefront.
8. **`docs/`** — launch runbooks and platform specs from storefront.

---

## Next consolidation steps (priority order)

### A. Dashboard / ops (no code)

1. **Vercel** — pause or delete `protein-outfitters-app1`, `protein-outfitters-app`, `protein-outfitters-design-ycmd`, and duplicate design projects so only `protein-outfitters-design` serves production traffic.
2. **GitHub** — after the mobile move, archive `protein-outfitters-app` (read-only). README notice alone is not enough while CI/PRs/deploys still run.

### B. Code move: workflows, mobile config, shared + web package

Do this from an agent attached to **both** repos (or app repo first, then PR into design). Order matters because mobile imports `@protein-outfitters/shared`.

| Step | From (`protein-outfitters-app`) | To (`protein-outfitters-design`) | Notes |
|------|----------------------------------|----------------------------------|-------|
| 1 | `app/packages/shared/` | `packages/shared/` | Keep package name `@protein-outfitters/shared`; add root workspace/`package.json` if needed |
| 2 | `app/apps/mobile/` | `mobile/` | Point imports at workspace shared; colocate Expo `.env.example`; verify `EXPO_PUBLIC_SUPABASE_*` |
| 3 | `eas.json` + Expo `app.json` / `app.config.*` | under `mobile/` | Restrict Maps Android key in GCP; leave iOS submit placeholders until store accounts exist |
| 4 | `ci.yml` shared+mobile(+web if useful) jobs | `.github/workflows/ci.yml` | Do **not** copy Next.js web build as design production — web stays static/`deploy/` |
| 5 | `eas-preview.yml`, `eas-update.yml` | `.github/workflows/` | Requires `EXPO_TOKEN` (etc.) on **this** repo; preview currently simulator-oriented until app PR #3 merges |
| 6 | Selective web helpers only if design lacks them | `deploy/` or `packages/` | Skip wholesale Next app move — map/compare/saved already exist here |
| 7 | Root `audit-*.md` / `audit-state.json` | `docs/archive/` or delete | Audits of www/design misplaced on the app repo |

**Out of scope for the move:** standing up App Store / Play accounts, screenshots, and production EAS submit until placeholders and secrets exist.

### C. Product follow-ups (design)

1. **Saved favorites** — wire `/account` to persisted farm/processor follows (stop relying on app `localStorage`).
2. **Map RPC check** — confirm design `map.html` / `api/map-data` uses `processors_in_bounds` (or equivalent); port from shared queries if not.
3. **Cut over mobile** only after Vercel leaks are closed and `packages/shared` + `mobile/` CI is green on this repo.

---

## Environment

Shared Supabase project: **`unybunaqyqrxhfyhvhfo`** (see `supabase/.env.example` and app `SHIPPED.md`). Design `deploy/api` and the app monorepo should keep pointing at this one project. Vercel env vars must match across any remaining preview projects until they are decommissioned.
