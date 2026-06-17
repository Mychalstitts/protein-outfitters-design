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

1. **Homepage directory hub** from `protein-outfitters-app` — three-path entry (processors, producers, hardware/opportunities) plus live animal listings below.
2. **Route redirects** in `deploy/vercel.json` so old app URLs resolve on the canonical domain.
3. **`supabase/`** — migrations, edge functions, seed from `protein-outfitters-storefront`.
4. **`docs/`** — launch runbooks, processor onboarding, compliance specs from storefront.

---

## Next consolidation steps (priority order)

1. **Vercel dashboard** — point only `protein-outfitters-design` at `www.proteinoutfitters.com`; add 301 redirects from `protein-outfitters-app1.vercel.app` and duplicate design projects.
2. **Map upgrade** — port `useViewportData`, `SearchThisArea`, and cluster pins from `protein-outfitters-app` into `deploy/map.html`.
3. **Processor profiles** — add `/p/[slug]` equivalent (extend `processor.html` or `farm-meta` API).
4. **Referral landing** — `/r/:code` rewrite → capture ref + redirect home.
5. **Mobile** — move `protein-outfitters-app/app/apps/mobile` to `mobile/` in this repo.
6. **Archive** — mark `protein-outfitters-app`, `protein-outfitters-storefront`, `PO2` read-only with README pointing here.

---

## Environment

All deploy APIs use Supabase project `unybunaqyqrxhfyhvhfo` (see `supabase/.env.example`). Vercel env vars must match across any remaining preview projects until they are decommissioned.