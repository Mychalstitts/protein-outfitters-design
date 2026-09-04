# Mobile move: `protein-outfitters-app` → `protein-outfitters-design`

Moves `app/apps/mobile` and `app/packages/shared` into the canonical repo as
`mobile/` and `packages/shared/`, per `CONSOLIDATION.md` next-step #2.
History is preserved with `git subtree`. The static site in `deploy/` is not
touched; Vercel keeps deploying it exactly as today.

Target layout:

```
protein-outfitters-design/
├── deploy/                 ← static site + serverless API (unchanged, Vercel root)
├── supabase/               ← already here (migrations, functions, seed)
├── mobile/                 ← NEW  (was app/apps/mobile)
├── packages/shared/        ← NEW  (was app/packages/shared)
├── scripts/mobile/         ← NEW  bundle-data.mjs, build-icons.mjs
├── docs/mobile/            ← NEW  app-store-readiness, reviewer-notes, store-listing-copy
├── package.json            ← UPDATED: adds npm workspaces
├── package-lock.json       ← NEW, now committed
├── tsconfig.base.json      ← NEW
├── .nvmrc                  ← NEW (20)
└── .github/workflows/      ← + mobile-ci.yml, eas-preview.yml, eas-update.yml
```

The web app (`app/apps/web`) is deliberately **not** moved — the design repo
replaced it. Its shared-package consumers become `mobile/` only.

---

## 0. Before you start

- Merge or close **PR #3** in `protein-outfitters-app` first so the subtree
  split carries the real-device `preview` profile. (`mobile/eas.json` in this
  drop-in already matches PR #3, so either way you end up in the same place.)
- Have both repos cloned side by side:
  `~/code/protein-outfitters-app` and `~/code/protein-outfitters-design`.
- `git subtree` ships with git ≥ 1.7.11; `git subtree --help` should work.

## 1. Split the two directories out of the app repo (keeps history)

```bash
cd ~/code/protein-outfitters-app
git checkout main && git pull

git subtree split --prefix=app/apps/mobile    -b split/mobile
git subtree split --prefix=app/packages/shared -b split/shared
```

## 2. Graft them into the design repo

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

## 3. Drop in the files from this bundle

Copy everything in this bundle over the repo root, **overwriting**:

| File | What changed |
|---|---|
| `package.json` | adds `workspaces: ["mobile", "packages/*"]`, mobile/shared scripts, `typescript` devDep, `engines`. Existing lint/test scripts kept verbatim. |
| `.gitignore` | stops ignoring the **root** `package-lock.json` (needed by `npm ci` in CI and by EAS); nested lockfiles still ignored so `deploy/` is unchanged on Vercel. Adds the mobile/native ignores from the app repo. |
| `tsconfig.base.json` | copied from app repo, unchanged |
| `.nvmrc` | `20` |
| `mobile/tsconfig.json` | `extends` and `paths` go up **one** level instead of two |
| `mobile/metro.config.js` | `workspaceRoot = '..'`; blocks Metro from crawling `deploy/`, `supabase/`, `test/` |
| `mobile/eas.json` | PR #3 version (real-device `preview`, `preview-simulator` extends it) |
| `mobile/app.config.js` | **new** — injects `GOOGLE_MAPS_ANDROID_KEY` from env so the key can come out of `app.json` |
| `mobile/.env.example` | **new** — `EXPO_PUBLIC_*` vars live in `mobile/`, not the repo root (Expo only reads `.env` from the app dir) |
| `packages/shared/tsconfig.json` | unchanged (same depth as before) — included so nothing is missed |
| `scripts/mobile/bundle-data.mjs` | reads `supabase/seed/processors.bundled.json` (already in this repo) → writes `mobile/src/data/` |
| `deploy/scripts/vercel-ignore-build.sh` | **new** — Vercel Ignored Build Step so mobile-only commits don't redeploy the site |
| `.github/workflows/mobile-ci.yml` | port of app repo `ci.yml` minus the web job; path-filtered |
| `.github/workflows/eas-preview.yml` | paths updated (`mobile/`, root lockfile) |
| `.github/workflows/eas-update.yml` | paths updated |

## 4. Hand edits after the copy

1. **`mobile/app.json`** — delete the literal Google Maps key:
   ```jsonc
   "config": { "googleMaps": { "apiKey": "AIza…" } }   // ← remove the whole "config" block
   ```
   `app.config.js` now supplies it. Then rotate the key in Google Cloud (it's
   in git history in the app repo) and restrict the new one to
   `com.proteinoutfitters.app` + your SHA-1.
2. **`scripts/mobile/build-icons.mjs`** — it was written for `app/apps/mobile/assets/source`
   and `app/apps/web/public`. Point the mobile paths at `mobile/assets/source`
   and delete the web output (the design site has its own icons in `deploy/`).
3. **`docs/mobile/app-store-readiness.md`** — search/replace `app/apps/mobile` → `mobile`,
   `app/docs/` → `docs/mobile/`, `app/packages/shared` → `packages/shared`.
4. **`mobile/README`** links, if any, that reference `../../`.
5. **`CONSOLIDATION.md`** — apply `CONSOLIDATION.patch.md` from this bundle.
6. **`README.md`** — add the "Mobile" section from `README.snippet.md`.

## 5. Install, verify locally

```bash
npm install                       # generates root package-lock.json — commit it
npm run shared:test               # vitest, should match the app repo (green as of d212c9f)
npm run typecheck                 # shared + mobile
npm run mobile:bundle-data        # regenerates mobile/src/data/processors.bundled.json
cd mobile && npx expo-doctor      # config sanity
cp .env.example .env && npx expo start   # smoke test in Expo Go / simulator
```

If `expo start` can't resolve `@protein-outfitters/shared`, run
`npx expo start --clear` once — Metro caches the old watchFolders.

## 6. Commit + PR

```bash
git add -A
git commit -m "feat(mobile): move Expo app + shared package in from protein-outfitters-app"
git push -u origin feat/mobile-workspace
```

Open the PR **without** the `auto-merge` label (the existing auto-merge
workflow squashes labeled PRs on green checks — you want to eyeball this one).
Expect `Static checks` (existing) and `Mobile CI` (new) to both run.

## 7. One-time settings outside git

**GitHub → protein-outfitters-design → Settings → Secrets → Actions**
- `EXPO_TOKEN` — expo.dev → Account Settings → Access Tokens. Required by
  `eas-preview.yml` and `eas-update.yml`. (The app repo never had this set.)

**Vercel → protein-outfitters-design → Settings → Git → Ignored Build Step**
- Command: `bash scripts/vercel-ignore-build.sh` (relative to Root Directory `deploy/`).
- Without this, every mobile commit rebuilds and redeploys www. Harmless but noisy.

**Expo / EAS** (run from `mobile/`, once, with `eas login`)
- `eas secret:create --scope project --name GOOGLE_MAPS_ANDROID_KEY --value <new key>`
- `eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://unybunaqyqrxhfyhvhfo.supabase.co`
- `eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key>`
- The EAS project ID (`e2976642-…`) and `owner: mychalstitts` in `app.json`
  carry over unchanged — no `eas init` needed. `eas build:configure` will
  notice the new repo path and should be a no-op.
- `eas device:create` to register test iPhones before the first real-device
  `preview` build.

## 8. Retire the app repo (CONSOLIDATION next-step #3)

After the PR merges and one EAS preview build succeeds from the new repo:

1. In `protein-outfitters-app`, delete `.github/workflows/eas-preview.yml` and
   `eas-update.yml` so nobody can accidentally OTA from the archived copy.
2. GitHub → protein-outfitters-app → Settings → **Archive this repository**.
3. Vercel dashboard → delete projects `protein-outfitters-app`,
   `protein-outfitters-app1`, `protein-outfitters-design-ycmd` (or point them
   at redirect-only). This is the only thing that actually stops
   `protein-outfitters-app1.vercel.app` from serving the old Next.js site —
   the host redirects in `deploy/vercel.json` never see those requests.

## Gotchas

- **`npm install` at the repo root now installs Expo/RN.** The existing
  `Static checks` workflow does `npm install` on every push; it'll get ~1 min
  slower. If that matters, change its install step to
  `npm install --workspaces=false` (root deps only).
- **Vercel is unaffected** by the root `package.json`: Root Directory is
  `deploy/`, which has its own `package.json`. Do not add the root lockfile to
  `deploy/`.
- **`.gitignore` root-lockfile rule** — the app repo committed its lockfile;
  the design repo ignored it. `npm ci` (CI + EAS) hard-fails without one, so
  the root lockfile must be committed. Nested ones stay ignored.
- **EAS uploads the whole git tree.** `deploy/` is small (HTML + serverless
  JS), so this is fine. If it ever bloats, add a root `.easignore`.
- **`supabase-client.test.ts`** relies on the safe-proxy stub; it passes with
  no env set, so CI needs no secrets for `shared:test`.
