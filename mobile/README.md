# Protein Outfitters — mobile workspace

Moved here from `Mychalstitts/protein-outfitters-app` (`app/`, commit `d212c9f`)
on 2026-09-04 by `move-source.sh`. The web app (`apps/web`) was **not**
moved — the static site + API in `../deploy/` is canonical.

```
cd mobile
nvm use            # .nvmrc → Node 20.10.0
npm install        # workspaces: apps/mobile, packages/shared
npm run mobile     # expo start
npm run typecheck  # tsc --build across workspaces
```

EAS builds/updates run from `apps/mobile` (`npm run build:preview --workspace apps/mobile`).
Copy `.env.example` → `.env` with the Supabase values from `../supabase/.env.example`.

See `../CONSOLIDATION.md` for the full consolidation map.
