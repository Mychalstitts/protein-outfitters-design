# Mobile move: `protein-outfitters-app` → `protein-outfitters-design`

## Preferred: `move-source.sh` (rsync) — 2026-09-05

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

**Not copied (by design):**
- `apps/web` — design `deploy/` is canonical
- full `supabase/` — only adds `supabase/functions/README.md` if missing
  (migrations/functions were already identical)
- `node_modules`, `.expo`, native `ios/`/`android/`, lockfiles (regenerate)

**Also not copied (app-repo extras — optional follow-up if you want them):**
- Root docs: `DEPLOY.md`, `SHIPPED.md`, `processor-directory-plan.md`,
  `friesla-pricing-reference.md`
- `processor_import/`, `data/`, `protein_outfitters_map_system.html`

**Nested layout (kept on purpose):** `mobile/apps/mobile` rather than flattening
to root `mobile/`. Flattening would require editing `metro.config.js`, both
`tsconfig.json`s, and workspace globs. Flat layout remains available via the
git-subtree alternate below if you prefer it later.

Requires a machine that can read private `protein-outfitters-app`. This Cloud
Agent cannot. Expected app HEAD when first cloned for the move: `d212c9f`
(“Fix shared package typecheck so CI tests run”).

```bash
# Prefer the copy in the design repo (or ~/code/move-source.sh if that’s where you saved it)
APP=~/code/protein-outfitters-app \
DESIGN=~/code/protein-outfitters-design \
FORCE=1 bash ~/code/protein-outfitters-design/move-source.sh
# FORCE=1 required after PR #26 scaffold (DESIGN/mobile already exists)
# --dry-run — preview only
```

Same entrypoint: `scripts/mobile/move-source.sh` (wrapper → root script).

### Verify the copy landed (Mac)

Connection can drop mid-run. On the Mac:

```bash
# Nested source present?
ls ~/code/protein-outfitters-design/mobile/apps/mobile
ls ~/code/protein-outfitters-design/mobile/packages/shared

# Or re-run without FORCE — if it says mobile/ already exists, the first run landed
APP=~/code/protein-outfitters-app \
DESIGN=~/code/protein-outfitters-design \
bash ~/code/protein-outfitters-design/move-source.sh
```

If `mobile/` is still the flat scaffold (only `app.config.js` / `eas.json` /
`package.json` at `mobile/` root, no `apps/`), re-run with `FORCE=1`.
Clear a stale `DESIGN/.git/index.lock` if a sandboxed dry-run left one behind.

### After a successful copy

1. Remove the **flat** scaffold leftovers that PR #26 put at the repo root
   (source now lives under `mobile/`):
   ```bash
   # only if still present and empty of real source
   rm -rf packages/shared
   ```
2. Install and typecheck inside the nested workspace:
   ```bash
   cd ~/code/protein-outfitters-design/mobile && nvm use && npm install && npm run typecheck
   ```
3. Update CI / EAS paths if still assuming root `mobile/` = Expo app and
   root `packages/shared`:
   - `.github/workflows/mobile-ci.yml` → `working-directory: mobile`,
     workspaces `apps/mobile` / `packages/shared`
   - `.github/workflows/eas-preview.yml` / `eas-update.yml` →
     `mobile/apps/mobile`
4. Strip any literal Google Maps key from `mobile/apps/mobile/app.json`;
   rotate the key (it is in app-repo history). Prefer env / EAS secrets.
5. Commit from design repo, e.g.:
   ```bash
   git -C ~/code/protein-outfitters-design add mobile supabase/functions/README.md
   git -C ~/code/protein-outfitters-design commit -m "feat(mobile): move workspace from protein-outfitters-app"
   ```

Nothing is deleted from the app repo and the script does **not** commit.
Until that commit is pushed, GitHub still shows only the PR #26 scaffold.

---

## Alternate: git subtree (flat `mobile/` + `packages/shared/`)

Use this if you need history grafted at the **repo root** as `mobile/` and
`packages/shared/` (PR #26 scaffold layout) instead of nested
`mobile/apps/…`.

Moves `app/apps/mobile` and `app/packages/shared` into the canonical repo as
`mobile/` and `packages/shared/`, per older consolidation notes. The static
site in `deploy/` is not touched; Vercel keeps deploying it exactly as today.

Target layout (subtree / scaffold):

```
protein-outfitters-design/
├── deploy/                 ← static site + serverless API (unchanged, Vercel root)
├── supabase/               ← already here (migrations, functions, seed)
├── mobile/                 ← Expo app at root (was app/apps/mobile)
├── packages/shared/        ← was app/packages/shared
├── scripts/mobile/         ← bundle-data.mjs, build-icons.mjs
├── docs/mobile/            ← app-store-readiness, reviewer-notes, store-listing-copy
├── package.json            ← workspaces: ["mobile", "packages/*"]
├── package-lock.json
├── tsconfig.base.json
├── .nvmrc
└── .github/workflows/      ← mobile-ci.yml, eas-preview.yml, eas-update.yml
```

The web app (`app/apps/web`) is deliberately **not** moved — the design repo
replaced it. Its shared-package consumers become `mobile/` only.

### 0. Before you start (subtree)

- Merge or close **PR #3** in `protein-outfitters-app` first so the subtree
  split carries the real-device `preview` profile. (`mobile/eas.json` in the
  scaffold already matches PR #3, so either way you end up in the same place.)
- Have both repos cloned side by side:
  `~/code/protein-outfitters-app` and `~/code/protein-outfitters-design`.
- `git subtree` ships with git ≥ 1.7.11; `git subtree --help` should work.

### 1. Split the two directories out of the app repo (keeps history)

```bash
cd ~/code/protein-outfitters-app
git checkout main && git pull

git subtree split --prefix=app/apps/mobile    -b split/mobile
git subtree split --prefix=app/packages/shared -b split/shared
```

### 2. Graft them into the design repo

```bash
cd ~/code/protein-outfitters-design
git checkout main && git pull
git checkout -b feat/mobile-workspace

git remote add app ../protein-outfitters-app
git fetch app

git subtree add --prefix=mobile          app split/mobile
git subtree add --prefix=packages/shared app split/shared
```

Then copy the pieces that aren't in either subtree:

```bash
A=../protein-outfitters-app/app
mkdir -p scripts/mobile docs/mobile
cp $A/scripts/build-icons.mjs        scripts/mobile/
cp $A/docs/app-store-readiness.md    docs/mobile/
cp $A/docs/reviewer-notes.md         docs/mobile/
cp $A/docs/store-listing-copy.md     docs/mobile/
cp $A/docs/setup-guide.md            docs/mobile/
```

### 3. Drop in / keep the scaffold overlays

PR #26 already landed workspaces, Metro/tsconfig, EAS overlays, and workflows.
After subtree, re-apply path fixes if needed:

| File | What changed |
|---|---|
| `package.json` | `workspaces: ["mobile", "packages/*"]`, mobile/shared scripts |
| `mobile/tsconfig.json` | `extends` / `paths` one level up |
| `mobile/metro.config.js` | `workspaceRoot = '..'`; ignore `deploy/`, `supabase/`, `test/` |
| `mobile/app.config.js` | injects `GOOGLE_MAPS_ANDROID_KEY` from env |
| `mobile/.env.example` | `EXPO_PUBLIC_*` in the app dir |
| `.github/workflows/*` | path-filtered Mobile CI + EAS |

### 4. Hand edits after the copy

1. **`mobile/app.json`** — delete the literal Google Maps key; rotate in Google Cloud.
2. **`scripts/mobile/build-icons.mjs`** — paths: `mobile/assets/source` (drop web output).
3. Docs: `app/apps/mobile` → `mobile`, `app/packages/shared` → `packages/shared`.
4. Update `CONSOLIDATION.md` / root `README` mobile section if needed.

### 5. Install, verify locally

```bash
npm install
npm run shared:test
npm run typecheck
npm run mobile:bundle-data
cd mobile && npx expo-doctor
cp .env.example .env && npx expo start
```

### 6. Commit + PR

```bash
git add -A
git commit -m "feat(mobile): move Expo app + shared package in from protein-outfitters-app"
git push -u origin feat/mobile-workspace
```

### 7. One-time settings outside git

**GitHub → protein-outfitters-design → Settings → Secrets → Actions**
- `EXPO_TOKEN` — required by `eas-preview.yml` and `eas-update.yml`.

**Vercel → protein-outfitters-design → Settings → Git → Ignored Build Step**
- Command: `bash scripts/vercel-ignore-build.sh` (Root Directory `deploy/`).

**Expo / EAS** (from the Expo app dir, with `eas login`)
- Create secrets: `GOOGLE_MAPS_ANDROID_KEY`, `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Project ID / owner in `app.json` carry over — no new `eas init` needed.
- `eas device:create` before first real-device `preview` build.

### 8. Retire the app repo

After merge + one EAS preview from the design repo:

1. Delete EAS workflows in `protein-outfitters-app`.
2. GitHub-archive `protein-outfitters-app`.
3. Delete paused Vercel projects when ready (`app`, `app1`, `ycmd`, `3nci`
   were paused 2026-09-05 → 503).

### Gotchas (subtree / root workspaces)

- Root `npm install` installs Expo/RN; static CI can use
  `npm install --workspaces=false`.
- Vercel Root Directory stays `deploy/` — unaffected.
- Commit the root lockfile for `npm ci` / EAS.
- EAS uploads the whole git tree; add `.easignore` only if `deploy/` bloats.
