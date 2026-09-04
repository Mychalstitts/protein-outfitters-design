# CONSOLIDATION.md — edits to apply with the mobile move

## Feature matrix — replace these rows

| Feature | Canonical (design) | Also in app | Action |
|---------|-------------------|-------------|--------|
| Expo iOS/Android | ✅ `mobile/` workspace | ✅ (archived copy) | Done — builds + OTA run from this repo |
| Shared package (types, geo, search, theme, attribution) | ✅ `packages/shared` | ✅ (archived copy) | Done — consumed by `mobile/`; `deploy/api` may import later |
| Compare processors | ✅ `compare.html` | ✅ | Done |
| Referral `/r/[code]` | ✅ redirect → `/?ref=` | ✅ route | Done |

## GitHub repos — update the app row

| protein-outfitters-app | Next.js 14 + Expo + Supabase | … | **Archived** — mobile + shared moved here (`mobile/`, `packages/shared`); web app superseded by `deploy/` |

## What was merged — append

9. **Mobile app + shared package** (Sep 2026) — `app/apps/mobile` → `mobile/`,
   `app/packages/shared` → `packages/shared` via `git subtree` (history kept).
   Root `package.json` now declares npm workspaces. New workflows:
   `mobile-ci.yml`, `eas-preview.yml`, `eas-update.yml`. Vercel Ignored Build
   Step skips site deploys for mobile-only commits.

## Next consolidation steps — replace the list

1. **Vercel dashboard** — delete `protein-outfitters-app`, `protein-outfitters-app1`,
   `protein-outfitters-design-ycmd`. Note: the host redirects in `deploy/vercel.json`
   only fire for requests that reach the `protein-outfitters-design` project, so
   `protein-outfitters-app1.vercel.app` keeps serving the old Next.js site until
   its project is deleted or re-pointed.
2. **Archive `protein-outfitters-app`** on GitHub (read-only) after the first
   successful EAS preview build from this repo. Remove its EAS workflows first.
3. **Saved favorites** — wire account page to persisted farm/processor follows.
4. **Clean up** — the ~55 `audit-*.md` + `audit-state.json` files at the root of
   `protein-outfitters-app` audit *this* site; move the state file here or drop them.
