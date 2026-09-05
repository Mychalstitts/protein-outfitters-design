## Mobile (iOS + Android)

The Expo app lives in `mobile/` and shares types/logic with the backend via
`packages/shared`. It talks to the same Supabase project as `deploy/api`.

```bash
npm install                    # root — installs all workspaces
cp mobile/.env.example mobile/.env   # fill in the anon key
npm run mobile                 # expo start
npm run typecheck              # shared + mobile
npm run shared:test            # vitest
```

Builds go through EAS (`mobile/eas.json`): `preview` installs on registered
devices, `preview-simulator` for the iOS simulator, `production` for the
stores. JS-only updates ship via Actions → **EAS Update** → pick a channel.
Store-readiness checklist: `docs/mobile/app-store-readiness.md`.
