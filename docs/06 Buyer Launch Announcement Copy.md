# Buyer Launch Announcement Copy
*For the email blast on launch day, the home-page hero refresh, and the launch-day social posts. Updated May 3, 2026.*

## Email blast — `PO · Launch Day` (to be created in Klaviyo)

**Subject line options (test):**
- The freezer is open.
- A whole animal, in three taps.
- We finally built the thing we wished existed.

**Preview text:** Reserve a fraction of a real, named animal — and we'll handle every step from harvest to your driveway.

**Body:**

```
We finally built the thing we wished existed.

Reserve a fraction — quarter, half, whole — of a real, named animal raised by a producer you can verify. Pick exactly how you want it cut. We coordinate the USDA processor, the drop-off, the pickup, and the payout. Three taps. No spreadsheets. No mystery beef.

Today, we're opening it up.

→ Browse what's available — proteinoutfitters.com/discover

The first 50 reservations get $100 toward a future purchase, and a hand-stamped Protein Outfitters knife card.

— Mychal Stittsworth
  Founder · Protein Outfitters
```

## Home-page hero — `index.html`

**Eyebrow:** Now reserving · MN, WI, ND, SD

**Headline:** A whole animal, in three taps.

**Sub-headline:** Reserve a fraction of a real, named animal from a producer you can verify. We handle every step from drop-off to driveway.

**Primary CTA:** Browse available animals →

**Secondary CTA:** How it works ↓

## Social — Twitter/X (3 posts, 2 hours apart)

**Post 1:**
> A whole animal, in three taps.
>
> We just launched Protein Outfitters — the marketplace for buying whole/half/quarter animals from real ranchers, with the cut sheet, the USDA processor, and the pickup all handled for you.
>
> proteinoutfitters.com

**Post 2:**
> Why this exists:
>
> Buying freezer beef from a rancher should be the most premium meat experience in the country. Instead it's a Google Sheet, three phone calls, a faxed cut sheet, and a guess about what 220 lbs of beef looks like.
>
> We fixed the buying part.

**Post 3:**
> First 50 reservations get $100 toward your next purchase + a hand-stamped knife card.
>
> proteinoutfitters.com/discover

## Social — LinkedIn (single post)

```
A whole animal, in three taps.

For two decades, Stittsworth Meats has sold whole and half beef to families across the Northland. Every customer who's bought one has loved the meat. Most have hated the buying process — phone calls, spreadsheets, faxed cut sheets, and a six-month wait at the processor.

Today we're launching Protein Outfitters: the marketplace that fixes it.

→ Reserve a quarter, half, or whole from a producer you can verify.
→ Build your cut sheet through an animal-aware UI that knows what cuts are even possible.
→ We coordinate the USDA-inspected processor, the drop-off, the QR check-in, and the pickup.
→ Producers get paid the day after pickup.

Live in Minnesota, Wisconsin, North Dakota, and South Dakota. Now reserving at proteinoutfitters.com.

If you've ever bought freezer beef and thought "there has to be a better way" — we built it.

#agtech #directtoconsumer #marketplace #regenerativeagriculture
```

## Slack — `#launch-watch` post

```
🟢 PO LAUNCH IS LIVE

www.proteinoutfitters.com is taking real reservations as of {launch_time} CT.

What to monitor for the next 6 hours:
• Stripe webhooks landing cleanly (#stripe-help if 5xx)
• Klaviyo flows firing on reservation events (template TKiLur, SfnUcZ)
• /admin disputes queue — should be empty
• /processor dashboards — verify processor partners can see new bookings

Status doc: /docs/04 Production Notes (created on first deploy)
On-call eng: {eng_oncall}
On-call ops: {ops_oncall}

Drop in the thread on this post if anything looks off.
```

## Producer-facing announcement — `Producer Bulletin · Launch Edition`
*Sent via Klaviyo to the producer list.*

**Subject:** We just opened the gate — buyers are inbound.

**Body:**

```
{first_name},

Quick update — Protein Outfitters is open for reservations.

That means buyers in your service area can reserve fractions of your animals starting now. Your first reservation will trigger an email with the cut sheet, the harvest window, and the processor pairing. You'll have 48 hours to confirm.

Three things to do today:
1. Log into your dashboard at proteinoutfitters.com/farmer.
2. Confirm your harvest schedule for the next 60 days.
3. Make sure your processor pairings are up to date — buyers see what you allow.

If you want to chat through anything, my cell's open.

— Mychal
```

## Hero photo guidance
Use the licensed Adobe Stock pasture/Angus image already on the deployed home page. Don't swap to a "launch sticker" treatment — the calm pasture shot is on-brand. The launch energy comes from the email and the social copy, not the hero.

## A/B test plan
- Subject line: 3 variants, 33/33/34 split, declare winner at n=2,000 sends.
- Hero CTA: "Browse available animals" vs. "Reserve your first share" — 50/50, declare at n=10,000 page views or 14 days, whichever first.
- Social — no test, just publish all three Twitter posts on the schedule above.
