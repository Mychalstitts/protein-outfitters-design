# Producer cold email — nationwide
*For outbound to U.S. ranches and farms with direct-to-consumer interest. Three-touch sequence. Link every CTA to https://www.proteinoutfitters.com/join?as=producer*

## ICP for this sequence
- Cow-calf, stocker, or finish operations selling freezer beef / herd shares / farmers-market meat.
- 25–2,000 head OR known DTC presence (Facebook groups, CSA, farm stores).
- Owner or operations decision-maker in any U.S. state.
- Can access a USDA, state-inspected, or equal-to plant within reasonable haul distance.

## Touch 1 — cold email · Day 0

**Subject lines (A/B):**
1. {first_name}, a question about your {company_name} freezer beef
2. {first_name} — sell whole/half shares without the spreadsheet?

**Body:**
```
{first_name},

I'm Mychal with Protein Outfitters — a live marketplace where families reserve a quarter, half, or whole of a *named* animal from your ranch, pay a deposit up front, and pick up at a local inspected plant.

What you get:
• List an animal in about 90 seconds — share inventory tracked for you
• Buyers pay deposit by card (Stripe). You set $/lb hanging weight
• Drop-off books into a plant on our map (2,300+ plants listed nationwide)
• Ranch profile buyers can follow and re-order from

We're onboarding producers through cattlemen's associations and farm networks across the country. {company_name} fits the profile.

Start here (free): https://www.proteinoutfitters.com/join?as=producer
Or list your first animal: https://www.proteinoutfitters.com/list-animal

Would 15 minutes next week make sense? I'll walk the producer dashboard with you.

— Mychal Stitts
   Founder · Protein Outfitters
   www.proteinoutfitters.com
   hello@proteinoutfitters.com
```

## Touch 2 — bump · Day 4

**Subject:** Re: {first_name}, a question about your {company_name} freezer beef

**Body:**
```
{first_name} — bumping this in case it got buried.

If direct freezer beef is more than a side project, this is worth 15 minutes. Producers list real animals; buyers reserve shares; plants take booked drop-offs. No demo inventory — when you publish, you're live.

Join page: https://www.proteinoutfitters.com/join?as=producer

Easiest day next week?
```

## Touch 3 — break-up · Day 9

**Subject:** Last note — Protein Outfitters

**Body:**
```
{first_name},

I'll stop pinging. If freezer beef isn't a focus right now, no worries.

When it is: https://www.proteinoutfitters.com/join?as=producer
Or reply with a plant you already use — we'll invite them too.

— Mychal
```

## Apollo / outreach configuration
- Sequence name: `PO Producer Nationwide v2`
- Sender: mychal@proteinoutfitters.com (domain verified + warmed)
- Send window: Tue–Thu, local morning for recipient timezone when known; else 9–11 AM Central
- Reply detection: pause sequence on any reply
- Throttle: 50/day warmup, 100–150/day after week 2
- UTM on links: `?as=producer&utm_source=apollo&utm_campaign=producer_v2`

## Subject line A/B
Touch 1 only, 50/50, n≥100 per variant. Targets: open > 35%, reply > 6%.

## Referral footnote (optional on Touch 1)
> Know another ranch that should list? Send them https://www.proteinoutfitters.com/join?as=producer — we treat member intros from associations as priority onboard.
