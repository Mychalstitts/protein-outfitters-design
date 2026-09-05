# Mobile move: `protein-outfitters-app` → `protein-outfitters-design`

> **Status (2026-09-05):** Nested source **landed**. Expo app + `@protein-outfitters/shared`
> live under `mobile/` (copied from private `protein-outfitters-app` @ `d212c9f`).
> Flat scaffold placeholders (`mobile/` as single Expo package + root `packages/shared`)
> were removed. Root scripts/`Mobile CI`/`EAS` workflows target the nested layout.
>
> **Supersedes** draft PR #28 (docs-only rsync runbook) — the move itself is in this
> branch / PR. Cloud Agents cannot re-run `move-source.sh` against the private app
> repo; keep `EXPO_TOKEN` as a user Actions secret.

## Landed layout

```
protein-outfitters-design/
├── deploy/                      ← static site + API (Vercel root, unchanged)
├── supabase/                    ← migrations, functions, seed (canonical)
├── mobile/                      ← nested npm workspace (from app/app)
│   ├── apps/mobile/             ← Expo / EAS (was app/apps/mobile)
│   ├── packages/shared/         ← @protein-outfitters/shared
│   ├── scripts/ docs/ …
│   ├── package.json             ← workspaces: apps/*, packages/*
│   └── package-lock.json        ← committed for npm ci
├── docs/mobile/                 ← this runbook (+ CONSOLIDATION notes)
├── scripts/mobile/              ← design-repo helpers (bundle-data → nested paths)
├── move-source.sh               ← one-shot rsync importer (historical / FORCE re-copy)
└── package.json                 ← NO Expo workspaces; `npm run … --prefix mobile`
```

The web app (`app/apps/web`) was **not** moved — `deploy/` is canonical.

## Day-to-day (after merge)

```bash
cd mobile
nvm use                 # mobile/.nvmrc → Node 20.10+
npm ci                  # or npm install
cp apps/mobile/.env.example apps/mobile/.env   # fill anon + Maps keys
npm run mobile          # expo start
npm run typecheck
npm run shared:test
```

From the design-repo root:

```bash
npm run mobile
npm run typecheck
npm run shared:test
npm run mobile:bundle-data   # supabase/seed → mobile/apps/mobile/src/data/
```

EAS (needs `eas login` + project secrets):

```bash
cd mobile/apps/mobile
npx eas build --profile preview --platform ios
```

Preview CI: label a PR `mobile-build` (requires `EXPO_TOKEN` Actions secret).

## How the source got here

Preferred path was **rsync** via [`move-source.sh`](../../move-source.sh)
(wrapper: [`scripts/mobile/move-source.sh`](../../scripts/mobile/move-source.sh)):
copy `APP/app/{apps/mobile,packages/shared,scripts,docs,…}` → `DESIGN/mobile/`
so Metro/`tsconfig` relative paths keep working without a flat remount.

Alternate (history-preserving): `git subtree` split of `app/apps/mobile` and
`app/packages/shared` — see older revisions of this doc / scaffold PR #26.
Subtree fights existing placeholder dirs; the Mac run used the nested rsync layout.

**Hand edits applied after copy:**

1. `mobile/apps/mobile/app.config.js` — injects `GOOGLE_MAPS_ANDROID_KEY` from env.
2. Literal Maps key stripped from `app.json` (rotate + restrict in Google Cloud if it
   ever lived in app-repo history).
3. Env examples at `mobile/.env.example` and `mobile/apps/mobile/.env.example`.
4. Root package.json / GitHub workflows retargeted to nested paths.

## One-time settings outside git

**GitHub → Settings → Secrets → Actions**

- `EXPO_TOKEN` — expo.dev → Account Settings → Access Tokens (EAS preview/update workflows).

**Vercel → protein-outfitters-design → Ignored Build Step**

- `bash scripts/vercel-ignore-build.sh` (relative to Root Directory `deploy/`).

**Expo / EAS** (from `mobile/apps/mobile`, once):

- `eas secret:create` for `GOOGLE_MAPS_ANDROID_KEY`, `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Project ID / owner in `app.json` carry over — no new `eas init` required.
- `eas device:create` before first real-device `preview` build if using internal distro.

## Retire the app repo

After one successful EAS preview from **this** repo:

1. Delete EAS workflows in `protein-outfitters-app` so nobody OTAs from the archive.
2. GitHub → Archive `protein-outfitters-app`.
3. Delete or keep-paused Vercel projects `protein-outfitters-app`,
   `protein-outfitters-app1`, `protein-outfitters-design-ycmd`.

## Gotchas

- **Root `npm install` no longer installs Expo.** Work inside `mobile/` (or use
  root convenience scripts that `--prefix mobile`).
- **Vercel is unaffected** — Root Directory remains `deploy/`.
- **Commit `mobile/package-lock.json`** — Mobile CI and EAS use `npm ci` there.
- **EAS uploads the git tree** — `deploy/` is small enough; add `.easignore` only if needed.
- **Mac `main` tracking the wrong remote branch:** if local `main` was pointed at
  `origin/feat/mobile-workspace-from-app` during the move, after this PR merges run:
  `git fetch && git checkout main && git branch -u origin/main`.

## Optional not-moved inventory

Still only in the private app repo (not required for Expo):

- App-root `DEPLOY.md` / `SHIPPED.md`
- `processor_import/`, app-root `data/`
- Map HTML prototypes under the app repo
- `apps/web` (replaced by `deploy/`)
