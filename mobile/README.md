# Protein Outfitters — mobile workspace

Moved here from `Mychalstitts/protein-outfitters-app` (`app/`, commit `d212c9f`)
by `move-source.sh`. The web app (`apps/web`) was **not** moved — the static
site + API in `../deploy/` is canonical.

```
mobile/
├── apps/mobile/       Expo / EAS app
├── packages/shared/   @protein-outfitters/shared
├── scripts/           bundle-data, build-icons, seed, check-env
└── docs/              store readiness, privacy, terms, …
```

```bash
cd mobile
nvm use                 # .nvmrc → Node 20+
npm install
cp apps/mobile/.env.example apps/mobile/.env   # fill anon + Maps keys
npm run mobile          # expo start
npm run typecheck
npm run shared:test
```

EAS builds/updates run from `apps/mobile`:

```bash
npm run build:preview --workspace apps/mobile
```

Preview CI: label a PR `mobile-build` (needs `EXPO_TOKEN` **Actions** secret —
Cursor Cloud secrets do not feed GitHub Actions). First preview boots on bundled
data; see [`docs/mobile/EAS-PREVIEW.md`](../docs/mobile/EAS-PREVIEW.md).

See [`docs/mobile/MIGRATE.md`](../docs/mobile/MIGRATE.md) and
[`CONSOLIDATION.md`](../CONSOLIDATION.md).
