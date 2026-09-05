# App Store Reviewer Notes

Paste this into App Store Connect → App Information → Review Notes when you submit. A clear note dramatically reduces rejection rate — the reviewer is a real human who has minutes to figure out what your app does.

---

## Note to reviewer

Thank you for reviewing Protein Outfitters.

**What the app does:** Protein Outfitters is a directory and request platform for meat processors in the United States. Consumers (people who buy half/whole animals from ranchers, hunters, or anyone wanting USDA-inspected local meat) browse a map of processors, see services and contact info, and submit a service request. The processor receives the request by email and responds directly to the consumer.

**About the listings:** All 509 processor listings shown in the app are sourced from publicly available state meat processor association directories (MAMP, IMPPA, WAMP, PAMP, IMPA — all listed in each processor's record). No personal information is shown for any processor — only the business contact information they have already published publicly. Processors can claim their listing (free) or request removal at any time via support@proteinoutfitters.com.

**No sign-in required to use the core feature.** A reviewer can open the app and immediately:

1. Browse the map of 509 processors
2. Search by name, city, or service
3. Tap any processor to see details
4. Submit a service request without creating an account

**Optional sign-in** uses Sign in with Apple. After signing in, the user can:

- Track their submitted requests
- Delete their account from the Account screen (in-app, not just by email — per guideline 5.1.1(v))

**Demo account (if needed):** demo@proteinoutfitters.com / [SET PASSWORD BEFORE SUBMISSION]

**Location permission:** the app asks for foreground location only, to center the map on the user. The user can decline — the app falls back to a US-wide view and works normally.

**Encryption:** the app uses only standard HTTPS via Supabase. We've declared `ITSAppUsesNonExemptEncryption: false` in the Info.plist.

**Privacy policy:** https://proteinoutfitters.com/privacy
**Terms of service:** https://proteinoutfitters.com/terms

If you have any questions, reply to the submission or email support@proteinoutfitters.com — we'll respond within an hour during business hours.

---

## Common questions reviewers ask, and our answers

**"Where does your data come from?"** State meat processor association directories. Each listing's source is recorded in the database (visible at the bottom of the processor detail screen).

**"Have any processors complained?"** No — we honor removal requests within 7 days, and no current listing has been disputed. (Update this answer truthfully before submission.)

**"What's the business model?"** Free for consumers. Processors who claim their listing get a free profile with response tools. Paid features for processors (priority placement, analytics) are a future addition and not in this submission.

**"Is this medical or food safety advice?"** No. The app helps users find processors. We do not certify food safety, inspection status, or quality. Verifying those things is the user's responsibility, and we say so in the Terms.

**"Can children use this?"** The app is rated 12+ for occasional references to animal processing in service descriptions. We don't market to children.
