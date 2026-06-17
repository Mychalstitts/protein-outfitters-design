# Session Handoff — May 15, 2026

State of the project after a Cowork session that started in the `Protein Outfitters (1)/` folder by mistake and ended with the Supabase backend migrated here.

---

## Stack — confirmed live

The deployed product at **proteinoutfitters.com** is:

- **React 19** + **Vite 6** + **TypeScript 5.8**
- **Firebase 12.11** (Firestore + Auth + Storage + Cloud Functions) — this is the backend
- **Tailwind 4** for styling
- **@google/genai 1.29** for the natural-language search bar ("Try: grass-fed beef under $8/lb…")
- **react-simple-maps** + **d3-geo** for the map view (not Leaflet)
- **recharts** for charts/dashboards
- **lucide-react** for icons (not game-icons.net as PROJECT_INSTRUCTIONS suggested — live site is lucide)
- **Express** included — server side present, role TBD

The live site at proteinoutfitters.com is signed-in-capable (user chip visible in nav). Auth is wired. 23 designed screens are deployed and reachable.

**Documentation drift to clear up early next session:** the `AUDIT-2026-05-05 Trello vs Live.md` document references **Neon Postgres** and a long list of `/api/*` routes. The `package.json` doesn't have Neon. Either the audit is stale, or there's a separate API service deployed somewhere. Read the audit + the `app/src/firebase.ts` first thing next session to resolve.

---

## What's already here (you don't need to rebuild)

- 60+ React components in `app/src/components/` (DashboardScreen, MarketplaceScreen, ProcessorQueueScreen, CheckInScannerScreen, BookProcessorScreen, CustomCutSheetScreen, OrderHistoryScreen, FarmerDashboardScreen, ProcessorOpsScreen, AdminScreens, etc.)
- 27+ numbered spec documents at the project root (`00 Decisions Log.md` through `23 Implementation Summary v3.md`)
- A separate `docs/` folder with launch comms, processor onboarding runbook, full UI-UX audit
- A `deploy/` folder with the 30 polished HTML prototypes (informed the React build above)
- An `IOS_ANDROID_ROADMAP.md` and `GROWTH-STRATEGY-2026-05-04.md`
- **`supabase/` folder** (new this session) — data-collection sidecar; see `supabase/README.md`
- A separate Vite/React app under `stitch/stitch_po_2/` (Studio prototype, see DESIGN.md there)

---

## Trello board

- URL: https://trello.com/b/6WWCWSp0/protein-outfitters
- 9 lists, 158 cards total:
  - **Features** (78) — backlog
  - **Lights On** (6) — infrastructure
  - **For Myke** (34) — pending decisions (deposit %, cancel window, condemnation insurance pricing, etc.)
  - **Cool things to know about** (3) — ⚠️ contains sameday.ai plaintext credentials, rotate + move to password manager
  - **Bugs** (23)
  - **Corner Cases** (7) — operational edge cases
  - **changing functionality** (5) — bigger architectural changes
  - **scrape** (2)
  - **todo** (2)

---

## What we did this session, in `Protein Outfitters (1)/` (now frozen)

That `(1)` folder is a parallel Next.js + Supabase + Resend rebuild attempt. Not the live product. Don't develop there anymore. What was useful:

- Stood up a Supabase project (`unybunaqyqrxhfyhvhfo`) with 7 migrations, 472 seeded processors, 2 Edge Functions (`send-request-emails`, `send-claim-emails`), 2 DB webhooks, 4 secrets configured
- Verified Resend domain `proteinoutfitters.com` is verified
- End-to-end email pipeline test: row insert → webhook → Edge Function → Resend → both emails landed with provider IDs in `email_log`
- All Supabase assets ported here under `supabase/` — see that folder's README

Outstanding from `(1)` that we're abandoning:
- Vercel project `protein-outfitters-app1.vercel.app` is live but redundant. Pause/delete from Vercel dashboard to free a slot.
- GitHub repo `Mychalstitts/protein-outfitters-app` can stay archived.
- A handful of uncommitted local edits (directory page reskin). Not worth shipping. Discard or ignore.

---

## Next session — first 30 minutes

1. Resolve the Firebase vs Neon documentation drift by reading `app/src/firebase.ts` + the recent `AUDIT-2026-05-05 Trello vs Live.md`.
2. Open the live site, view-source + DevTools network tab, confirm what backend it actually calls.
3. Then work through Trello's **Bugs** column in priority order — that's where most of the actionable, well-scoped work is.

Independent of session: rotate the sameday.ai password.
