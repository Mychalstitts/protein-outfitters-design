# App Store path — remaining human + ops checklist

Code on `cursor/mobile-app-store-path-8023` covers Neon map/detail, auth bridge, claim, and account delete. The items below **cannot** be finished by an agent alone.

## Blockers (humans)

| Item | Why |
|------|-----|
| Apple Developer Program ($99/yr) | Required for TestFlight / App Store |
| App Store Connect app record + Bundle ID | `com.proteinoutfitters.app` |
| Fill `eas.json` → `submit.production.ios` | Replace `REPLACE_WITH_APPLE_ID`, `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`, `REPLACE_WITH_APPLE_TEAM_ID` |
| Play Console + service account JSON | Android submit (`play-store-service-account.json`, not committed) |
| Hosted privacy + terms URLs | Reviewers expect https pages (in-app legal also ships) |
| Device QA | Sign-in, claim, delete-account, airplane-mode map on real hardware |
| Screenshots / listing copy | Use drafts in `mobile/docs/store-listing-copy.md` + `reviewer-notes.md` |

## Already in repo (code / assets)

- ✅ EAS project id in `app.json` / updates URL
- ✅ Icon / splash / adaptive PNGs under `mobile/apps/mobile/assets/` (regenerate via `cd mobile && npm run build:icons` after `npm i -D sharp`)
- ✅ `eas.json` submit placeholders for iOS + Android track
- ✅ Account deletion in-app → `POST /api/account-delete`
- ✅ Sign in with Apple → `POST /api/auth/apple` (Neon session)
- ✅ Magic link → Neon + SecureStore Bearer
- ✅ Map offline via bundled JSON; live upgrade via `/api/map-data`

## Trigger preview build

See [EAS-PREVIEW.md](./EAS-PREVIEW.md). Needs `EXPO_TOKEN` (Cursor env and/or GitHub Actions secret) + `mobile-build` label on a PR.

```bash
cd mobile/apps/mobile
npx eas build --profile preview --platform android --non-interactive --no-wait
```

## Related PRs

- This branch supersedes the implementation of draft **PR #32** (map/detail API). Prefer merging this App Store path PR and closing #32 as duplicate once reviewed.
- Draft **PR #30** remains the mapping doc (`API-SWAP.md`); keep for history or merge docs-only.
