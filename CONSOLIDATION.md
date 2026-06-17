# Protein Outfitters — Consolidation Map

**Canonical repo:** `Mychalstitts/protein-outfitters-design`  
**Production domain:** https://www.proteinoutfitters.com  
**Vercel deploy root:** `deploy/`

This document tracks every Protein Outfitters codebase and Vercel project so work stops jumping between repos.

---

## Vercel projects (as of June 2026)

| Vercel project | GitHub repo | Role | Status |
|----------------|-------------|------|--------|
| `protein-outfitters-design` | `protein-outfitters-design` | **Primary production** → `www.proteinoutfitters.com` | **Active** |
| `protein-outfitters-design-3nci` | `protein-outfitters-design` | Duplicate project on same repo (legacy) | Deprecate → redirect to primary |
| `protein-outfitters-design-ycmd` | `protein-outfitters-app` | Cross-linked preview | Deprecate after merge |
| `protein-outfitters-app` | `protein-outfitters-app` | Next.js directory at `protein-outfitters-app1.vercel.app` | **Merge into design, then archive** |

**Rule:** All new work lands in `protein-outfitters-design` on `main`. Other Vercel projects should redirect to `www.proteinoutfitters.com` or be deleted from the Vercel dashboard.

---

## GitHub repos

| Repo | Stack | Best features | Consolidation status |
|------|-------|---------------|----------------------|
| **protein-outfitters-design** | Static HTML + Vercel serverless API | Full marketplace: reserve/checkout, cut-sheet, processor-ops, donations, hardware, admin, PWA, 70+ API routes | **Canonical** |
| protein-outfitters-app | Next.js 14 + Expo + Supabase | Real map viewport search, `/find-processors`, `/find-suppliers`, compare/saved, processor profiles, mobile app | Homepage hub + redirects merged; map UX still to port |
| protein-outfitters-storefront | Static deploy snapshot + Vite app + Shopify frontend | `supabase/` migrations, `docs/` specs, social-layer research | `supabase/` + `docs/` copied here |
| PO2 | Vite React SPA | Early mobile nav patterns (Sell, Bag, Chat) | Archive — UX reference only |
| Protein-Outfitters | Empty | — | Delete or archive |
| PO / PO3 | Early prototypes | — | Archive |

**Do not merge:** `storefront/frontend/` (Stittsworth Shopify storefront) — separate e-commerce product.

---

## Feature matrix (what lives where)

| Feature | Canonical (design) | Also in app | Action |
|---------|-------------------|-------------|--------|
| Stripe reserve + checkout | ✅ | — | Keep |
| Cut sheet builder | ✅ | — | Keep |
| Processor ops + QR check-in | ✅ | — | Keep |
| Donation depot flow | ✅ | — | Keep |
| Hardware / MPU leads | ✅ | — | Keep |
| Farm map (`/map`) | ✅ static | ✅ viewport + clusters | Port viewport search from app |
| Discover / listings | ✅ live API | ✅ Supabase farms | Keep design API |
| Directory hub (processor / farm / opportunities CTAs) | ✅ merged | ✅ was homepage | Done |
| `/find-processors` route | redirect → `/map` | ✅ | Done |
| `/find-suppliers` route | redirect → `/discover` | ✅ | Done |
| Compare processors | — | ✅ | Future: `compare.html` |
| Saved favorites | — | ✅ | Future: account integration |
| Referral `/r/[code]` | ✅ API exists | ✅ route | Future: vercel rewrite |
| Expo iOS/Android | — | ✅ | Future: `mobile/` workspace |
| Supabase migrations | ✅ copied | ✅ | Wire env vars |
| Platform docs / runbooks | ✅ copied | partial | Keep in `docs/` |

---

## What was merged (June 17, 2026)

1. **Homepage directory hub** from `protein-outfitters-app` — three-path entry (processors, producers, supply intel) plus live animal listings below.
2. **Route redirects** — `/find-processors`, `/find-suppliers`, `/admin/opportunities`, `/saved`, `/r/:code` → canonical pages.
3. **Host redirects** — `protein-outfitters-app1.vercel.app`, `protein-outfitters-design-3nci`, `protein-outfitters-design-ycmd` → `www.proteinoutfitters.com` (in `deploy/vercel.json`).
4. **Processor profiles** — `/p/:slug` via `processor-profile.html` + `api/processor-meta.js` (OG tags, request CTA, compare pin).
5. **Map upgrade** — ZIP search, “Search this area”, viewport-filtered sidebar, processor profile links, compare pins.
6. **Compare page** — `/compare` reads `localStorage` pins from map/profiles.
7. **`supabase/`** — migrations, edge functions, seed from storefront.
8. **`docs/`** — launch runbooks and platform specs from storefront.

---

## Next consolidation steps (priority order)

1. **Vercel dashboard** — confirm only `protein-outfitters-design` owns `www.proteinoutfitters.com` (host redirects are in repo; delete duplicate projects when ready).
2. **Mobile** — move `protein-outfitters-app/app/apps/mobile` to `mobile/` in this repo.
3. **Archive sibling repos** — add `ARCHIVED.md` pointing here; set read-only on GitHub.
4. **Saved favorites** — wire account page to persisted farm/processor follows.

---

## Environment

All deploy APIs use Supabase project `unybunaqyqrxhfyhvhfo` (see `supabase/.env.example`). Vercel env vars must match across any remaining preview projects until they are decommissioned.