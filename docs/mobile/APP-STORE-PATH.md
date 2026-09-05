# App Store path — remaining human + ops checklist

**Code status (on `main`):** Neon map/detail (#36), auth bridge / claim / Apple / account-delete (#36), processor-requests (#37 → landed on `main`). Items below **cannot** be finished by an agent alone.

## Blockers (humans)

| Item | Why |
|------|-----|
| Apple Developer Program ($99/yr) | Required for TestFlight / App Store |
| App Store Connect app record + Bundle ID | `com.proteinoutfitters.app` |
| Fill `eas.json` → `submit.production.ios` | Replace `REPLACE_WITH_APPLE_ID`, `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`, `REPLACE_WITH_APPLE_TEAM_ID` — **do not invent fake ASC IDs**; leave placeholders until the ASC app exists |
| Play Console + service account JSON | Android submit (`play-store-service-account.json`, not committed) |
| Hosted privacy + terms URLs | Reviewers expect https pages (in-app legal also ships) |
| Device QA | Sign-in, claim, delete-account, airplane-mode map, processor request on real hardware |
| Screenshots / listing copy | Use drafts in `mobile/docs/store-listing-copy.md` + `reviewer-notes.md` |
| Universal / App Links host files | Copy `.example` → live files under `deploy/.well-known/` with real Team ID + Play SHA-256 (see below) |

## Already in repo (code / assets)

- ✅ EAS project id in `app.json` / updates URL
- ✅ Icon / splash / adaptive PNGs under `mobile/apps/mobile/assets/` (regenerate via `cd mobile && npm run build:icons` after `npm i -D sharp`)
- ✅ Icons script: `mobile/scripts/build-icons.mjs` (`npm run build:icons` in `mobile/`)
- ✅ `eas.json` submit placeholders for iOS + Android track (no fake ASC values)
- ✅ Account deletion in-app → `POST /api/account-delete`
- ✅ Sign in with Apple → `POST /api/auth/apple` (Neon session); Expo entitlement via `ios.usesAppleSignIn` + `expo-apple-authentication` plugin
- ✅ Magic link → Neon + SecureStore Bearer (`proteinoutfitters://auth/callback`)
- ✅ Map offline via bundled JSON; live upgrade via `/api/map-data`
- ✅ Processor requests → `POST /api/processor-requests` (Bearer)
- ✅ Associated domains / Android intent filters for `proteinoutfitters.com` **and** `www.proteinoutfitters.com`

## Sign in with Apple (entitlement / portal)

In-app + Expo config are done. Before a device/TestFlight build that uses SIWA:

1. Apple Developer → Identifiers → App ID `com.proteinoutfitters.app` → enable **Sign in with Apple**.
2. EAS credentials / provisioning profile must include the Sign in with Apple entitlement (Expo sets this when `ios.usesAppleSignIn` is true and the capability is on the App ID).
3. Native audience is the **Bundle ID** (not a Services ID). Web magic-link remains separate (`/api/auth/*`).
4. Do **not** put fabricated Team / ASC IDs into `eas.json` — only real values from App Store Connect after the app record exists.

## Deep links / associated domains

| Layer | Status |
|-------|--------|
| Custom scheme `proteinoutfitters://` | ✅ Used for magic-link callback |
| `ios.associatedDomains` | ✅ `applinks:proteinoutfitters.com` + `applinks:www.proteinoutfitters.com` |
| Android `intentFilters` (https, autoVerify) | ✅ Both apex + `www` hosts |
| Hosted AASA / Digital Asset Links | 🔴 Human — templates only |

When you have a real Apple Team ID and (for Android) the Play App Signing SHA-256:

```bash
# From repo root — fill REPLACE_* then rename (no .example suffix)
cp deploy/.well-known/apple-app-site-association.example \
   deploy/.well-known/apple-app-site-association
cp deploy/.well-known/assetlinks.json.example \
   deploy/.well-known/assetlinks.json
# Edit REPLACE_WITH_APPLE_TEAM_ID / REPLACE_WITH_PLAY_APP_SIGNING_SHA256
```

AASA must be served from `https://www.proteinoutfitters.com/.well-known/apple-app-site-association` (and ideally the apex host too) with `Content-Type: application/json` and **no** redirects that strip the path. `vercel.json` already has a header rule for that path once the file exists.

## Trigger preview build

See [EAS-PREVIEW.md](./EAS-PREVIEW.md). Needs `EXPO_TOKEN` (Cursor env and/or GitHub Actions secret) + **`mobile-build` label** on a PR (label already exists on the repo).

```bash
cd mobile/apps/mobile
npx eas build --profile preview --platform android --non-interactive --no-wait
```

Post-merge: open any PR that touches mobile (or this polish PR) and add label `mobile-build` to kick `.github/workflows/eas-preview.yml`.

## Related PRs

- ✅ **#36** merged to `main` — App Store path (Neon auth, claim, map/detail API, including `9eea2bf` synthetic-slug cache port).
- ✅ **#32** closed — superseded by #36 (same map/detail work + cache fix).
- ✅ **#37** / processor-requests — Slice F on `main` (`POST /api/processor-requests`).
- Draft **PR #30** remains the mapping doc (`API-SWAP.md`); keep for history or merge docs-only.
