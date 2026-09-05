# Local Setup Guide

Step-by-step from a fresh clone to running the apps. Follow in order.

## Prerequisites

You need these installed:

```bash
# Node 20+ (use nvm)
nvm install 20
nvm use 20

# Git
git --version

# Expo CLI (we use the package-local one, but the global helps with `eas`)
npm install -g eas-cli

# For iOS: Xcode 15+ from the Mac App Store, then once:
sudo xcodebuild -license accept

# For Android: Android Studio with SDK 34+
```

## 1. Install all workspace dependencies

```bash
cd "Protein Outfitters (1)/app"
npm install
```

This installs everything in one go thanks to npm workspaces.

## 2. Set up Supabase

1. Go to [supabase.com](https://supabase.com), create a free project.
2. From your project, copy:
   - Project URL (Settings → API → Project URL)
   - `anon` public key (Settings → API → Project API Keys → `anon` `public`)
   - `service_role` secret key (same page — keep this NEVER-public)
3. Copy `.env.example` to `.env` and paste them in:

```bash
cp .env.example .env
```

4. Apply the schema:

```bash
# Option A — via the Supabase dashboard:
# Open SQL Editor → paste supabase/migrations/0001_initial_schema.sql → Run

# Option B — via CLI (one-time setup):
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

5. Seed the 509 processors:

```bash
node scripts/seed-supabase.mjs
```

You should see `Done. 509 processors loaded.`

## 3. Run the web app

```bash
npm run web
```

Open `http://localhost:3000`. You should see the home page; `/map` shows all 509 processors.

## 4. Run the mobile app

```bash
npm run mobile
```

This opens Expo Dev Tools. Either:
- Press `i` to open the iOS simulator (Xcode required)
- Press `a` to open Android emulator (Android Studio required)
- Or scan the QR code with Expo Go on your phone (fastest for first iteration)

Note: maps in Expo Go on Android use Google Maps, which needs an API key. See `docs/app-store-readiness.md` for setup.

## 5. Common issues

**"Cannot find module '@protein-outfitters/shared'"** — Run `npm install` from the `app/` directory, not from inside an app folder. Workspaces install everything from the root.

**Map shows blank on Android** — You haven't set the Google Maps key in `app.json`. The map works on iOS without one (uses Apple Maps).

**`processors_within is not a function`** — The migration didn't run. Re-apply `0001_initial_schema.sql`.

**Auth callback redirects to localhost on a real device** — Set the Site URL in Supabase → Authentication → URL Configuration to your Expo dev URL or production domain.

## What changes when you ship

For TestFlight / production builds:

```bash
# One-time: link Expo project
cd apps/mobile
eas init
eas build:configure

# Then for releases:
eas build --profile preview        # internal TestFlight / Internal Testing
eas build --profile production     # what you actually submit

eas submit -p ios                  # to App Store
eas submit -p android              # to Play Store
```

Before you do that, work through every item in `docs/app-store-readiness.md`.
