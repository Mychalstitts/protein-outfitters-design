# Soft Launch Day — Hour-by-Hour Plan
*Single-page playbook for the first 12 hours. Updated May 3, 2026.*

## Pre-flight (T-1 day, evening)
- [ ] Cloud Functions deployed and watched for 24 hours of clean logs (see /docs/03).
- [ ] Compliance brief review complete with counsel (May 6 call).
- [ ] At least 1 producer + 1 processor in `Active` status.
- [ ] Klaviyo Welcome flow active and tied to signup event.
- [ ] /admin dashboard reachable, eng on-call confirmed.
- [ ] Brand mark decision made (May 4 block); any deploys consequent shipped.
- [ ] Sentry, Slack alert routes, PagerDuty wired.
- [ ] Press one-pager (/docs/05) in PDF, sent to 5 friendly local press contacts on embargo.

## Launch hour (T+0)
- 09:00 CT — `firebase deploy` cuts the production switch.
- 09:05 — Slack `#launch-watch` post (template in /docs/06).
- 09:10 — Email blast (`PO · Launch Day` template) goes to the wait list.
- 09:15 — Twitter/X Post 1 + LinkedIn post (templates in /docs/06).
- 09:30 — Producer Bulletin email goes to the producer list.
- 11:00 — Twitter/X Post 2.
- 13:00 — Twitter/X Post 3.

## What to watch — first 6 hours
| Metric | Target | Action if breached |
|---|---|---|
| Webhook delivery success | > 99.5% | Roll back, page eng |
| Sign-up → reservation conversion | > 4% | Watch for friction at /cut-sheet step |
| Stripe Connect onboarding completion (producer) | > 60% | Page eng, check KYC errors |
| Cloud Function 5xx rate | < 0.5% | Scale instances + investigate |
| Klaviyo flow trigger rate | matches reservation count | Check flow → metric mapping |
| Customer support inbound | < 5/hour | If higher, surface common patterns to the FAQ |

## Common questions (have a draft answer queued)
1. **"Is this real meat or vat-grown?"** Real animals from real ranches. Each listing names the producer.
2. **"How do you ship?"** We don't ship — you pick up at a USDA-inspected processor near you. That's how we keep it premium and avoid cold-chain problems.
3. **"What if I can't fit a quarter in my freezer?"** A quarter is ~110 lbs and fits in a 7 cu ft chest freezer. We list freezer requirements on every animal.
4. **"What happens if the animal is condemned?"** The Insurance Pool makes you whole. See /policy/refunds.
5. **"Can I choose the processor?"** The first buyer to reserve picks. Subsequent buyers on the same animal share that processor.

## Roles for launch day
- **Mychal — public-facing.** Replies to social, talks to press.
- **Eng on-call — backend.** Sentry, logs, hot-fixes.
- **Ops on-call — humans.** Producer phone calls, processor questions, customer DMs.
- **Designer (if available)** — visual fixes if anything breaks at responsive breakpoints.

## Stop conditions (when to roll back)
- Stripe webhook signature failures > 1% over 5 min.
- Successful payments not creating Firestore reservations (data integrity break).
- Producer dashboard 500ing for any active producer.
- Any privacy or PII leak surfaced.

## Stretch goals
- 50 reservations day-of.
- 1 piece of local press (Bemidji Pioneer, MinnPost, Star Tribune ag desk).
- 3 producer inbound inquiries.
- < 5% bounce on the email blast.

## Post-launch debrief (T+3 days)
- Pull cohort: signups, reservations, completion rate per step.
- Pull Klaviyo deliverability stats per template.
- Pull support inbound by category.
- One-page postmortem (template: /skills/anthropic-skills:internal-comms format).
- Ship version 1.1 of the deploy checklist with anything we missed.
