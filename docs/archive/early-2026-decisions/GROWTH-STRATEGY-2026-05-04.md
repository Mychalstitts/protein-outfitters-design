# Protein Outfitters — Growth & Data Strategy
*May 4 2026*

The goal: every beef / pig / sheep / goat / bison / deer / elk / lamb farm AND every meat processor in the US, in our DB, with a claim link that goes to the right person.

---

## 1 · Data sources, ranked

| Source | What's there | Cost | Difficulty |
|---|---|---|---|
| **Google Places API** *(enabled today)* | ~All small business listings — name, address, phone, website, lat/lng. Search "cattle ranch", "meat processor" near a zip. | $$ ~$32/1k searches above 28k free | ★ Easy |
| **USDA FSIS Establishment Directory** | Every USDA-inspected processor (~6,000), with state, address, phone, inspection types. **Authoritative.** | Free | ★ Easy (XLSX download) |
| **USDA AMS Local Food Directories** | Farmers markets, on-farm markets, CSAs, food hubs. National coverage, owner names sometimes included. | Free | ★ Easy (CSV) |
| **AAMP Member Directory** | ~1,000 small/mid processors, specialty plants. You already have a login. | Free w/ membership | ★★ Scrape gray, better to email AAMP for a partner data feed |
| **American Grassfed Association (AGA) members** | All AGA-certified producers. Perfect ICP. | Free | ★ Easy (public list) |
| **Animal Welfare Approved (AWA) directory** | ~3,000 high-welfare producers. | Free | ★ Easy |
| **Eat Wild** | Pasture-based farm directory, 1,500+ farms. | Free | ★ Easy |
| **Local Harvest** | Massive farm directory, search by zip. | Free | ★ Easy (HTML scrape) |
| **State extension office directories** | Every state has its own list of producers. Long tail but very high-fit. | Free | ★★★ State-by-state, no common format |
| **NASS Census of Agriculture** | Statistical only — counts, not contacts. Useful for sizing markets. | Free | n/a |

**My recommendation for v1 ingest order:**

1. **Google Places** for any zip your buyer enters (already wired today)
2. **USDA FSIS** bulk import → seeds every legal processor in the country (~6k rows, one CSV ingest)
3. **Eat Wild + AGA + AWA** directories → seeds the high-quality farms (~5k rows total)
4. **Local Harvest scrape** → backfills the long tail
5. State extensions only if growth stalls

---

## 2 · What's shipped today (May 4)

- **`discovered_partners` table** — staging row for every candidate partner with source, contact info, status flow (`new → queued → sent → clicked → signed_up`).
- **`invites` table** — every invite email tracked with Resend message ID + open/click/conversion status.
- **`/api/discover-nearby`** — POSTs into `discovered_partners`. Takes a zip + kind (farm or processor) + species. Calls Google Places API (New) Text Search across multiple queries, dedupes, persists. Free up to 28k Places loads/month.
- **`/api/invite-partner`** — accepts `{kind, name, email, phone?, message?, inviter_email}`, creates discovered + invites rows, sends a branded HTML email via Resend with personal claim link.
- **`/invite-partner.html`** — public page. Anyone can fill out the form to invite a farm or processor. Toggles between farm/processor. Pre-fills from auth + URL params.
- Resend invite email designed in PO brand voice with a personal note from the inviter and a "Claim your profile" CTA going to `/onboarding?as=producer&invite=...`

---

## 3 · The viral loop

Every order generates 0–N partner invites. We surface the prompt at three moments:

1. **Reserve confirmation page** *(/confirmed)* — "Want to pick up at a different processor? Invite them →"
2. **Account dashboard** *(/account)* — "Help us grow your area: invite a farm or butcher →"
3. **Listing detail** *(/listing)* — small footer link "Don't see your favorite farm? Suggest them"

Conversion intuition: ~2% of buyers will invite a processor in their first 30 days. With ~100 reservations/mo we'd get ~2 invites/mo from buyers alone. The admin discovery tool drives the rest.

---

## 4 · Admin discovery + outreach (next ship)

The `/admin-overview` page already pulls real metrics. Next:

- **Type a zip code → find nearby** widget. Calls `/api/discover-nearby?zip=XXXXX&kind=farm` and `&kind=processor`. Returns 20+ candidates, all with one-click "Send invite" buttons.
- **Bulk outreach** — select 50 candidates, generate personalized email content via Gemini ("Hey {name} at {farm}, we noticed you're a {practice} farm in {state} — here's how PO works…"), schedule via Resend.
- **Funnel metrics** — invites sent → opened → clicked → signed up → first listing posted.

---

## 5 · Compliance + sender reputation

**Don't blast unverified email addresses.** Resend will throttle and your sender reputation tanks fast.

Rules I'd set for outreach:
- Cap at 50 cold invites per day per sender domain for the first 14 days, ramp to 200/day over 30 days.
- One follow-up max per partner. After that, the partner is `dnc` until they engage.
- Always include physical mailing address + opt-out link (CAN-SPAM).
- Use `reply-to: hello@proteinoutfitters.com` so partner replies route to a human.
- Run new addresses through **NeverBounce** or **ZeroBounce** before sending — costs ~$3/1k addresses, saves your domain reputation.

---

## 6 · Other Google Cloud products worth using

| Product | Use |
|---|---|
| **Cloud Scheduler** | Cron the discovery + outreach jobs weekly. |
| **Cloud Storage** | Park USDA FSIS bulk Excel + AAMP scraped JSON for ingest. |
| **Vertex AI Vector Search** | Embed every farm/processor description, then "find me places that look like Northfield Pastures." Powerful for matching buyers to partners. |
| **BigQuery** | Once we have 50k+ records, BigQuery > Postgres for analytics. |
| **Document AI** | OCR scanned PDFs from state extension directories or paper rolodex. |
| **reCAPTCHA Enterprise** | Bot-protect the public `/invite-partner` form before we shred sender reputation. Free up to 10k/month. |

---

## 7 · 30-day execution plan

| Week | Ship |
|---|---|
| **1** | USDA FSIS bulk import + admin "find nearby" widget. Add invite CTA on `/confirmed`. Set up reCAPTCHA on `/invite-partner`. |
| **2** | Eat Wild + AGA + AWA scrapers (small scripts that run weekly via Cloud Scheduler). Bulk Gemini-personalized outreach (50/day cap). |
| **3** | Funnel dashboard on `/admin-overview`: invites sent, click rate, claim rate. State-level coverage map. |
| **4** | Local Harvest backfill. Auto-claim flow: when an invitee clicks the claim link, pre-fill the onboarding form from `discovered_partners.raw_data`. |

By end of month: ~12k partners staged in DB, ~2k invited, target 3-5% claim rate (60–100 active producers + processors).
