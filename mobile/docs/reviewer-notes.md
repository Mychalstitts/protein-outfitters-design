# App Store Reviewer Notes

Paste this into App Store Connect → App Information → Review Notes when you submit. A clear note dramatically reduces rejection rate — the reviewer is a real human who has minutes to figure out what your app does.

---

## Note to reviewer

Thank you for reviewing Protein Outfitters.

**What the app does:** Protein Outfitters is a directory and request platform for meat processors in the United States. Consumers browse a map of processors, see services and contact info, and submit a cut/service request. The processor receives the request by email and responds directly to the consumer.

**About the listings:** Listings are sourced from publicly available state meat processor association directories and our live directory. No personal information is shown for any processor — only the business contact information they have already published publicly. Processors can claim their listing (free) or request removal at any time via support@proteinoutfitters.com. The custom-exempt listing (Stittsworth Smokehouse Co.) stays on the map and is labeled “Custom-exempt / not claimable / already claimed / not sellable.”

**Sign-in is required to send a request or claim a listing.** Guests can browse the map and open processor details without an account. Guests cannot submit a request or claim a listing.

A reviewer can open the app and immediately:

1. Browse the map of processors
2. Search by name, city, or service
3. Tap any processor to see details

To send a request or claim a listing, sign in first (email magic link). There is no guest submit.

**Sign-in** uses an email magic link (same account as proteinoutfitters.com). Sign in with Apple is implemented but hidden in this build until the App ID capability is enabled — see the PR / EAS note for `EXPO_PUBLIC_SIWA_ENABLED`. After signing in, the user can:

- Send a cut request to a plant
- Claim an eligible listing
- Delete their account from the Account screen (in-app, not just by email — per guideline 5.1.1(v))

**Demo account (if needed):** demo@proteinoutfitters.com / [SET PASSWORD BEFORE SUBMISSION]

**Location permission:** the app asks for foreground (When In Use) location only, to center the map on the user. The user can decline — the app falls back to a US-wide view and works normally. There is no ZIP search UI and we do not request Always location.

**Encryption:** the app uses only standard HTTPS. We've declared `ITSAppUsesNonExemptEncryption: false` in the Info.plist.

**Privacy policy:** https://www.proteinoutfitters.com/policies/privacy
**Terms of service:** https://www.proteinoutfitters.com/policies/terms

If you have any questions, reply to the submission or email support@proteinoutfitters.com — we'll respond within an hour during business hours.

---

## Common questions reviewers ask, and our answers

**"Where does your data come from?"** State meat processor association directories and our live directory. Each listing's source is recorded when available (visible on the processor detail screen).

**"Have any processors complained?"** No — we honor removal requests within 7 days, and no current listing has been disputed. (Update this answer truthfully before submission.)

**"What's the business model?"** Free for consumers. Processors who claim their listing get a free profile. Paid features for processors (priority placement, analytics) are a future addition and not in this submission.

**"Is this medical or food safety advice?"** No. The app helps users find processors. We do not certify food safety, inspection status, or quality. Verifying those things is the user's responsibility, and we say so in the Terms.

**"Can children use this?"** The app is rated 12+ for occasional references to animal processing in service descriptions. We don't market to children.
