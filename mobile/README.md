# Mobile (Expo)

Workspace shell for the Protein Outfitters iOS/Android app.

**Status:** config + EAS/CI overlays are in place; **app source is not** in this
repo yet. Transplant it from private `protein-outfitters-app` with
`git subtree` — full steps in [`docs/mobile/MIGRATE.md`](../docs/mobile/MIGRATE.md).

Once source lands:

```bash
npm install
cp mobile/.env.example mobile/.env   # fill anon key + Maps key
npm run mobile
```

Preview builds: label a PR `mobile-build` (needs `EXPO_TOKEN` Actions secret).
