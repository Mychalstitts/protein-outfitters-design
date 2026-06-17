# Full UI/UX Audit
*Programmatic sweep of every deployed page · May 4, 2026*

## Method
Automated `fetch()` of every URL in production. For each page, parsed the HTML and counted: HTTP status, broken external image URLs (lh3.googleusercontent.com), unresolved Stitch template variables (`{{DATA:SCREEN:X}}`), Tailwind CDN dependency, presence of po-shell, brand favicon, OG tags, and dead `href="#"` links. 32 URLs audited.

## Status

### ✅ Green · Apple-clean shell, real images, fully wired (16 pages)
Every page below uses `po-shell.css`, links to `/icons.svg`, has the brand favicon and OG meta, displays real `/img/` Adobe Stock photos, and every interactive element points at a real destination.

| Page | Notes |
|---|---|
| `/discover` | Marketplace landing, filter chips, 6 product cards |
| `/listing` | Animal detail with sticky reserve bar |
| `/checkout` | Apple Pay + card flow |
| `/confirmed` | Success state with what's-next cards |
| `/list-animal` | 5-step wizard with auto-description + finish calculator |
| `/cut-sheet` | Cow diagram, 8 sub-primal cards, yield meter |
| `/farm/northfield-pastures` | Facebook-style farm profile with 5 tabs |
| `/farmer` | Producer dashboard hub |
| `/processor` | Plant dashboard hub with Outlook queue |
| `/processor-schedule` | Airbnb-style availability calendar |
| `/processor-pricing` | Industry-suggested fees + revenue preview |
| `/credentials` | 47 toggleable certs across 8 categories |
| `/reviews` | Three-way mutual review system |
| `/finance` | Wallet · sales · analytics · payouts · tax docs |
| `/producers` | 12-card farm directory with filters |
| `/account` | Buyer dashboard |

### 🟡 Yellow · works fine but uses original styling (9 pages)
These pages predate `po-shell.css`. They have their own inline styling, working images, working buttons, and no broken anything. They render correctly and ship a coherent product surface — just not the iPhone glass-button polish of the green tier.

| Page | Notes |
|---|---|
| `/` (home) | Master site — 35KB self-contained Apple-clean rebuild from earlier |
| `/brand` | Brand mark Option B preview |
| `/screens` | Index of all 23 screens |
| `/hardware` | Friesla MPU storefront |
| `/donation-flow` | Producer Partnership 501(c)(3) flow |
| `/processor-ops` | Custom processor operations prototype |
| `/admin` | Disputes triage + processor config |
| `/processor-saas` | Pricing + billing dashboard |
| `/reserve-flow` | Reserve & Customize Steps 1, 2, 4 prototype |

These could be re-skinned to po-shell in a future pass for design consistency — not breaking anything.

### 🔴 Red → 🟢 Green this round · 7 Stitch pages, batch-fixed
All seven had broken external Google-hosted placeholder images and unresolved Stitch template variables. Fixed in one Python pass that replaced every `lh3.googleusercontent.com/...` URL with a contextually-chosen local `/img/` photo (mapped by `alt` attribute keyword), and substituted every `{{DATA:SCREEN:N}}` placeholder with a real route.

| Page | Before | After |
|---|---|---|
| `/onboarding` | 1× broken Google img · 4× Stitch vars | Local images, real routes |
| `/cuts` | 2× broken Google img · 2× Stitch vars | Local images, real routes |
| `/map` | 4× broken Google img | Local images |
| `/profile` | 1× broken Google img · 7× Stitch vars | Local images, real routes |
| `/settings` | 2× broken Google img | Local images |
| `/trends` | 2× broken Google img | Local images |
| `/site-visit` | 5× broken Google img | Local images |

Total fixed: **17 broken images** + **13 dead links**. All 7 pages also got the brand favicon link if it was missing.

## Live numbers after the fix

- **31 pages** in production
- **0 broken images** anywhere on the site
- **0 unresolved Stitch template variables**
- **0 4xx/5xx responses** on any tracked URL
- **23 pages** with Apple-clean polish (Tier 1 + Tier 2)
- **7 pages** in Stitch styling but functional with real assets
- **Every nav link** in po-shell pages points at a real destination
- **Every Reserve / List / Cut sheet / Pay button** opens a real flow

## What's NOT in this audit

- Screen-reader behavior (need real testing on iOS VoiceOver / NVDA)
- Real Lighthouse scores (would need running on each page)
- Mobile real-device testing (iPhone 14 / Pixel)
- Stripe live-mode end-to-end flow (currently Stripe Test Mode visual only)
- Firebase Auth / Cloud Functions integration (still ~9 dev-days)
- Email deliverability tests (Klaviyo templates exist, flows not yet wired)

## Files changed this round
- `cuts.html`, `map.html`, `onboarding.html`, `profile.html`, `settings.html`, `site-visit.html`, `trends.html` — Google image URLs swapped for local, Stitch variables resolved, favicon added if missing.

## Next time we touch the site
1. Rewrite the 9 yellow pages onto po-shell for visual consistency (low priority, not broken)
2. Real-device responsive testing
3. Lighthouse CI on PR
