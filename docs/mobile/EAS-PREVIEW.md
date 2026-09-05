# First EAS preview from this repo

**Goal:** ship an internal preview binary with **no product-code changes**. The app
boots on bundled processor data (`mobile/apps/mobile/src/data/processors.bundled.json`).

## Paths (on `main` after PR #29)

| Item | Value |
|------|--------|
| Workspace | `mobile/` (npm workspaces) |
| Expo app | `mobile/apps/mobile/` |
| EAS config | `mobile/apps/mobile/eas.json` (`preview` profile, internal + iOS simulator) |
| Project ID | `e2976642-b0da-43b5-b85f-138c93665c8d` |
| Owner / slug | `mychalstitts` / `protein-outfitters` |
| Workflow | `.github/workflows/eas-preview.yml` |
| CI Node | **22** in EAS workflows only (`eas-cli@latest` needs ≥22). App `.nvmrc` stays **20** for Expo SDK 51. |

## Secrets (two places)

| Where | Name | Used by |
|-------|------|---------|
| Cursor Cloud Agents environment | `EXPO_TOKEN` | Agent-side `eas` CLI |
| GitHub → Settings → Secrets → Actions | `EXPO_TOKEN` | `eas-preview.yml`, `eas-update.yml` |

Cursor secrets do **not** inject into GitHub Actions. Create the token at
[expo.dev → Access Tokens](https://expo.dev/accounts/[account]/settings/access-tokens).

## Trigger (CI)

1. Ensure the Actions secret is set.
2. Ensure the `mobile-build` label exists on the repo (create once if missing).
3. Open a PR that includes this tree (or any PR) and add label **`mobile-build`**.
4. Workflow runs `eas build --profile preview --platform {ios,android} --non-interactive --no-wait` from `mobile/apps/mobile`.

## Trigger (local / Cloud Agent)

```bash
cd mobile && npm ci
cd apps/mobile
# EXPO_TOKEN must be in the environment
npx eas build --profile preview --platform android --non-interactive --no-wait
# iOS simulator preview is configured in eas.json; device builds need credentials later
```

## After the first green build

- Install from the Expo/EAS build page (internal distribution).
- Confirm map/list UI loads from bundled data (no live API required).
- Then proceed with API-swap work ([API-SWAP.md](./API-SWAP.md)); archive the old app repo when ready.
