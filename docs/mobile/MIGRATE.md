# Mobile move: `protein-outfitters-app` → `protein-outfitters-design`

## Status — 2026-09-05

**Nested source is in this repo** under `mobile/` (from app commit `d212c9f`,
branch `feat/mobile-workspace-from-app`). Flat PR #26 scaffold removed.
CI/EAS paths retargeted to `mobile/` + `mobile/apps/mobile`.

**Still open:** merge to `main`, add `EXPO_TOKEN`, first EAS preview, then
archive `protein-outfitters-app`.

---

## Preferred: `move-source.sh` (rsync)

Copies the app monorepo’s mobile workspace into **`DESIGN/mobile/`** as a
self-contained npm workspace (same relative paths as `APP/app/`):

```
DESIGN/mobile/
├── apps/mobile/       ← Expo / EAS (from APP/app/apps/mobile)
├── packages/shared/   ← @protein-outfitters/shared
├── scripts/           ← build-icons, bundle-data, seed, check-env
├── docs/              ← store readiness, privacy, terms, …
├── package.json       ← workspaces root (web scripts dropped)
├── tsconfig.base.json, .nvmrc, .env.example, .gitignore
└── README.md
```

**Not copied (by design):** `apps/web`, full `supabase/` (only
`supabase/functions/README.md` if missing), `node_modules`, `.expo`,
native `ios/`/`android/`, lockfiles.

**Also not copied (optional follow-up):** app-root `DEPLOY.md` / `SHIPPED.md` /
`processor_import/` / `data/` / map HTML.

**Nested layout kept on purpose** so Metro / tsconfig / workspace globs need
no edits. Flattening is a separate follow-up if you want it.

```bash
APP=~/code/protein-outfitters-app \
DESIGN=~/code/protein-outfitters-design \
FORCE=1 bash move-source.sh   # or ~/code/move-source.sh
# --dry-run to preview
```

Then:

```bash
cd ~/code/protein-outfitters-design/mobile
nvm use || true
npm install && npm run typecheck
```

Strip any literal Maps key from `apps/mobile/app.json` (use `app.config.js` +
`GOOGLE_MAPS_ANDROID_KEY`). Commit from the design repo.

### Mac tracking note

If `git push` set your local `main` to track `origin/feat/mobile-workspace-from-app`:

```bash
git fetch origin
git checkout main
git reset --hard origin/main
git branch -u origin/main main
```

---

## Alternate: git subtree (flat `mobile/` + `packages/shared/`)

Use only if you need history grafted as root `mobile/` + `packages/shared/`
(PR #26 layout). Prefer the rsync path above for the nested workspace that
already landed.

```bash
cd ~/code/protein-outfitters-app
git subtree split --prefix=app/apps/mobile -b split/mobile
git subtree split --prefix=app/packages/shared -b split/shared

cd ~/code/protein-outfitters-design
git subtree add --prefix=mobile app split/mobile
git subtree add --prefix=packages/shared app split/shared
```

---

## After merge to main

1. GitHub → Settings → Secrets → Actions → `EXPO_TOKEN`
2. EAS secrets: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
   `GOOGLE_MAPS_ANDROID_KEY` (rotated)
3. Label a PR `mobile-build` or run EAS Update workflow
4. Archive `protein-outfitters-app` after first successful preview; delete its
   EAS workflows first
5. Vercel: enable Ignored Build Step; delete paused projects when ready
