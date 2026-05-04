// One-off migration endpoint. Run once after first deploy:
//   curl -X POST "https://www.proteinoutfitters.com/api/migrate?secret=$MIGRATE_SECRET"
//
// Requires MIGRATE_SECRET env var. Idempotent (CREATE TABLE IF NOT EXISTS).
import { sql, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

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
  )`
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

  `INSERT INTO listings (farm_id, number, species, breed, sex, expected_finish_date, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, status)
   SELECT f.id, '#118', 'cattle', 'Black Angus', 'steer', '2026-07-15', 700, 7.85,
     'Black Angus steer #118, 60-day grass-finishing program with brassicas and rye.',
     ARRAY['grass-fed','regenerative'], ARRAY['organic','aga','amwa'],
     '{"whole":{"available":0,"reserved":1,"price":7.85},"half":{"available":1,"reserved":1,"price":8.15},"quarter":{"available":2,"reserved":2,"price":8.50}}'::jsonb,
     'active'
   FROM farms f WHERE f.slug='northfield-pastures'
   ON CONFLICT DO NOTHING`,

  `INSERT INTO listings (farm_id, number, species, breed, sex, expected_finish_date, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, status)
   SELECT f.id, '#214', 'cattle', 'Hereford', 'steer', '2026-06-30', 680, 6.95,
     'Hereford steer raised on rotational grass pasture, finished on a custom hay-and-grain blend.',
     ARRAY['grass-fed'], ARRAY['amwa','usda-insp'],
     '{"whole":{"available":0,"reserved":0,"price":6.95},"half":{"available":1,"reserved":0,"price":7.25},"quarter":{"available":3,"reserved":1,"price":7.50}}'::jsonb,
     'active'
   FROM farms f WHERE f.slug='twin-pines-ranch'
   ON CONFLICT DO NOTHING`
];

export default async function handler(req) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return err(401, 'Unauthorized — set MIGRATE_SECRET env var and pass ?secret=...');
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return err(405, 'Method not allowed');
  }

  const ranSchema = [];
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await sql.query(stmt);
      ranSchema.push(stmt.slice(0, 80).replace(/\s+/g, ' '));
    } catch (e) {
      return err(500, `Schema migration failed at: ${stmt.slice(0, 80)}`, { detail: String(e).slice(0, 300) });
    }
  }

  const ranSeed = [];
  if (url.searchParams.get('seed') === 'true') {
    for (const stmt of SEED_SQL) {
      try {
        await sql.query(stmt);
        ranSeed.push(stmt.slice(0, 80).replace(/\s+/g, ' '));
      } catch (e) {
        ranSeed.push(`FAILED: ${String(e).slice(0, 150)}`);
      }
    }
  }

  return json({ ok: true, schemaStatements: ranSchema.length, seedStatements: ranSeed.length, schema: ranSchema, seed: ranSeed });
}
