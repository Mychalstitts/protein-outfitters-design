# App Store + Play Store Readiness Checklist

The single source of truth for "are we ready to submit?" Each line maps to a code change, a config setting, or an asset we need to produce. Nothing here is optional.

Status legend: ✅ done in scaffold · 🟡 partially done, needs production values · 🔴 not started, blocks submission

---

## Apple App Store

### Account & legal

- 🔴 Apple Developer Program membership ($99/year). Sign up at developer.apple.com. Takes 24–48h to activate. [BLOCKER]
- 🔴 Hosted privacy policy URL. Use iubenda or Termly ($5–20/mo) — generic generators won't pass review for a marketplace.
- 🔴 Hosted terms of service URL.
- 🔴 LLC or sole-proprietor entity decision. Either works; LLC gives liability separation.

### Required in-app capabilities

- ✅ Account deletion in-app (App Store guideline 5.1.1(v)). Implemented in `app/account.tsx` via the `delete_my_account()` Supabase RPC.
- ✅ Sign in with Apple (guideline 4.8). Implemented in `app/account.tsx`. Required because we plan to add Google/email login later.
- 🟡 Privacy strings for location. Set in `app.json` → `ios.infoPlist`. **Edit the copy** to reflect your actual use ("show processors near you") before submission.
- ✅ `ITSAppUsesNonExemptEncryption: false` declared so we skip the export compliance prompt every release.

### Privacy nutrition label (filled in App Store Connect, not in code)

We collect and need to declare:

- Email address (linked to user, used for app functionality and account)
- Name (linked to user, used for app functionality)
- Phone number, ZIP (linked to user, used for app functionality)
- Coarse location (linked to user, used for app functionality — finding nearby processors)
- User-submitted content (their request notes — linked to user, used for app functionality)
- We do NOT track users across other apps. Confirm: "Data Not Collected for Tracking."

### Build & release config

- 🟡 Bundle ID `com.proteinoutfitters.app` in `app.json`. Reserve it on App Store Connect when you create the app record.
- 🔴 EAS project ID. Run `eas init` to get one; replace `REPLACE_WITH_EAS_PROJECT_ID` in `app.json`.
- 🔴 Apple Team ID, Apple ID, ASC App ID. Replace placeholders in `eas.json` `submit.production.ios`.
- 🔴 App icon set. Need `assets/icon.png` (1024×1024, no alpha, no rounded corners — Apple rounds them).
- 🔴 Splash screen. Need `assets/splash.png` (any size, will be letterboxed against the configured background).
- 🔴 Screenshots — required at 6.7" (iPhone 15 Pro Max), 6.5" (older Pro Max), and 5.5" (older Plus). Three minimum each. Use Expo's simulator screenshots.
- 🔴 App preview video (optional but lifts conversion ~20%).

### Listing copy (for App Store Connect)

- 🔴 Promotional text (170 chars, can change without resubmission)
- 🔴 Description (4000 chars max)
- 🔴 Keywords (100 chars total, comma-separated, no spaces inside)
- 🔴 Support URL (a page on proteinoutfitters.com is fine — `/support`)
- 🔴 Marketing URL (the homepage)

### Review notes (the secret weapon)

App Reviewers are humans. A 2-paragraph reviewer note explaining:
1. What the app does
2. A demo account for them to sign in with (if any auth is required to see content)
3. That all map data is public information from state meat processor associations

…cuts rejection rate dramatically. Draft: `docs/reviewer-notes.md` (TODO).

### Common rejection triggers we've already handled

- Account deletion: ✅
- Sign in with Apple parity: ✅ (will also matter when we add Google)
- Encryption export compliance: ✅
- Location permission strings: 🟡 (strings present, edit before submit)

### Things we still need to handle

- ✅ Crash-free first launch. Supabase client is now a safe Proxy — missing env never throws.
- ✅ Offline state for the map. Bundled 472 processors ship inside the app; works in airplane mode.
- ✅ Empty state on the search list when no processors match. Map screen shows a "no matches" state with a clear-search button.
- ✅ Clear "what is this app" onboarding for a cold reviewer. Three-card pager on first launch.
- ✅ Privacy policy + Terms hosted on the web AND in-app at `/legal/privacy` and `/legal/terms`.
- ✅ Reviewer notes drafted at `docs/reviewer-notes.md`.
- ✅ Store listing copy drafted at `docs/store-listing-copy.md`.
- ✅ Visual asset masters (icon, adaptive icon, splash, favicon, OG) as SVG.
- 🟡 Render SVG masters to PNG: run `npm run build:icons` (requires `npm install --save-dev sharp` first).
- 🔴 Set the demo account password and put the real password into reviewer notes before submitting.
- 🟡 Affiliate attribution cookie (`po_aff`, `po_vid`) — schema in migration 0003, web route at `/r/[code]` set. Privacy nutrition label needs an "Identifiers" entry on the Apple side and a matching disclosure in Play's Data Safety form. The cookies are first-party and not used for cross-app tracking — confirm "Data Not Collected for Tracking" still holds.
- 🟡 External-animal calendar (migration 0004 + `/dashboard/processor/calendar`) — new top-level processor feature. Add a third onboarding tooltip on the dashboard the first time a claimed processor visits, or a fourth card to the first-launch pager when we add a "for processors" track.
- 🟡 Seed normalization script (`app/scripts/normalize-seed/`) — when re-run with fresh scrapes, regenerates `apps/mobile/src/data/processors.bundled.json` and `apps/web/public/processors.bundled.json`. Keeps the offline first-launch guarantee honest as the directory grows.

---

## Google Play Store

### Account & legal

- 🔴 Google Play Console account ($25 one-time). play.google.com/console.
- 🔴 Same privacy policy URL as Apple.
- 🔴 14 days of closed testing with **at least 12 testers** before public release. New rule, catches indie devs.

### Required

- 🟡 Bundle ID `com.proteinoutfitters.app` set in `app.json`.
- ✅ Adaptive icon configured.
- 🟡 Google Maps API key. Get from console.cloud.google.com → enable Maps SDK for Android. Replace in `app.json` → `android.config.googleMaps.apiKey`. Restrict the key to your bundle ID + SHA-1.
- 🔴 Service account JSON for `eas submit` automation. Generate in Play Console → Setup → API access.

### Data Safety form (Play Console)

Same data we declared for Apple, but their form is more granular. Has its own UI.

### Target API level

- ✅ Expo 51 targets API 34 — current Play Store requirement.

### Listing assets

- 🔴 App icon (512×512 PNG, no alpha)
- 🔴 Feature graphic (1024×500)
- 🔴 At least 2 phone screenshots
- 🔴 Description, short description, full description

---

## Web (Next.js on Vercel)

No gatekeeper, but to feel app-like:

- 🔴 Custom domain (`proteinoutfitters.com`) on Vercel
- 🔴 PWA manifest + service worker (lets users save it to home screen)
- 🟡 Open Graph image for social sharing — dynamic per shop via `/api/og/p/[slug]` (route shipped, needs real font + game-icons SVG inline for higher-fidelity mark)
- 🟡 Affiliate share-link routes (`/r/[code]`) and public profile pages (`/p/[slug]`) — shipped, need real `affiliate_codes` rows seeded before the dashboard has data
- 🟡 Affiliate dashboard at `/dashboard/affiliate` — reads `affiliate_stats_30d` view; needs RLS testing once `claimed_by` is set on real rows
- 🔴 Cookie banner if we add analytics (GDPR/CCPA). The attribution cookies (`po_vid`, `po_aff`) are first-party functional and don't require a banner under most regimes, but add a one-line disclosure to the privacy policy.

---

## Pre-submission dry run (the dress rehearsal)

Before pressing "Submit for Review":

1. Build a TestFlight release: `eas build --profile production --platform ios`
2. Install it on a real iPhone, not the simulator
3. Run through every screen with **airplane mode on**
4. Sign up, sign out, sign back in, delete account
5. Submit a real request, watch it land in the database
6. Hand the build to one person who has no context, watch them open it cold

Anything that confuses them or crashes is a rejection waiting to happen.

---

## Rough timeline from today (May 6, 2026)

- **Weeks 1–3:** Scaffold + database + first working build (we're in week 1)
- **Weeks 4–6:** Polish, edge cases, account/auth
- **Week 7:** Apple Developer account, asset production, store listing copy
- **Week 8:** TestFlight + closed Play testing
- **Week 9:** Apple submission (24–48h review) + Play submission
- **Week 10–12:** Public launch — barring 1–2 rejection cycles

**Realistic public launch: late July to mid-August 2026.**
