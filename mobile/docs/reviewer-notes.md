# App Store Reviewer Notes — CEO lock 2026-09-05 (sign-in required)

Paste into App Store Connect → Review Notes at submit.

**Holds before submit:**
1. Demo password — replace `[SET PASSWORD BEFORE SUBMISSION]` or delete the demo-account line. (Needs Mychal/ops.) Critical now that sign-in is required.
2. SLA is “we respond during business hours” — no “within an hour” unless ops proves it.
3. Custom-exempt pin `stittsworth-smokehouse-co` stays on the map. Buyer-facing badge: “Custom-exempt · not on the reserve marketplace.” Claim path: “Custom-exempt — not claimable.” (CTO PR #39 / #41 / Product YES).

Verified: offline bundle **472**; live map **2321**. Do **not** tell the reviewer “509.” Do **not** say the map is USDA-inspected (0 USDA inspection values live; offline all null).

---

## Note to reviewer

Thank you for reviewing Protein Outfitters.

**What the app does:** Protein Outfitters is a directory and request platform for meat processors in the United States. Consumers browse a map of processors, see services and contact info, and submit a service request. The processor receives the request by email and responds directly to the consumer.

**Sign-in required.** Submitting a service request and account features require Sign in with Apple (or the demo account below). There is **no guest request** path — please do not expect to send a request while signed out.

**How to review:**

1. Sign in with Apple, or use the demo account below
2. Browse the map
3. Search by name, city, or service
4. Open a processor detail screen
5. Submit a service request while signed in

After signing in, the user can track requests and delete their account from the Account screen (in-app — guideline 5.1.1(v)).

**About the listings:** Processor listings are sourced from publicly available state meat processor association directories (MAMP, IMPPA, WAMP, PAMP, IMPA — recorded on each listing where available). We show business contact information already published publicly. Processors can claim a listing (free) or request removal via support@proteinoutfitters.com.

The app ships with an offline seed of public listings and refreshes from our map API when online. Counts change as the directory grows — do not treat any single number in old docs as current.

**Inspection:** Listings may show state inspection (or other published status) when that data exists. Many pins have no inspection flag yet. Custom-exempt is never sold on our reserve marketplace. Do not treat every pin as USDA-inspected.

**Demo account:** demo@proteinoutfitters.com / [SET PASSWORD BEFORE SUBMISSION]

**Location permission:** foreground only, to center the map. Decline is fine — app falls back to a U.S.-wide view.

**Encryption:** standard HTTPS. `ITSAppUsesNonExemptEncryption: false`.

**Privacy:** https://www.proteinoutfitters.com/policies/privacy  
**Terms:** https://www.proteinoutfitters.com/policies/terms

Questions: support@proteinoutfitters.com — we respond during business hours.

---

## Common questions

**Where does the data come from?** State meat processor association directories. Source recorded when available.

**Have processors complained?** Update truthfully before submission. We honor removal requests.

**Business model?** Free for consumers. Free claim for processors. Paid processor features are not in this submission.

**Medical / food-safety advice?** No. We help users find processors. We do not certify inspection or quality.

**Children?** Rated 12+ for occasional animal-processing references. We do not market to children.
