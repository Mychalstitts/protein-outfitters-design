# Responsive + Polish Audit
*Site-wide review of every deployed surface · May 4, 2026*

## Scope
Every page in `/deploy/`. Audited at three viewports: phone (≤720px), tablet (720–1099px), desktop (≥1100px). Plus iPhone-style hover polish applied globally.

## What changed
All updates went into `/deploy/po-shell.css` so every page inherits without per-page edits.

### iPhone glass-button polish
- **Spring-physics hover lift** on every primary CTA — `transform: translateY(-2px) scale(1.025)` with cubic-bezier(.2, .9, .3, 1.4) easing (Apple's standard spring curve).
- **Tap-press compression** — `scale(0.97)` on `:active` with faster .14s easing for the satisfying iOS click.
- **Glass sheen pseudo-element** — diagonal `linear-gradient(135deg, rgba(255,255,255,0.22) → 0)` that fades in on hover.
- **Soft shadow lift** — `0 12px 28px rgba(6,27,14,0.20)` on hover for depth.
- Applied to: `.btn-xl`, `.btn-pay`, `.btn-primary`, `.btn-submit`, `.cs-cta`, nav Reserve button, sheet next, wizard next, follow + share buttons, and all variants.

### Card-style hover (no shimmer, just spring)
- `.preset`, `.option`, `.share-card`, `.product`, `.species-card`, `.cert`, `.dow-card`, `.day` all get the same spring hover + tap-press but without the diagonal sheen — too much glow on cards reads cheap.

### Pill / segmented control polish
- `.pill-toggle`, `.bulk-btn`, `.cr-filter-btn`, all the tab styles get a subtle `translateY(-1px)` on hover.
- Active state stays flat — the colored fill is enough signal.

### Form input polish
- Inputs / selects / textareas glow with `box-shadow: 0 0 0 4px var(--accent-soft)` on focus.
- Border color shifts to `--brand`. No `outline: 0` on focus so keyboard users still see a ring.

### Keyboard focus rings
- `:focus-visible` on every interactive element gets a 2px brand-colored outline with 3px offset. Visible only when navigating via keyboard, not on click.

### Reduced motion
- `@media (prefers-reduced-motion: reduce)` shrinks all transitions to .01ms. Honors macOS / iOS / Android system settings.

### Print
- `@media print` hides nav, footer, sheets, action bars. Clean printable order forms / cut sheets / receipts.

## Responsive fixes

### Phone (≤720px)
- `--shell-pad` shrinks from 80px → 18px
- Nav: padding 12px / gap 10px, mark text 13px, action button 9px×14px
- Tap targets: every button enforced to `min-height: 44px` (Apple HIG minimum)
- Buttons: `.btn-xl` shrinks to 16px×26px and 15px font
- Pay buttons get 48px min-height for confidence on phone
- Footer: 4-column → 2-column grid
- Reserve sheet: `max-height: 88vh`, body padding 24px×18px, question 24px, options 14px×16px
- All horizontal pill rows (`.species-tabs`, `.cr-filters`, etc.) get `-webkit-overflow-scrolling: touch` for native momentum scroll

### Tablet (720–1099px)
- `--shell-pad`: 32px (between phone and desktop)
- Reserve sheet floats at 5vw inset bottom rather than full-bottom or centered card
- Buyer flow grids reflow correctly via the existing `auto-fill, minmax(320px, 1fr)`

### Desktop (≥1100px)
- Already well-tuned. `--shell-pad` stays at the fluid clamp(24px, 5vw, 80px).
- Reserve sheet centered card mode
- All grids hit their target columns

## Per-page status

| Page | Phone | Tablet | Desktop | Hover polish | Notes |
|---|---|---|---|---|---|
| `/` (master site) | ✅ | ✅ | ✅ | ✅ | Hero text scales fluidly; product grid auto-fills |
| `/discover` | ✅ | ✅ | ✅ | ✅ | Filter chips horizontal scroll on phone |
| `/listing` | ✅ | ✅ | ✅ | ✅ | Sticky action bar + farm sidebar collapses on phone |
| `/checkout` | ✅ | ✅ | ✅ | ✅ | Pay buttons get min-height 48px on phone |
| `/confirmed` | ✅ | ✅ | ✅ | ✅ | Next-grid 1-col on phone, 3-col desktop |
| `/list-animal` | ✅ | ✅ | ✅ | ✅ | Wizard step transitions intact at every breakpoint |
| `/farm/northfield-pastures` | ✅ | ✅ | ✅ | ✅ | Cover photo + avatar reflow on phone |
| `/cut-sheet` | ✅ | ✅ | ✅ | ✅ | Cow diagram SVG scales fluidly; yield meter stacks below at <1100px |
| `/processor-pricing` | ✅ | ✅ | ✅ | ✅ | Fee inputs align right; revenue card stacks below on phone |
| `/processor-schedule` | ✅ | ✅ | ✅ | ✅ | Day-of-week grid 1-col phone → 7-col desktop; calendar 1-col phone → 2-col desktop |
| `/credentials` | ✅ | ✅ | ✅ | ✅ | Cert grid 1/2/3 col by viewport |
| `/reviews` | ✅ | ✅ | ✅ | ✅ | Standing card stacks on phone; pending cards full-width |
| `/brand` | ✅ | ✅ | ✅ | ✅ | Logo previews scale with viewport |
| `/screens` | ✅ | ✅ | ✅ | ✅ | Tile grid 1/2/3 col |
| `/hardware` | ✅ | ✅ | ✅ | ✅ | Existing prototype, theme.css already responsive |
| `/donation-flow` | ✅ | ✅ | ✅ | ✅ | Existing prototype, theme.css already responsive |
| Stitch screens (15) | ✅ | ✅ | ✅ | partial | Tailwind already responsive; new hover polish only applies to .btn-xl etc., not Stitch buttons |

## Known gaps · next round

- **Stitch screens** (onboarding, discover, producers, map, listing, cuts, checkout, confirmed, farmer, processor, trends, site-visit, profile, account, settings) use Tailwind not po-shell.css. They get the favicon + OG tags but not the new button polish. Either re-skin them to po-shell or accept the visual difference. Recommend re-skin in a future pass.
- **Dark mode** — not implemented. The brand has a deep-green-on-parchment light mode locked in. Adding dark mode is a Q4 2026 nice-to-have.
- **iPad horizontal landscape sheet** — sheet sits at `bottom: 24px` centered which works. Could test on a real device.

## How to verify
- Open dev tools, toggle device toolbar
- Try iPhone 14 (390px), iPad (820px), Desktop (1440px)
- Hover any primary button → spring lift + sheen
- Click + hold → compression
- Tab through the page → focus rings on every interactive element
- Toggle "Reduce motion" in OS settings → animations drop to instant

## Files changed this audit
- `/deploy/po-shell.css` — added ~140 lines of polish + responsive rules at bottom

## Files NOT changed (no need)
- All HTML pages — they all link `po-shell.css` so they inherit
- `/deploy/theme.css` — design tokens, untouched
- `/deploy/icons.svg` — sprite, untouched
