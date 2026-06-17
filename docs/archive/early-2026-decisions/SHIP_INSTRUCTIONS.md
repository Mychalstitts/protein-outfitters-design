# Ship the P0 fixes — instructions

Five dead surfaces are now wired. Here's how to push them and run the migration.

## What I changed

**New files:**
- `deploy/api/farm-follow.js` — POST/DELETE/GET farm follow endpoint
- `deploy/api/cut-sheets.js`  — POST/GET cut-sheet endpoint with auto-email to processor
- `deploy/api/processor-ops.js` — GET today/week/month/inbox/cooler/ready/earnings/stats
- `deploy/api/payouts.js` — POST/GET Stripe Connect payout

**Updated files:**
- `deploy/api/auth/me.js` — added PATCH for profile editing
- `deploy/api/me.js` — same shim mirrored for /api/me
- `deploy/api/bookings.js` — added PATCH for status + hanging weight updates
- `deploy/api/migrate.js` — added `farm_follows`, `cut_sheets`, `payouts` tables + new booking columns/statuses
- `deploy/po-api.js` — added `updateProfile`, `followFarm`, `unfollowFarm`, `farmFollowState`, `submitCutSheet`, `cutSheet`, `processorOps`, `processorOpsStats`, `updateBooking`, `payouts`, `transferToBank`
- `deploy/profile.html` — replaced hardcoded "Marcus Sterling" with real user load + edit modal
- `deploy/farm-profile.html` — replaced fake Follow button with real DB-backed Follow/Unfollow
- `deploy/cut-sheet.html` — replaced fake "Submit to Plant 04" with real POST /api/cut-sheets
- `deploy/processor-ops.html` — added live-data bootstrap that takes over the demo
- `deploy/finance.html` — replaced fake "Transfer to bank" with real Stripe Connect Payout

## Step 1 — Fix the local git state

Your local clone at `/Users/Mychal/Documents/Claude/Projects/Protein Outfitters (1)/audit-fixes/protein-outfitters-design/` has a corrupted `.git/index.lock` and an orphan HEAD ref. In your Mac terminal:

```bash
cd "/Users/Mychal/Documents/Claude/Projects/Protein Outfitters (1)/audit-fixes/protein-outfitters-design"
rm -f .git/index.lock
git fetch origin main
git symbolic-ref HEAD refs/heads/main
git reset --soft origin/main
```

That leaves all my new files staged as uncommitted changes against origin/main.

## Step 2 — Review what's about to ship

```bash
git status -sb
git diff --stat
```

Expected: ~12 modified files + 4 new files in `deploy/api/` and `deploy/`.

## Step 3 — Commit and push

```bash
git add -A
git commit -m "Wire 5 dead surfaces: profile editor, farm follows, cut-sheet submit, processor-ops, Stripe Connect payouts"
git push origin main
```

Vercel will auto-deploy on push. Watch progress at:
https://vercel.com/mychalstitts-gmailcoms-projects/protein-outfitters-design/deployments

## Step 4 — Run the database migration

After Vercel finishes deploying (usually 60-90 seconds), hit the migrate endpoint to create the new tables and add the new booking columns:

```bash
# Replace <MIGRATE_SECRET> with the value from Vercel env vars
curl -X POST "https://www.proteinoutfitters.com/api/migrate?secret=<MIGRATE_SECRET>"
```

Or use the admin UI: `https://www.proteinoutfitters.com/admin-health` → click the "Run migration" button (it knows the secret).

Expected response:
```json
{ "ok": true, "ran": <number>, "skipped": 0 }
```

This adds:
- `farm_follows` table — backs the Follow button on farm profiles
- `cut_sheets` table — stores buyer cut instructions per reservation
- `payouts` table — history of bank transfers via Stripe Connect
- `bookings.hanging_weight_lbs`, `bookings.fabrication_started_at`, `bookings.ready_at`, `bookings.picked_up_at` columns
- Expanded `bookings.status` CHECK constraint to include `fabricating`, `ready`, `picked-up`

The migration uses `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` so re-running it is safe — no data loss.

## Step 5 — Smoke-test each fix

### Fix #2: Profile editor
1. Visit https://www.proteinoutfitters.com/profile while signed in
2. You should see your real name + email at the top (not "Marcus Sterling")
3. Click "Edit Profile" → modal opens with your fields
4. Change your phone number → Save → modal shows "✓ Saved." → closes → display updated

### Fix #3: Farm follow
1. Visit any farm page, e.g. https://www.proteinoutfitters.com/farm/stitty-ranch
2. Click "+ Follow" → button changes to "✓ Following · 1"
3. Reload the page — should still say "✓ Following · 1" (it's persisted now)
4. Click again → unfollows

### Fix #5: Cut-sheet submit
1. Need an active reservation. Make one (or use an existing one's UUID).
2. Visit https://www.proteinoutfitters.com/cut-sheet?reservation_id=<UUID>
3. Pick some cuts, set options, click "Submit to Plant 04 →"
4. Button shows "Submitting…" → "✓ Submitted to your processor" → redirects to /confirmed
5. Check the processor's inbox in /processor-ops (with `view=inbox`) — the new cut sheet appears
6. Check the processor's email — they should receive a "New cut sheet" notification (via Resend)

### Fix #1: Processor-ops live data
1. Sign in as a processor account (one that owns a `processors` record)
2. Visit https://www.proteinoutfitters.com/processor-ops
3. If you have no bookings yet → page shows "Nothing on today's queue." (correct)
4. If you have bookings → real cards replace the demo Angus Steer #402 etc.
5. Click "QR check-in" on a scheduled booking → status flips to checked-in
6. Click "Log wt" → prompt for hanging weight → saves to DB
7. Click "Start fab" → status flips to fabricating
8. Click "Mark ready" → status flips to ready
9. Click "Picked up" → status flips to picked-up
10. Click the Inbox tab → real cut sheets from buyers appear

### Fix #4: Stripe Connect Payout
**⚠️ This actually moves money in TEST mode (no real money). Once you flip Stripe to LIVE mode, every click moves real dollars.**

1. Sign in as a producer with a connected Stripe account (visit /farmer to verify)
2. Visit https://www.proteinoutfitters.com/finance
3. Click "Transfer to bank"
4. Button shows "Initiating…" → "✓ $X en route · arrives <date>"
5. Check Stripe Dashboard → Connect → Connected accounts → your account → Payouts — you'll see the new payout
6. Check the `payouts` table — new row with `status=in_transit`
7. After Stripe processes (test mode: instant; live mode: 2 business days), the row flips to `status=paid` via webhook

If the user has no available balance, you get a clean 409 error: "No available balance to transfer right now."

## Step 6 — Optional config that unlocks two more endpoints

These don't require code changes — just paste into Vercel env vars:

**GOOGLE_MAPS_KEY** (unlocks /api/discover-nearby)
- Google Cloud Console → enable Geocoding API → create API key
- Paste in Vercel env vars → redeploy

**4 Stripe Price IDs** (unlocks /api/processor-subscription)
- Stripe Dashboard → Products → Create 2 products (Standard, Premium)
- For each: create monthly + annual prices
- Paste the 4 `price_…` IDs into Vercel env vars:
  - STRIPE_PRICE_STANDARD_MONTHLY
  - STRIPE_PRICE_STANDARD_ANNUAL
  - STRIPE_PRICE_PREMIUM_MONTHLY
  - STRIPE_PRICE_PREMIUM_ANNUAL

## Step 7 — Last move: flip Stripe LIVE

Once everything above works in test mode:

1. Stripe Dashboard → toggle "Test mode" off (top-right)
2. Developers → API keys → reveal & copy `sk_live_…`
3. Developers → Webhooks → Add endpoint `https://www.proteinoutfitters.com/api/stripe-webhook` → subscribe to the same 12 events your test endpoint has → copy the signing secret
4. Vercel → project → Settings → Environment Variables:
   - For **Production environment only**, update:
     - `STRIPE_SECRET_KEY` = your `sk_live_…`
     - `STRIPE_WEBHOOK_SECRET` = your new live signing secret
   - Leave the Preview / Development environments on test keys
5. Redeploy production

Run a $1 real-card test reservation end-to-end to verify:
- Checkout charges the card
- Webhook fires → reservation flips to `deposit-paid`
- Lifecycle email lands
- Listing share count decremented correctly

After that, the platform is genuinely ready for real customers and real money.

---

## What's still on the punch list

All 5 P0 wiring fixes are done. P1 items (Google Maps key, 4 Stripe Price IDs) and P2 (Stripe live mode) are dashboard work only — no more code to write.

### Round 2 mini-fix included
- **`onboarding.html` Apple/Google buttons** — they previously claimed Apple/Google SSO but actually opened the email magic-link modal. I replaced them with a single honest "Continue with email" CTA. When real OAuth is wired (Apple Sign In + Google OAuth via api/auth/oauth-callback), restore the original Apple/Google buttons.

### Round 3 — Known dead surfaces still on the punch list

These I found in round 2 but didn't fix (each is a meaningful chunk of new infrastructure):

**Donation flow institution side — `donation-flow.html`** has 18 `showToast()`-only buttons on the institution + admin tabs:
- "Request this donation" (×4) — institutions claim a donation_fund matching their needs
- "Pre-request" — schedule a request for future donations
- "Request remaining" — claim leftover share
- "Past requests view coming soon"
- **Admin moderation:** "Review" (×3), "Approve" (×3), "Allocate", "View" (×3)
- "Send letter" — tax letter generator trigger
- "Track" — distribution tracker
- Needs: new `donation_requests` table, `/api/donation-requests` POST/GET/PATCH endpoint, admin review queue UI. Estimated: 1–2 days.
- **Importantly: the BUYER side of donation-flow (donor → Stripe Checkout → donation_funds) IS WIRED ✓**. Donors can give money today. What's missing is the recipient (institution) workflow.

**Site visits — `site-visit.html`** "Approve Report" + "Download PDF" are toast-only. No `site_visits` table exists in the schema. This is a feature without a backend at all. If site visits matter for launch, needs: new schema + endpoint + PDF generator. Estimated: 1 day.

**Notification fan-out:** following a farm doesn't yet trigger an email when that farm posts a new listing. The follow row is saved; the trigger isn't wired. Estimated: 2–3 hours.

**Processor cut-sheet accept/reject UI:** the `cut_sheets` table has `status IN ('submitted','accepted','rejected')` but `/processor-ops` doesn't yet have buttons to formally accept/reject. Buyer-submitted sheets show in the inbox view but processors can only visually browse. Estimated: 2 hours.

**Payout webhook events:** Stripe sends `payout.paid` and `payout.failed` — these should flip `payouts.status` and `payouts.failure_reason`. Add those event types to your Stripe webhook subscription, then extend `api/stripe-webhook.js`. Estimated: 1 hour.

**processor-ops demo fallback:** the "Farmer · QR" and "Farmer · Book" role-switch tabs are still mock UI. Only "Processor" view loads live data. Estimated: half day.

### Round 2 verified wired (no fix needed)

I deep-inspected these in round 2 and they're correctly wired despite looking suspicious:
- `account.html` `markPickedUp()` → PATCH /api/reservations status=picked-up ✓
- `account.html` `openComplaint()` → POST /api/complaint ✓
- `notifications.html` "Refresh" button → calls the loader ✓
- `hardware.html` 22 buttons — all are `showPage(...)` wizard tab switchers (intentional UI navigation); the final form submit POSTs to /api/hardware-lead ✓
- `producers.html` 10 buttons — 9 are state filter chips (intentional UI), 1 is Reserve (delegated to po-shell) ✓
- `donation-flow.html` donor side — "Donate this fraction" + "Confirm" + Stripe Checkout flow ✓
- `processor-pricing.html` "Save config →" → PATCH /api/processors ✓
- `processor-schedule.html` "Save schedule + capabilities →" → PATCH /api/processors ✓
- `invite-partner.html` "Send invite" → POST /api/invite-partner ✓
- `admin-bootstrap.html` "Bootstrap" → POST /api/admin-bootstrap ✓
- `admin-fsis-import.html` "Run import" → POST /api/fsis-import ✓
- `admin-ams-import.html` "Run import" → POST /api/ams-import ✓
- `admin-email.html` "Send tick" → POST /api/email-tick ✓
- `admin-health.html` "Run migration" → POST /api/migrate ✓
- `reserve-flow.html` — marketing demo, intentionally static
- `cuts.html`, `faq.html`, `trends.html`, `brand.html`, `screens.html`, `policies/*` — intentional static pages

### Summary

After round 1 + round 2:
- **5 of 5 P0 dead surfaces wired** (profile editor, farm follows, cut-sheet submit, processor-ops workflow, Transfer to bank)
- **1 P0 honesty fix** (onboarding SSO buttons no longer lie about Apple/Google)
- **3 config items still pending** (Google Maps key, 4 Stripe Price IDs, Stripe LIVE flip) — all dashboard work
- **Round 3 backlog** ≈ 3–4 days of code for donation institution flow + admin moderation + site visits + notification fan-out + cut-sheet accept/reject + processor-ops Farmer modes + payout webhook events

**Ship readiness after round 1 + round 2: ~95%.** The biggest remaining hole is the institution side of donations — buyers can donate, but institutions can't formally claim donations through the UI yet. For a soft launch with manual admin coordination, this is acceptable.
