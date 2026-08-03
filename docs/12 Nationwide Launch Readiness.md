# Nationwide Launch Readiness

Honest checklist for sending Protein Outfitters to Cattlemen’s associations, farm networks, and meat processors across the U.S.

Last updated: 2026-07-31

---

## What already works in production

| Path | Status | Notes |
|------|--------|--------|
| Public listings API | Live | Real animals in Neon; discover loads from `/api/listings` only (no demo fallback) |
| National map | Live | ~150+ farms, ~2,300 processors (FSIS/MPA imports) |
| Magic-link auth | Live | Buyer / producer / processor roles |
| Create farm | Live | Geocodes city/state so ranch appears on map |
| List animal → publish | Live | Validated price + share inventory required to go active |
| Discover → listing → reserve sheet | Live | Stripe Checkout deposit + processing + insurance |
| Checkout hold safety | Live | If Stripe session fails, share inventory is restored |
| Processor claim | Live | Search unowned plants by name/state or create new; name+state auto-matches imports |
| Processor ops / schedule / fees | Live | Real bookings when buyers reserve with a plant |
| Invite farm/processor email | Live (env) | Requires `RESEND_API_KEY` |
| Social posts / reactions / comments | Live | Schema auto-ensured |
| Admin health dashboard | Live | `/admin-health` (admin only) — env, schema, Stripe, Resend score |

---

## Ops gates before mass outreach (you control these)

Open **https://www.proteinoutfitters.com/admin-health** as an admin. Target **score ready = 100%**.

### Required env (Vercel production)

- [ ] `DATABASE_URL` — Neon
- [ ] `MIGRATE_SECRET`
- [ ] `STRIPE_SECRET_KEY` — **live** key for real money (`sk_live_…`)
- [ ] `STRIPE_WEBHOOK_SECRET` — endpoint → `/api/stripe-webhook`
- [ ] `RESEND_API_KEY` — lifecycle + partner invites
- [ ] `EMAIL_TICK_SECRET` + `CRON_SECRET` — daily email sweeps
- [ ] `PARTNER_EIN` + `PARTNER_ADDRESS` — donation tax letters (if using Donation Depot)

### Stripe webhook events (must be subscribed)

- `checkout.session.completed`
- `charge.refunded`
- `charge.dispute.*` (created/updated/closed/funds_withdrawn/funds_reinstated)
- `account.updated` (Connect)
- SaaS (if selling plant plans): `customer.subscription.*`, `invoice.paid`

### Smoke test (do this once with a real card in test or a $50 live deposit)

1. Sign in as producer → create farm with **real city/state** → list animal with **$/lb > 0** → publish  
2. Open `/discover` → open listing → reserve half/quarter → complete Stripe Checkout  
3. Confirm reservation moves to paid after webhook; cut-sheet loads  
4. Sign in as processor → **search claim** a plant (or create) → set schedule + fees  
5. Invite a partner from `/invite-partner` → confirm email arrives  

---

## Product rules that keep the marketplace trustworthy

1. **No demo livestock** on discover if the API is empty or down — empty states CTA to list/invite.  
2. **Active listings need price + share inventory** — server rejects $0 publish.  
3. **Farms geocode on create** so national map isn’t empty for new producers.  
4. **Processor claim prefers existing registry rows** — avoids duplicate plants when outreach converts FSIS/MPA listings.  
5. **Failed Stripe sessions release holds** — inventory cannot stick on dead checkouts.

---

## Outreach channels (suggested order)

1. **State cattlemen’s / pork / sheep associations** — dual CTA:  
   - Producers: https://www.proteinoutfitters.com/join?as=producer  
   - Processors: https://www.proteinoutfitters.com/join?as=processor  
2. **County extension / Farm Bureau / Young Farmers** — same join page  
3. **Custom processors** already on map — claim email (`docs/13`) or `/invite-partner`  
4. **Local food co-ops & buying clubs** — buyer `/discover`  

Cold copy:
- Producers: `docs/04 Launch Comms — Producer Cold Email.md` (nationwide)
- Processors: `docs/13 Launch Comms — Processor Cold Email.md`

Member landing: **https://www.proteinoutfitters.com/join**

---

## Known soft spots (not blockers for soft national open)

| Item | Impact | Mitigation |
|------|--------|------------|
| Inventory depth | Few live animals vs processor directory size | Supply-side outreach is the priority |
| Stripe Connect not completed by every farm/plant | Payouts delayed until onboarding | Banner on farmer/processor hubs |
| Pending unpaid checkouts | Share held until cancel/sweep | `/api/admin-sweep-pending-reservations` + webhook |
| Concierge AI / analytics optional | No checkout dependency | Configure PostHog when ready |
| Processor ops still has demo UI shell offline | Signed-in operators get real queue | Always sign in for demos to partners |

---

## One-sentence pitch for associations

> Protein Outfitters is a live marketplace where U.S. producers list real animals by the share, buyers reserve with a card deposit, and USDA/state plants claim their profile to take booked drop-offs — inventory, payments, and plant capacity on one stack.
