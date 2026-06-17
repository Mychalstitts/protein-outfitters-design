# Protein Outfitters - Full Audit & Consolidation Report

**Date:** May 29, 2026  
**Target Single Source of Truth:** `/Users/Mychal/Documents/Claude/Projects/Protein Outfitters`

---

## 1. Executive Summary

The project is currently fragmented across multiple locations. The goal is to make `/Users/Mychal/Documents/Claude/Projects/Protein Outfitters` the single, authoritative home for the entire system (specs, code, infrastructure, social layer, etc.) with clean connections to Supabase, GitHub, and GoDaddy.

**Current Risk Level:** Medium-High due to split frontend, fragmented git history, and duplicated social layer work.

---

## 2. Current Folder Reality

### Correct Main Folder (Target)
**Path:** `/Users/Mychal/Documents/Claude/Projects/Protein Outfitters`

**What it contains:**
- High-level specifications and decision logs (00–23+ documents)
- `app/` — Vite + React application (internal tools / prototype). Has its own `.git`.
- `deploy/api/` — Large collection of production backend route handlers (reviews, farms, bookings, processors, etc.).
- `supabase/` — Dedicated folder with migrations, Edge Functions, and seed data.
- `patches/DISCOVERY-POLISH-v1/reviews-social-proof-deep-dive/` — Full 86-document social layer design ("Protein Outfitters version of Facebook").
- `infrastructure/` — New documentation for external services (created during this audit).
- `deploy/vercel.json` — Deployment configuration.

**Git status:** Root is **not** a git repository. Only `app/` has its own git history.

### Storefront (Current Customer-Facing Frontend)
**Path:** `/Users/Mychal/Documents/Claude/Projects/stittsworth meats shopify/stittsworth-meats-storefront`

**What it contains:**
- Clean Next.js application (this is almost certainly the live customer site for proteinoutfitters.com).
- Its own separate GitHub repository (`stittsworth-meats-storefront`).
- Still contains a full copy of the 86-file social design work (as a historical sandbox).

### Incorrect Folder
**Path:** `/Users/Mychal/Documents/Claude/Projects/Protein Outfitters (1)`

- Older parallel copy. We have already removed the duplicate social layer work from it.

---

## 3. External Service Connections Audit

### Supabase
- **Status:** Good foundation.
- Correct project ID visible: `unybunaqyqrxhfyhvhfo`.
- Dedicated `supabase/` folder with migrations + functions exists in the main project.
- `.env.example` files are present and point to the right project.
- Some Supabase client code exists in `app/src/`.
- **Risk:** We need to confirm whether the live Next.js storefront is currently pointing at the same Supabase project or an older one.

### GitHub
- **Status:** Highly fragmented.
- Multiple separate repositories exist (`app/`, the storefront repo, possibly others).
- The root of the main "Protein Outfitters" folder is not under version control.
- **Recommendation:** Adopt a monorepo strategy or clear submodule/workspace approach from this root.

### GoDaddy
- **Status:** Mostly documentation only.
- No critical code-level references found yet in the main project.
- Domain (proteinoutfitters.com), DNS, and email are managed here.
- **Action needed:** Create a single source-of-truth document in `infrastructure/godaddy.md` with current DNS records, email setup, and renewal info.

### Vercel
- `deploy/vercel.json` exists and contains production rewrites, redirects, headers, and cron jobs.
- Currently this config is likely applied to the separate storefront repository.

---

## 4. Key Risks Identified

1. **Frontend Split** — The actual public site lives in a completely separate repo and folder. This is the highest risk for "broken" behavior.
2. **Git Fragmentation** — Multiple independent git histories make it easy to lose changes or have drift.
3. **Social Layer Duplication** — Was previously in the storefront and "(1)" folder. Now correctly centralized, but the old copies still exist in the storefront.
4. **Unclear "What runs production?"** — It is not obvious from the main folder alone which code is actually deployed to proteinoutfitters.com today.

---

## 5. Recommended Consolidation Structure (Target State)

```
/Users/Mychal/Documents/Claude/Projects/Protein Outfitters/
├── docs/                              # All specifications, decisions, audits
│   ├── decisions/
│   ├── audits/
│   └── social-layer/                  # The 86-document deep dive (already here)
├── frontend/                          # The customer-facing Next.js app (to be moved here)
├── backend/                           # Or keep as deploy/api/
├── supabase/                          # Already well structured
├── infrastructure/                    # New — centralized docs for all external services
│   ├── supabase.md
│   ├── github.md
│   ├── godaddy.md
│   └── vercel.md
├── scripts/                           # Deployment, migration, seed, audit scripts
├── patches/                           # Keep minimal (historical one-offs only)
└── README.md                          # High-level project overview + how to run everything
```

---

## 6. Immediate Recommended Actions (Prioritized)

1. **Confirm production frontend** — Clarify whether the Next.js storefront is the live site and whether we should move it into `frontend/` in this repo.
2. **Centralize Git** — Decide on monorepo vs references. Make the root a proper git repository.
3. **Audit Supabase usage** across the storefront and the `app/` here. Ensure both point to the same project.
4. **Complete infrastructure documentation** (GoDaddy DNS/email, current Vercel projects, GitHub repo structure).
5. **Remove or clearly mark** the old social layer copies in the storefront and "(1)" folder.
6. **Create a single `.env.example`** at the root that covers all services (Supabase, Resend, etc.).
7. **Update any deployment scripts** to reference paths inside this single folder.

---

## 7. Next Steps I Will Take (unless you stop me)

- Perform a deep file inventory of both the main folder and the storefront.
- Search the entire main project for any remaining references to old paths.
- Create a detailed "Move Plan" for bringing the Next.js frontend into this repo (if desired).
- Begin writing the missing infrastructure docs (especially GoDaddy and current Vercel setup).
- Produce a final "Consolidation Execution Checklist".

Please reply with any preferences on the structure (e.g., do you want the Next.js code moved into `frontend/` now, or do you want to keep it as a separate repo with strong references from here?).

I am ready to execute the next concrete step.
