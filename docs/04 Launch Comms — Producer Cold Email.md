# Producer cold email — Apollo-ready
*For outbound to MN/WI/ND/SD ranches and farms with direct-to-consumer interest. Three-touch sequence.*

## ICP for this sequence
- Ranches/farms within 180 miles of Bemidji, MN.
- 50–500 head OR known DTC presence (farmers markets, herd shares, freezer beef Facebook groups).
- Owner or operations decision-maker.
- USDA-eligible or already shipping cross-state.

## Touch 1 — cold email · Day 0

**Subject lines (A/B):**
1. {first_name}, a question about your {company_name} freezer beef
2. {first_name} — moving freezer beef without the spreadsheet?

**Body:**
```
{first_name},

Stittsworth Meats out of Bemidji here. We just launched Protein Outfitters — the platform we wish existed when we started selling whole and half beef to families in the Northland.

It does three things:
• Buyers reserve a quarter, half, or whole. They pick the cuts. They pay up front.
• You ship the animal to a USDA processor on your list. We handle the QR check-in.
• You get paid the day after pickup. No phone tag. No paper cut sheets.

We're onboarding 12 producers across MN, WI, ND, and SD this quarter. {company_name} fits the profile.

Would 20 minutes next week make sense? I'll show you the producer dashboard and we can talk numbers.

— Mychal Stittsworth
   Founder · Protein Outfitters
   www.proteinoutfitters.com
   {phone_number}
```

## Touch 2 — bump · Day 4

**Subject:** Re: {first_name}, a question about your {company_name} freezer beef

**Body:**
```
{first_name} — bumping this in case it got buried.

If freezer beef is more than 10% of your revenue, this conversation is worth the 20 minutes. Three early producers have moved 100% of their direct-to-consumer animals through us in the last 60 days.

Easiest day next week?
```

## Touch 3 — break-up · Day 9

**Subject:** Last note — Protein Outfitters

**Body:**
```
{first_name},

I'll stop pinging. If freezer beef isn't a focus for you right now, no worries.

If it ever becomes one, www.proteinoutfitters.com or my cell {phone_number}.

— Mychal
```

## Apollo configuration notes
- Sequence name: `PO Producer Outreach v1`
- Sender: mychal@proteinoutfitters.com (after domain verification + warmup)
- Send window: Tue–Thu, 9:00–11:00 AM Central
- Reply detection: route any reply to mychal@ and pause sequence
- Throttle: 50 sends/day per sender during warmup, 100/day after week 2

## Subject line A/B test plan
Touch 1 alone, 50/50 split, n=100 sends per variant before declaring. Track open rate (target > 40%) and reply rate (target > 8%).

## Producer-side referral hook (Touch 1 footnote, optional)
> "If {company_name} isn't a fit, do you know one ranch in your network that should hear about this? We pay a $250 referral on any producer who lists 3+ animals."
