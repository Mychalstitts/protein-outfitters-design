-- =============================================================
-- Protein Outfitters — Database schema
-- =============================================================
-- Single Postgres DB on Neon (free tier). Tables:
--   users        — buyers, producers, processors, admins (role-based)
--   auth_tokens  — single-use magic-link tokens
--   sessions     — server-side session records (cookie value = id)
--   farms        — producer profiles (one or more per user with role=producer)
--   listings     — animals for sale
--   reservations — buyer holds against listings
--   processors   — meat processors with capabilities & schedule
--   reviews      — three-way mutual reveal reviews
--   donations    — animal donations to food bank 501(c)(3)
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  phone       TEXT,
  zip         TEXT,
  role        TEXT NOT NULL DEFAULT 'buyer'
              CHECK (role IN ('buyer','producer','processor','admin')),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);

-- ─── AUTH TOKENS (magic links) ─────────────────────────────
CREATE TABLE IF NOT EXISTS auth_tokens (
  token        TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_tokens_email_idx ON auth_tokens(email);

-- ─── SESSIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- ─── FARMS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  bio         TEXT,
  story       TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  practices   TEXT[] DEFAULT '{}',
  certs       TEXT[] DEFAULT '{}',
  identity    TEXT[] DEFAULT '{}',
  cover_url   TEXT,
  avatar_url  TEXT,
  established_year INT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS farms_owner_idx ON farms(owner_id);
CREATE INDEX IF NOT EXISTS farms_state_idx ON farms(state);

-- ─── LISTINGS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id         UUID REFERENCES farms(id) ON DELETE CASCADE,
  number          TEXT,
  species         TEXT NOT NULL CHECK (species IN ('cattle','hog','lamb','poultry','bison','goat','venison')),
  breed           TEXT,
  sex             TEXT,
  birth_date      DATE,
  expected_finish_date DATE,
  current_weight  INT,
  estimated_finish_weight INT,
  estimated_hanging_weight INT,
  price_per_lb    DECIMAL(6,2),
  description     TEXT,
  practice        TEXT[] DEFAULT '{}',
  certs           TEXT[] DEFAULT '{}',
  -- shares: {whole:{available:N,reserved:N,price:N}, half:{...}, quarter:{...}}
  shares          JSONB DEFAULT '{}'::jsonb,
  photos          TEXT[] DEFAULT '{}',
  status          TEXT DEFAULT 'active'
                  CHECK (status IN ('draft','active','sold','donated','withdrawn')),
  donate_to_foodbank BOOLEAN DEFAULT FALSE,
  donation_recipient_org TEXT,
  instant_reserve BOOLEAN DEFAULT TRUE,
  view_count      INT DEFAULT 0,
  save_count      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS listings_farm_idx ON listings(farm_id);
CREATE INDEX IF NOT EXISTS listings_species_idx ON listings(species);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings(status);
CREATE INDEX IF NOT EXISTS listings_finish_idx ON listings(expected_finish_date);

-- ─── RESERVATIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    UUID REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id      UUID REFERENCES users(id),
  buyer_email   TEXT NOT NULL,
  buyer_phone   TEXT,
  buyer_name    TEXT,
  share_size    TEXT NOT NULL CHECK (share_size IN ('whole','half','quarter','eighth')),
  cut_sheet     JSONB,
  processor_id  UUID,
  status        TEXT DEFAULT 'pending'
                CHECK (status IN ('pending','deposit-paid','paid','processing','ready','picked-up','cancelled','refunded')),
  total_estimate DECIMAL(10,2),
  deposit_amount DECIMAL(10,2),
  notes         TEXT,
  pickup_date   DATE,
  stripe_payment_intent TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reservations_buyer_idx ON reservations(buyer_id);
CREATE INDEX IF NOT EXISTS reservations_listing_idx ON reservations(listing_id);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status);

-- ─── PROCESSORS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID REFERENCES users(id),
  slug          TEXT UNIQUE,
  name          TEXT NOT NULL,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  inspection    TEXT CHECK (inspection IN ('usda','state','custom-exempt','equal-to')),
  capabilities  JSONB DEFAULT '{}'::jsonb,
  base_fees     JSONB DEFAULT '{}'::jsonb,
  per_lb_fees   JSONB DEFAULT '{}'::jsonb,
  schedule      JSONB DEFAULT '{}'::jsonb,
  date_overrides JSONB DEFAULT '{}'::jsonb,
  cover_url     TEXT,
  avatar_url    TEXT,
  bio           TEXT,
  certs         TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_processor_fk,
  ADD CONSTRAINT reservations_processor_fk
  FOREIGN KEY (processor_id) REFERENCES processors(id) ON DELETE SET NULL;

-- ─── REVIEWS (mutual-reveal) ───────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  reviewer_id    UUID REFERENCES users(id),
  reviewer_role  TEXT NOT NULL CHECK (reviewer_role IN ('buyer','farmer','processor')),
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('farm','processor','buyer')),
  subject_id     UUID,
  rating         INT CHECK (rating BETWEEN 1 AND 5),
  body           TEXT,
  submitted_at   TIMESTAMPTZ DEFAULT NOW(),
  revealed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reviews_reservation_idx ON reviews(reservation_id);
CREATE INDEX IF NOT EXISTS reviews_subject_idx ON reviews(subject_type, subject_id);

-- ─── DONATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS donations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     UUID REFERENCES listings(id),
  donor_id       UUID REFERENCES users(id),
  recipient_org  TEXT,
  estimated_lb   INT,
  fmv            DECIMAL(10,2),
  tax_letter_sent BOOLEAN DEFAULT FALSE,
  status         TEXT DEFAULT 'pledged'
                 CHECK (status IN ('pledged','processing','delivered','receipted','cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS donations_donor_idx ON donations(donor_id);

-- ─── SAVED SEARCHES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_searches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT,
  filters     JSONB NOT NULL,
  notify_email BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SOCIAL LAYER (journey-first + profile walls) ──────────
CREATE TABLE IF NOT EXISTS farm_follows (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id    UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, farm_id)
);
CREATE INDEX IF NOT EXISTS farm_follows_farm_idx ON farm_follows(farm_id);

CREATE TABLE IF NOT EXISTS entity_follows (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('farm','processor')),
  subject_id   UUID NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS entity_follows_subject_idx ON entity_follows(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS social_posts (
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
);
CREATE INDEX IF NOT EXISTS social_posts_subject_idx ON social_posts(subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_posts_listing_idx ON social_posts(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_posts_author_idx ON social_posts(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS social_reactions (
  post_id    UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL DEFAULT 'heart'
             CHECK (emoji IN ('heart','fire','clap','pray')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS social_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_comments_post_idx ON social_comments(post_id, created_at);

-- ─── SEED DATA — Demo farms, processors, listings ─────────
-- (only inserted if tables are empty)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users LIMIT 1) THEN
    INSERT INTO users (email, name, role, zip) VALUES
      ('demo-farmer@proteinoutfitters.com', 'Demo Farmer',     'producer',  '56601'),
      ('demo-buyer@proteinoutfitters.com',  'Demo Buyer',      'buyer',     '56601'),
      ('demo-processor@proteinoutfitters.com','Demo Processor','processor','56601');
  END IF;
END $$;

DO $$
DECLARE farmer_id UUID;
BEGIN
  SELECT id INTO farmer_id FROM users WHERE email='demo-farmer@proteinoutfitters.com';
  IF farmer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM farms LIMIT 1) THEN
    INSERT INTO farms (owner_id, slug, name, bio, city, state, zip, practices, certs, identity, established_year) VALUES
      (farmer_id, 'northfield-pastures', 'Northfield Pastures',
       '4th-generation regenerative cattle ranch in northern Minnesota.',
       'Bemidji', 'MN', '56601',
       ARRAY['grass-fed','regenerative'], ARRAY['organic','aga','amwa'], ARRAY['family'], 1962),
      (farmer_id, 'twin-pines-ranch', 'Twin Pines Ranch',
       'Veteran-owned 200-head Hereford operation. Family farm since 1948.',
       'Bagley', 'MN', '56621',
       ARRAY['grass-fed'], ARRAY['amwa','usda-insp'], ARRAY['veteran','family'], 1948);
  END IF;
END $$;

-- Demo ACTIVE listings are intentionally not seeded.
-- Catalog must stay empty of demo animals (Northfield / Twin Pines).
