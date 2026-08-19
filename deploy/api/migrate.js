// One-off migration endpoint. Run once after first deploy:
//   curl -X POST "https://www.proteinoutfitters.com/api/migrate?secret=$MIGRATE_SECRET"
//
// Requires MIGRATE_SECRET env var. Idempotent (CREATE TABLE IF NOT EXISTS).
import { rawQuery, err, json, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

const SCHEMA_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT,
    zip TEXT,
    role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer','producer','processor','admin')),
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS users_role_idx ON users(role)`,

  `CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS auth_tokens_email_idx ON auth_tokens(email)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`,

  `CREATE TABLE IF NOT EXISTS farms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    bio TEXT,
    story TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    practices TEXT[] DEFAULT '{}',
    certs TEXT[] DEFAULT '{}',
    identity TEXT[] DEFAULT '{}',
    cover_url TEXT,
    avatar_url TEXT,
    established_year INT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS farms_owner_idx ON farms(owner_id)`,
  `CREATE INDEX IF NOT EXISTS farms_state_idx ON farms(state)`,

  `CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    number TEXT,
    species TEXT NOT NULL CHECK (species IN ('cattle','hog','lamb','poultry','bison','goat','venison')),
    breed TEXT,
    sex TEXT,
    birth_date DATE,
    expected_finish_date DATE,
    current_weight INT,
    estimated_finish_weight INT,
    estimated_hanging_weight INT,
    price_per_lb DECIMAL(6,2),
    description TEXT,
    practice TEXT[] DEFAULT '{}',
    certs TEXT[] DEFAULT '{}',
    shares JSONB DEFAULT '{}'::jsonb,
    photos TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'active' CHECK (status IN ('draft','active','sold','donated','withdrawn')),
    donate_to_foodbank BOOLEAN DEFAULT FALSE,
    donation_recipient_org TEXT,
    instant_reserve BOOLEAN DEFAULT TRUE,
    view_count INT DEFAULT 0,
    save_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS listings_farm_idx ON listings(farm_id)`,
  `CREATE INDEX IF NOT EXISTS listings_species_idx ON listings(species)`,
  `CREATE INDEX IF NOT EXISTS listings_status_idx ON listings(status)`,
  `CREATE INDEX IF NOT EXISTS listings_finish_idx ON listings(expected_finish_date)`,

  `CREATE TABLE IF NOT EXISTS processors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id),
    slug TEXT UNIQUE,
    name TEXT NOT NULL,
    city TEXT,
    state TEXT,
    zip TEXT,
    inspection TEXT CHECK (inspection IN ('usda','state','custom-exempt','equal-to')),
    capabilities JSONB DEFAULT '{}'::jsonb,
    base_fees JSONB DEFAULT '{}'::jsonb,
    per_lb_fees JSONB DEFAULT '{}'::jsonb,
    schedule JSONB DEFAULT '{}'::jsonb,
    date_overrides JSONB DEFAULT '{}'::jsonb,
    cover_url TEXT,
    avatar_url TEXT,
    bio TEXT,
    certs TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id UUID REFERENCES users(id),
    buyer_email TEXT NOT NULL,
    buyer_phone TEXT,
    buyer_name TEXT,
    share_size TEXT NOT NULL CHECK (share_size IN ('whole','half','quarter','eighth')),
    cut_sheet JSONB,
    processor_id UUID REFERENCES processors(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','deposit-paid','paid','processing','ready','picked-up','cancelled','refunded')),
    total_estimate DECIMAL(10,2),
    deposit_amount DECIMAL(10,2),
    notes TEXT,
    pickup_date DATE,
    stripe_payment_intent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS reservations_buyer_idx ON reservations(buyer_id)`,
  `CREATE INDEX IF NOT EXISTS reservations_listing_idx ON reservations(listing_id)`,
  `CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status)`,

  `CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES users(id),
    reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('buyer','farmer','processor')),
    subject_type TEXT NOT NULL CHECK (subject_type IN ('farm','processor','buyer')),
    subject_id UUID,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    body TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    revealed_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS reviews_reservation_idx ON reviews(reservation_id)`,
  `CREATE INDEX IF NOT EXISTS reviews_subject_idx ON reviews(subject_type, subject_id)`,

  `CREATE TABLE IF NOT EXISTS donations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID REFERENCES listings(id),
    donor_id UUID REFERENCES users(id),
    recipient_org TEXT,
    estimated_lb INT,
    fmv DECIMAL(10,2),
    tax_letter_sent BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'pledged' CHECK (status IN ('pledged','processing','delivered','receipted','cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS donations_donor_idx ON donations(donor_id)`,

  `CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT,
    filters JSONB NOT NULL,
    notify_email BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Discovered candidates from Places API / USDA FSIS / AAMP / Eat Wild — staging
  // until they sign up and claim a real farm/processor row.
  `CREATE TABLE IF NOT EXISTS discovered_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('farm','processor')),
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    phone TEXT,
    email TEXT,
    website TEXT,
    species TEXT[],
    source TEXT NOT NULL CHECK (source IN ('places','fsis','aamp','eatwild','customer','manual')),
    source_ref TEXT,
    raw_data JSONB,
    invite_status TEXT NOT NULL DEFAULT 'new' CHECK (invite_status IN ('new','queued','sent','bounced','clicked','signed_up','declined','dnc')),
    invited_by UUID REFERENCES users(id),
    invited_at TIMESTAMPTZ,
    signed_up_user UUID REFERENCES users(id),
    signed_up_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, source_ref)
  )`,
  `CREATE INDEX IF NOT EXISTS discovered_partners_state_idx ON discovered_partners(state)`,
  `CREATE INDEX IF NOT EXISTS discovered_partners_kind_idx ON discovered_partners(kind)`,
  `CREATE INDEX IF NOT EXISTS discovered_partners_status_idx ON discovered_partners(invite_status)`,
  `CREATE INDEX IF NOT EXISTS discovered_partners_geo_idx ON discovered_partners(lat, lng)`,

  // Audit trail of every invite sent (so a partner can be invited by multiple people)
  `CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovered_id UUID REFERENCES discovered_partners(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('farm','processor')),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    inviter_user_id UUID REFERENCES users(id),
    inviter_email TEXT,
    inviter_name TEXT,
    message TEXT,
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','manual')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','converted','failed')),
    resend_message_id TEXT,
    converted_user_id UUID REFERENCES users(id),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS invites_email_idx ON invites(email)`,
  `CREATE INDEX IF NOT EXISTS invites_inviter_idx ON invites(inviter_user_id)`,
  `CREATE INDEX IF NOT EXISTS invites_status_idx ON invites(status)`,

  // ──────────────────────────────────────────────────────────
  // Stripe Connect — split-routing groundwork.
  // Each farm + processor + institution can connect their own
  // Stripe account (via Stripe Connect Express). Once connected,
  // /api/checkout uses transfer_group + Transfer to pay them
  // their share of each reservation. `stripe_connect_status`
  // tracks onboarding ('pending' | 'restricted' | 'active' | 'disabled').
  // ──────────────────────────────────────────────────────────
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`,
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT DEFAULT 'pending'`,
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`,
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT DEFAULT 'pending'`,

  // Institutions (Donation Depot recipients). Originally bootstrapped on
  // first /api/institutions call; pulled in here so /admin-health doesn't
  // flag it as missing.
  `CREATE TABLE IF NOT EXISTS institutions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL CHECK (type IN ('school','government','foodbank','tribal','veterans','other')),
    legal_name      TEXT NOT NULL,
    ein             TEXT,
    state           TEXT,
    address         TEXT,
    contact_name    TEXT,
    contact_title   TEXT,
    contact_email   TEXT NOT NULL,
    contact_phone   TEXT,
    people_per_week INT,
    storage         TEXT CHECK (storage IN ('freezer','reach-in','cooler','distribution')),
    species         JSONB DEFAULT '[]'::jsonb,
    pickup          TEXT CHECK (pickup IN ('self','delivery','depot')),
    determination_doc_url TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','suspended')),
    verified_at     TIMESTAMPTZ,
    lbs_received_ytd NUMERIC DEFAULT 0,
    submitted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS institutions_status_idx ON institutions(status)`,
  `CREATE INDEX IF NOT EXISTS institutions_state_idx ON institutions(state)`,
  `ALTER TABLE institutions ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`,

  // Complaints — buyer quality flags, bootstrapped lazily by /api/complaint.
  `CREATE TABLE IF NOT EXISTS complaints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
    buyer_email    TEXT,
    buyer_name     TEXT,
    summary        TEXT NOT NULL,
    detail         TEXT,
    photos         JSONB DEFAULT '[]'::jsonb,
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
    resolution     TEXT,
    refund_cents   INT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints(status)`,
  `CREATE INDEX IF NOT EXISTS complaints_reservation_idx ON complaints(reservation_id)`,

  // Reservation-level Stripe linkage for Connect transfers.
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS stripe_transfer_group TEXT`,
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS application_fee_amount NUMERIC`,

  `CREATE INDEX IF NOT EXISTS farms_stripe_idx     ON farms(stripe_account_id)`,
  `CREATE INDEX IF NOT EXISTS processors_stripe_idx ON processors(stripe_account_id)`,
  `CREATE INDEX IF NOT EXISTS reservations_transfer_idx ON reservations(stripe_transfer_group)`,

  // ──────────────────────────────────────────────────────────
  // Dropoff deposit + processor-only QR check-in.
  // bookings        : explicit booking row per farmer×processor×date
  // farmer_deposits : deposit hold per booking, flips on check-in or no-show
  // checkin_codes   : single-use 6-digit codes the processor enters at scan time
  // ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bookings (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
     farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
     processor_id    UUID NOT NULL REFERENCES processors(id) ON DELETE RESTRICT,
     drop_off_date   DATE NOT NULL,
     drop_off_window TEXT,
     status          TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','checked-in','no-show','cancelled','rejected')),
     checked_in_at   TIMESTAMPTZ,
     checked_in_by   UUID REFERENCES users(id),
     no_show_at      TIMESTAMPTZ,
     notes           TEXT,
     created_at      TIMESTAMPTZ DEFAULT NOW(),
     updated_at      TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS bookings_listing_idx   ON bookings(listing_id)`,
  `CREATE INDEX IF NOT EXISTS bookings_processor_idx ON bookings(processor_id)`,
  `CREATE INDEX IF NOT EXISTS bookings_dropoff_idx   ON bookings(drop_off_date)`,
  `CREATE INDEX IF NOT EXISTS bookings_status_idx    ON bookings(status)`,

  `CREATE TABLE IF NOT EXISTS farmer_deposits (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     booking_id      UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
     farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
     amount          NUMERIC(10,2) NOT NULL,
     stripe_payment_intent TEXT,
     status          TEXT NOT NULL DEFAULT 'held'
                     CHECK (status IN ('held','released','forfeit','refunded')),
     released_at     TIMESTAMPTZ,
     forfeit_at      TIMESTAMPTZ,
     created_at      TIMESTAMPTZ DEFAULT NOW(),
     updated_at      TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS farmer_deposits_status_idx ON farmer_deposits(status)`,

  `CREATE TABLE IF NOT EXISTS checkin_codes (
     code            TEXT PRIMARY KEY,
     booking_id      UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
     consumed_at     TIMESTAMPTZ,
     consumed_by     UUID REFERENCES users(id),
     created_at      TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS checkin_codes_booking_idx ON checkin_codes(booking_id)`,

  // ──────────────────────────────────────────────────────────
  // Listing detail polish — feed type, sub-breed, sex detail.
  // Existing `sex` column kept (free text) for compatibility.
  // sex_detail is the structured species-aware enum.
  // ──────────────────────────────────────────────────────────
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS feed_type        TEXT`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS finish_feed      TEXT`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS subbreed         TEXT`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS sex_detail       TEXT`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS antibiotics      TEXT`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS hormones         TEXT`,

  // ──────────────────────────────────────────────────────────
  // Referral codes — per-user invite codes, redemption ledger.
  // ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS referral_codes (
     code            TEXT PRIMARY KEY,
     owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at      TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS referral_codes_owner_idx ON referral_codes(owner_user_id)`,

  `CREATE TABLE IF NOT EXISTS referral_redemptions (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     code            TEXT NOT NULL REFERENCES referral_codes(code) ON DELETE CASCADE,
     redeemed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
     redeemed_email  TEXT,
     reservation_id  UUID REFERENCES reservations(id) ON DELETE SET NULL,
     reward_amount   NUMERIC(10,2),
     reward_status   TEXT NOT NULL DEFAULT 'pending'
                     CHECK (reward_status IN ('pending','credited','denied','reversed')),
     created_at      TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS referral_redemptions_code_idx ON referral_redemptions(code)`,
  `CREATE INDEX IF NOT EXISTS referral_redemptions_user_idx ON referral_redemptions(redeemed_by)`,

  // ──────────────────────────────────────────────────────────
  // Donation funding ledger.
  // donation_funds        : incoming money — grants, corporate sponsors, individual gifts.
  // donation_disbursements: outgoing money — kill fees + processing fees paid to processors
  //                          when a donated fraction is processed.
  // The legal-entity decision (Producer Partnership pass-through vs MN sister 501(c)(3))
  // doesn't change this schema — it just changes which bank account the money sits in.
  // ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS donation_funds (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     source_type      TEXT NOT NULL CHECK (source_type IN ('grant','corporate','individual','platform','match')),
     source_name      TEXT,
     contact_email    TEXT,
     amount           NUMERIC(10,2) NOT NULL,
     currency         TEXT DEFAULT 'usd',
     designation      TEXT,
     status           TEXT NOT NULL DEFAULT 'pledged'
                      CHECK (status IN ('pledged','received','disbursed','refunded','cancelled')),
     stripe_payment_intent TEXT,
     received_at      TIMESTAMPTZ,
     received_by      UUID REFERENCES users(id) ON DELETE SET NULL,
     notes            TEXT,
     created_at       TIMESTAMPTZ DEFAULT NOW(),
     updated_at       TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS donation_funds_source_idx ON donation_funds(source_type)`,
  `CREATE INDEX IF NOT EXISTS donation_funds_status_idx ON donation_funds(status)`,

  `CREATE TABLE IF NOT EXISTS donation_disbursements (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     donation_id      UUID NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
     processor_id     UUID REFERENCES processors(id) ON DELETE SET NULL,
     amount           NUMERIC(10,2) NOT NULL,
     category         TEXT NOT NULL CHECK (category IN ('kill_fee','processing','transport','other')),
     stripe_transfer_id TEXT,
     status           TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','reversed','failed')),
     notes            TEXT,
     created_at       TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS donation_disbursements_donation_idx ON donation_disbursements(donation_id)`,
  `CREATE INDEX IF NOT EXISTS donation_disbursements_status_idx ON donation_disbursements(status)`,

  // ──────────────────────────────────────────────────────────
  // Hardware leads — quote-form submissions from /hardware.
  // Scored automatically on insert; webhook to CRM (HubSpot/Pipedrive/etc.)
  // is fire-and-forget if HARDWARE_CRM_WEBHOOK_URL env var is set.
  // ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS hardware_leads (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     full_name       TEXT NOT NULL,
     email           TEXT NOT NULL,
     phone           TEXT,
     role            TEXT,
     state           TEXT,
     existing_facility TEXT CHECK (existing_facility IN ('yes','no','unknown')),
     timeline        TEXT CHECK (timeline IN ('0-3m','3-6m','6-12m','12+m','exploring','unknown')),
     financing_help  BOOLEAN DEFAULT FALSE,
     bundle_interest TEXT,
     notes           TEXT,
     score           INT NOT NULL DEFAULT 0,
     temperature     TEXT NOT NULL DEFAULT 'cold' CHECK (temperature IN ('hot','warm','cold')),
     status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','disqualified','closed_won','closed_lost')),
     crm_synced_at   TIMESTAMPTZ,
     crm_external_id TEXT,
     created_at      TIMESTAMPTZ DEFAULT NOW(),
     updated_at      TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS hardware_leads_status_idx ON hardware_leads(status)`,
  `CREATE INDEX IF NOT EXISTS hardware_leads_temp_idx   ON hardware_leads(temperature)`,
  `CREATE INDEX IF NOT EXISTS hardware_leads_email_idx  ON hardware_leads(email)`,

  // ──────────────────────────────────────────────────────────
  // notifications: in-app inbox. One row per delivered lifecycle
  // event. The bell icon in po-shell reads unread count from here.
  // Email send is best-effort and orthogonal — the notifications
  // table is the canonical record of "the user was told."
  // ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_email  TEXT NOT NULL,
     kind        TEXT NOT NULL,
     title       TEXT NOT NULL,
     body        TEXT,
     link_url    TEXT,
     icon        TEXT,
     dedup_key   TEXT UNIQUE,
     read_at     TIMESTAMPTZ,
     created_at  TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS notifications_email_idx   ON notifications(user_email)`,
  `CREATE INDEX IF NOT EXISTS notifications_unread_idx  ON notifications(user_email) WHERE read_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications(created_at DESC)`,

  // ──────────────────────────────────────────────────────────
  // processor_subscriptions: SaaS tier per processor. Stripe
  // Subscription is the source of truth; we mirror status here so
  // the dashboard can gate features without a Stripe round-trip.
  // ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS processor_subscriptions (
     id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     processor_id         UUID REFERENCES processors(id) ON DELETE CASCADE,
     tier                 TEXT NOT NULL CHECK (tier IN ('free','standard','premium')),
     cadence              TEXT CHECK (cadence IN ('monthly','annual')),
     stripe_customer_id   TEXT,
     stripe_subscription_id TEXT UNIQUE,
     stripe_price_id      TEXT,
     status               TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete','trialing','active','past_due','canceled','unpaid')),
     current_period_end   TIMESTAMPTZ,
     cancel_at_period_end BOOLEAN DEFAULT FALSE,
     created_at           TIMESTAMPTZ DEFAULT NOW(),
     updated_at           TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS proc_sub_processor_idx ON processor_subscriptions(processor_id)`,
  `CREATE INDEX IF NOT EXISTS proc_sub_status_idx    ON processor_subscriptions(status)`,

  // Disputes — Stripe charge.dispute.* events land here. Originally
  // bootstrapped on the first webhook event; pulled in so admin-health
  // shows it as ready immediately.
  `CREATE TABLE IF NOT EXISTS disputes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_dispute_id TEXT UNIQUE NOT NULL,
    stripe_charge_id  TEXT,
    stripe_payment_intent TEXT,
    reservation_id  UUID REFERENCES reservations(id) ON DELETE SET NULL,
    reason          TEXT,
    status          TEXT,
    amount          NUMERIC,
    currency        TEXT,
    evidence_due    TIMESTAMPTZ,
    response_status TEXT,
    raw             JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes(status)`,
  `CREATE INDEX IF NOT EXISTS disputes_pi_idx ON disputes(stripe_payment_intent)`,

  // Email log — every lifecycle email send is recorded here for idempotency
  // and auditing. Originally bootstrapped lazily by /api/_lib/email.js;
  // pulled in here so admin-health doesn't flag it as missing pre-first-send.
  `CREATE TABLE IF NOT EXISTS email_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  TEXT NOT NULL,
    to_email     TEXT NOT NULL,
    subject      TEXT,
    dedup_key    TEXT,
    reservation_id UUID,
    listing_id   UUID,
    farm_id      UUID,
    processor_id UUID,
    institution_id UUID,
    status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','skipped','failed','queued')),
    provider     TEXT NOT NULL DEFAULT 'resend',
    provider_id  TEXT,
    error        TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS email_log_template_idx ON email_log(template_id)`,
  `CREATE INDEX IF NOT EXISTS email_log_dedup_idx    ON email_log(dedup_key)`,
  `CREATE INDEX IF NOT EXISTS email_log_to_idx       ON email_log(to_email)`,

  // ──────────────────────────────────────────────────────────
  // Geocoding — lat/lng on farms + processors + a shared cache.
  // Resolved server-side via Nominatim (free, no API key) the first
  // time we see a city/state/zip; cached in geocode_cache so we never
  // re-fetch. Powers /map (farms, processors, demand, opportunity).
  // ──────────────────────────────────────────────────────────
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`,
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`,
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`,
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`,

  `CREATE TABLE IF NOT EXISTS geocode_cache (
    query_key   TEXT PRIMARY KEY,         -- normalized lower-case "city, state, zip"
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL,
    display     TEXT,
    source      TEXT NOT NULL DEFAULT 'nominatim',
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ──────────────────────────────────────────────────────────
  // Referral activation — store code that got the buyer here, plus the
  // credit balance that's accumulated from successful referrals + redemptions.
  // Crediting logic lives in stripe-webhook.js when checkout.session.completed
  // fires for the buyer's first paid reservation; consumption logic lives in
  // checkout.js (deposit is reduced by available credit, capped at deposit-1
  // so Stripe still has a non-zero payment to charge).
  // ──────────────────────────────────────────────────────────
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_credit_cents INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS users_referred_by_code_idx ON users(referred_by_code)`,

  // ──────────────────────────────────────────────────────────
  // Web Push subscriptions — endpoint + keys per device, opt-in only.
  // VAPID auth + push send happens server-side via /api/push-send.
  // ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT UNIQUE NOT NULL,
    p256dh      TEXT NOT NULL,
    auth_key    TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id)`,

  // ── Processor SaaS: plant-floor workflow (added 24 Jul 2026) ──────────────
  // The original bookings CHECK stopped at 'checked-in', so an animal could be
  // dropped off and then never move. Widen it to the full floor sequence that
  // PATCH /api/bookings drives. Idempotent: drop then re-add.
  `ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check`,
  `ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
     CHECK (status IN ('scheduled','checked-in','fabricating','ready','picked-up','no-show','cancelled','rejected'))`,
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hanging_weight_lbs     NUMERIC(8,2)`,
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fabrication_started_at TIMESTAMPTZ`,
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ready_at               TIMESTAMPTZ`,
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS picked_up_at           TIMESTAMPTZ`,

  // cut_sheets existed in production but had no DDL anywhere in the repo — a
  // fresh environment came up without it. Now it is declared here.
  `CREATE TABLE IF NOT EXISTS cut_sheets (
     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     reservation_id UUID NOT NULL,
     buyer_id       UUID,
     processor_id   UUID,
     species        TEXT NOT NULL,
     cuts           JSONB NOT NULL DEFAULT '[]'::jsonb,
     pills          JSONB NOT NULL DEFAULT '[]'::jsonb,
     quarter        TEXT,
     notes          TEXT,
     status         TEXT NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('draft','submitted','accepted','rejected')),
     submitted_at   TIMESTAMPTZ DEFAULT NOW(),
     updated_at     TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS cut_sheets_reservation_idx ON cut_sheets(reservation_id)`,
  `CREATE INDEX IF NOT EXISTS cut_sheets_processor_idx   ON cut_sheets(processor_id)`,
  `CREATE INDEX IF NOT EXISTS cut_sheets_buyer_idx       ON cut_sheets(buyer_id)`,
  `CREATE INDEX IF NOT EXISTS cut_sheets_status_idx      ON cut_sheets(status)`,

  // credentials.html has always PATCHed these; the column never existed, so
  // every uploaded inspection document was silently discarded.
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS credentials_docs JSONB DEFAULT '{}'::jsonb`,
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS credentials_docs JSONB DEFAULT '{}'::jsonb`,

  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS address       TEXT`,
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS phone         TEXT`,
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS email         TEXT`,
  `ALTER TABLE processors ADD COLUMN IF NOT EXISTS website       TEXT`,
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS address       TEXT`,
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS phone         TEXT`,
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS email         TEXT`,
  `ALTER TABLE farms      ADD COLUMN IF NOT EXISTS website       TEXT`,

  // ── Social layer (journey-first + profile walls) ─────────────────────────
  `CREATE TABLE IF NOT EXISTS farm_follows (
     user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     farm_id    UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_id, farm_id)
   )`,
  `CREATE INDEX IF NOT EXISTS farm_follows_farm_idx ON farm_follows(farm_id)`,

  `CREATE TABLE IF NOT EXISTS entity_follows (
     user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     subject_type TEXT NOT NULL CHECK (subject_type IN ('farm','processor')),
     subject_id   UUID NOT NULL,
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_id, subject_type, subject_id)
   )`,
  `CREATE INDEX IF NOT EXISTS entity_follows_subject_idx ON entity_follows(subject_type, subject_id)`,

  `CREATE TABLE IF NOT EXISTS social_posts (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     author_id    UUID REFERENCES users(id) ON DELETE SET NULL,
     subject_type TEXT NOT NULL CHECK (subject_type IN ('farm','processor','listing','user')),
     subject_id   UUID NOT NULL,
     listing_id   UUID REFERENCES listings(id) ON DELETE CASCADE,
     kind         TEXT NOT NULL DEFAULT 'update'
                  CHECK (kind IN ('update','photo','milestone','thanks')),
     milestone    TEXT,
     body         TEXT,
     media_urls   TEXT[] DEFAULT '{}',
     visibility   TEXT NOT NULL DEFAULT 'public'
                  CHECK (visibility IN ('public','followers','participants')),
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     updated_at   TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS social_posts_subject_idx ON social_posts(subject_type, subject_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS social_posts_listing_idx ON social_posts(listing_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS social_posts_author_idx ON social_posts(author_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS social_reactions (
     post_id    UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
     user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     emoji      TEXT NOT NULL DEFAULT 'heart'
                CHECK (emoji IN ('heart','fire','clap','pray')),
     created_at TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (post_id, user_id, emoji)
   )`,
  `CREATE INDEX IF NOT EXISTS social_reactions_post_idx ON social_reactions(post_id)`,

  `CREATE TABLE IF NOT EXISTS social_comments (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     post_id    UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
     author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     body       TEXT NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS social_comments_post_idx ON social_comments(post_id, created_at)`,

];

const SEED_SQL = [
  `INSERT INTO users (email, name, role, zip)
   VALUES
     ('demo-farmer@proteinoutfitters.com',    'Demo Farmer',    'producer',  '56601'),
     ('demo-buyer@proteinoutfitters.com',     'Demo Buyer',     'buyer',     '56601'),
     ('demo-processor@proteinoutfitters.com', 'Demo Processor', 'processor', '56601')
   ON CONFLICT (email) DO NOTHING`,

  `INSERT INTO farms (owner_id, slug, name, bio, city, state, zip, practices, certs, identity, established_year)
   SELECT id, 'northfield-pastures', 'Northfield Pastures',
     '4th-generation regenerative cattle ranch in northern Minnesota.',
     'Bemidji', 'MN', '56601',
     ARRAY['grass-fed','regenerative'], ARRAY['organic','aga','amwa'], ARRAY['family'], 1962
   FROM users WHERE email='demo-farmer@proteinoutfitters.com'
   ON CONFLICT (slug) DO NOTHING`,

  `INSERT INTO farms (owner_id, slug, name, bio, city, state, zip, practices, certs, identity, established_year)
   SELECT id, 'twin-pines-ranch', 'Twin Pines Ranch',
     'Veteran-owned 200-head Hereford operation. Family farm since 1948.',
     'Bagley', 'MN', '56621',
     ARRAY['grass-fed'], ARRAY['amwa','usda-insp'], ARRAY['veteran','family'], 1948
   FROM users WHERE email='demo-farmer@proteinoutfitters.com'
   ON CONFLICT (slug) DO NOTHING`,

  // Demo ACTIVE listings are intentionally not seeded.
  // Catalog must stay empty of demo animals (Northfield / Twin Pines).
];

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const secret = url.searchParams.get('secret');
  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return err(401, 'Unauthorized — set MIGRATE_SECRET env var and pass ?secret=...');
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return err(405, 'Method not allowed');
  }

  const ranSchema = [];
  const failedSchema = [];
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await rawQuery(stmt);
      ranSchema.push(stmt.slice(0, 80).replace(/\s+/g, ' '));
    } catch (e) {
      // Don't abort — log and continue. Individual failures (e.g. ALTER on a
      // table that doesn't exist yet because it bootstraps elsewhere) shouldn't
      // block the rest of the schema from migrating.
      failedSchema.push({
        stmt: stmt.slice(0, 120).replace(/\s+/g, ' '),
        error: String(e.message || e).slice(0, 200),
      });
    }
  }

  const ranSeed = [];
  if (url.searchParams.get('seed') === 'true') {
    for (const stmt of SEED_SQL) {
      try {
        await rawQuery(stmt);
        ranSeed.push(stmt.slice(0, 80).replace(/\s+/g, ' '));
      } catch (e) {
        ranSeed.push(`FAILED: ${String(e).slice(0, 150)}`);
      }
    }
  }

  return json({
    ok: failedSchema.length === 0,
    schemaStatements: ranSchema.length,
    schemaFailed: failedSchema.length,
    seedStatements: ranSeed.length,
    schema: ranSchema,
    failed: failedSchema,
    seed: ranSeed,
  });
}

export default nodejsHandler(handler);
