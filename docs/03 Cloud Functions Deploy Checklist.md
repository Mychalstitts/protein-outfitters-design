# Cloud Functions Deploy Checklist
*Pre-flight for the first production deploy of `app/functions/`. Updated May 3, 2026.*

## Scope
Fourteen Cloud Functions in `app/functions/src/index.ts`:
1. `createShare` — Reserve a fraction.
2. `issueDropoffQrToken` — Generate signed JWT for processor scan.
3. `bookProcessor` — Farmer books slot + dropoff deposit.
4. `processorCheckIn` — Authoritative drop-off event.
5. `autoFlagFarmerNoShow` — Firestore trigger.
6. `createProcessorSubscription` — SaaS billing start.
7. `openProcessorBillingPortal` — Stripe Customer Portal redirect.
8. `stripeWebhook` — Subscription + dispute event handler. NO AUTH.
9. `drawFromInsurancePool` — Admin condemnation handler.
10. `acceptChargeback` — Honor the dispute.
11. `submitChargebackEvidence` — Contest the dispute.
12. `donateFraction` — 501(c)(3) donation flow.
13. `generateTaxLetter` — IRS-compliant PDF.
14. `submitHardwareLead` — MPU lead capture. NO AUTH.

## 0 · Environments
- [ ] **Production Firebase project exists** and is separate from dev. Confirm `firebase use production` lands on the correct project ID.
- [ ] **Service accounts** — review IAM for any `Owner` roles. Cloud Functions runtime should be `Cloud Functions Service Agent` only.
- [ ] **Region** — locked to `us-central1` (or chosen region). Confirm region pinned in `firebase.json`.

## 1 · Secrets (Firebase Functions Secret Manager)
- [ ] `STRIPE_SECRET_KEY` — production restricted key.
- [ ] `STRIPE_WEBHOOK_SECRET` — production webhook signing secret.
- [ ] `KLAVIYO_PRIVATE_KEY` — Klaviyo metric trigger.
- [ ] `JWT_SIGNING_SECRET` — for QR token. 32+ bytes, generated fresh.
- [ ] `INSURANCE_POOL_ACCOUNT_ID` — Stripe destination account for pool drawdowns.

Verify with `firebase functions:secrets:access <name>` (does not leak the value, only confirms presence).

## 2 · Stripe configuration (production mode)
- [ ] Connect platform live mode toggled on.
- [ ] Webhook endpoint pointing at `https://<region>-<project>.cloudfunctions.net/stripeWebhook`. Events: `customer.subscription.*`, `charge.dispute.*`, `payment_intent.succeeded`, `payout.paid`.
- [ ] Customer Portal enabled with subscription update + cancellation flows.
- [ ] Restricted API key in production with the smallest possible scope (no `read_only` permissions for the writeable functions).

## 3 · Firestore rules
- [ ] Apply `firestore-rules-additions.txt` over the existing `firestore.rules`.
- [ ] Run the Firestore rules emulator: `firebase emulators:start --only firestore` and run the test suite from `firestore-rules-test.spec.ts`.
- [ ] Specifically verify:
  - `shares/{id}` — read by buyer or producer only; create only via Cloud Function.
  - `bookings/{id}` — read by farmer, processor, or admin.
  - `processors/{id}` — public read of safe fields, restricted read of `connectedAccountId`.
  - `insurancePool/*` — admin-only.
  - `chargebacks/{id}` — admin + party-to-dispute only.

## 4 · Indexes
- [ ] Run a full E2E test in staging — Firestore will surface required composite indexes. Add them to `firestore.indexes.json`.
- [ ] Confirm indexes deployed: `firebase deploy --only firestore:indexes`.

## 5 · Function-level checks
For each of the 14 functions:
- [ ] Auth — caller is correctly identified (Firebase Auth `context.auth.uid`).
- [ ] Authorization — caller has the right role (buyer/producer/processor/admin).
- [ ] Input validation — Zod schema on every payload. Reject on extra keys.
- [ ] Idempotency — for any function that creates a billable event (`createShare`, `bookProcessor`, `donateFraction`), accept and persist a client-supplied `idempotencyKey`.
- [ ] Error responses — no internal stack traces leaked to client.
- [ ] Logging — structured logs with `correlationId`. No PII (no email, no full card data).

### Special cases
- `stripeWebhook` — verify signature with `STRIPE_WEBHOOK_SECRET` BEFORE processing. Reject any unsigned request.
- `submitHardwareLead` — open endpoint. Add reCAPTCHA + IP rate limit (e.g., 5/min/IP).
- `issueDropoffQrToken` — token expires in 24 hours, single-use, scoped to `bookingId`.
- `autoFlagFarmerNoShow` — Firestore trigger; ensure it's idempotent on re-run.

## 6 · Performance
- [ ] Set minimum instances on `stripeWebhook` to 1 — webhook timeouts will create dispute headaches.
- [ ] Set max instances on every function. Default to 10 for low-volume; raise as needed. Prevents runaway billing.
- [ ] Cold start budget — `generateTaxLetter` may be slow due to PDF generation. Pre-warm if needed.
- [ ] Confirm Node.js 20 runtime (not 18 EOL).

## 7 · Observability
- [ ] Sentry DSN wired in — every function captures unhandled errors.
- [ ] Cloud Logging structured logs include `correlationId`, `userId` (if authenticated), `functionName`.
- [ ] Slack alert on any function with > 5% error rate over 5 minutes.
- [ ] PagerDuty integration for `stripeWebhook` failures.

## 8 · Data
- [ ] Production Firestore is empty of test data (no `__test__` documents).
- [ ] Backups enabled — daily Firestore export to GCS.
- [ ] Retention policy — 90 days of point-in-time recovery.

## 9 · Frontend wiring
- [ ] React app `firebaseConfig` switched to production project.
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` switched to live publishable key.
- [ ] CORS allowlist on Cloud Functions — only `https://www.proteinoutfitters.com` and `https://proteinoutfitters.com`.
- [ ] CSRF token issued on session start (for the few `httpsCallable` calls that don't ride on Firebase Auth tokens).

## 10 · Legal gates (DO NOT DEPLOY without these)
- [ ] TOS reviewed and live at `/terms`.
- [ ] Privacy Policy reviewed and live at `/privacy`.
- [ ] Insurance pool legal structure resolved (May 6 call).
- [ ] Sales tax engine integrated (Stripe Tax).
- [ ] At least one signed Producer Agreement and one signed Processor Agreement on file.

## 11 · Rollback plan
- [ ] Tag the last good deploy: `git tag -a v0.0.0-pre-functions -m "..."`.
- [ ] Document rollback command: `firebase functions:rollback`.
- [ ] Identify the three failure modes that trigger immediate rollback:
  1. > 1% of `createShare` calls returning 5xx for 5+ minutes.
  2. `stripeWebhook` failing signature verification on legitimate calls.
  3. Any Firestore rules violation on a production read path.

## 12 · The deploy
1. Deploy rules first: `firebase deploy --only firestore:rules`.
2. Deploy indexes: `firebase deploy --only firestore:indexes`.
3. Deploy functions in dependency order:
   - `stripeWebhook` first (so any in-flight Stripe events are handled).
   - Then `createShare`, `bookProcessor`, `donateFraction` (the user-facing creators).
   - Then the admin handlers.
4. Smoke-test each in production with a real-but-test transaction.
5. Watch logs for 30 minutes. If clean, declare deploy complete.

## 13 · Post-deploy
- [ ] Update `/docs/04 Production Notes.md` (create if first deploy) with the deployment log.
- [ ] Update Postman collection `baseUrl` env var to the production URL.
- [ ] Slack #launch-watch with the green flag.
