-- scripts/seed-demo.sql — idempotent demo content for local development.
--
-- Runs after scripts/db-bootstrap.mjs (which creates the schema + the base
-- users/farms seed). Adds coordinates, a few geographically-spread farms,
-- processors, and active listings so the /discover, /map, and farm/listing
-- pages have realistic data to render locally. Safe to run repeatedly.

-- ── Coordinates for the base-seed farms ────────────────────────────────
UPDATE farms SET lat = 47.4736, lng = -94.8803 WHERE slug = 'northfield-pastures' AND lat IS NULL;
UPDATE farms SET lat = 47.5219, lng = -95.3983 WHERE slug = 'twin-pines-ranch'   AND lat IS NULL;

-- ── Additional, centrally-located farms ────────────────────────────────
-- Placed near the contiguous-US centroid so the distance-filtered /discover
-- page shows results out of the box (its default location is the US center).
INSERT INTO farms (owner_id, slug, name, bio, city, state, zip, lat, lng, practices, certs, identity, established_year)
SELECT u.id, 'prairie-gold-beef', 'Prairie Gold Beef',
       'Third-generation Angus operation on the Kansas plains.',
       'Salina', 'KS', '67401', 38.8403, -97.6114,
       ARRAY['grass-fed','grain-finished'], ARRAY['usda-insp'], ARRAY['family'], 1971
FROM users u WHERE u.email = 'demo-farmer@proteinoutfitters.com'
  AND NOT EXISTS (SELECT 1 FROM farms WHERE slug = 'prairie-gold-beef');

INSERT INTO farms (owner_id, slug, name, bio, city, state, zip, lat, lng, practices, certs, identity, established_year)
SELECT u.id, 'cornhusker-highlands', 'Cornhusker Highlands',
       'Scottish Highland cattle raised on Nebraska prairie grass.',
       'Grand Island', 'NE', '68801', 40.9264, -98.3420,
       ARRAY['grass-fed','regenerative'], ARRAY['aga'], ARRAY['family'], 1988
FROM users u WHERE u.email = 'demo-farmer@proteinoutfitters.com'
  AND NOT EXISTS (SELECT 1 FROM farms WHERE slug = 'cornhusker-highlands');

-- ── Processors ─────────────────────────────────────────────────────────
INSERT INTO processors (slug, name, city, state, zip, inspection, capabilities, lat, lng, bio, certs)
SELECT 'northwoods-custom-meats', 'Northwoods Custom Meats', 'Bemidji', 'MN', '56601', 'usda',
       '{"species":["cattle","hog","lamb"],"capacity_per_week":12}'::jsonb,
       47.4700, -94.8600, 'USDA-inspected custom harvest & processing serving northern Minnesota.',
       ARRAY['usda-insp']
WHERE NOT EXISTS (SELECT 1 FROM processors WHERE slug = 'northwoods-custom-meats');

INSERT INTO processors (slug, name, city, state, zip, inspection, capabilities, lat, lng, bio, certs)
SELECT 'heartland-custom-processing', 'Heartland Custom Processing', 'Salina', 'KS', '67401', 'usda',
       '{"species":["cattle","hog"],"capacity_per_week":20}'::jsonb,
       38.8300, -97.6000, 'Full-service USDA plant serving central Kansas producers.',
       ARRAY['usda-insp']
WHERE NOT EXISTS (SELECT 1 FROM processors WHERE slug = 'heartland-custom-processing');

-- ── Active listings ────────────────────────────────────────────────────
INSERT INTO listings (farm_id, number, species, breed, sex, current_weight, estimated_finish_weight, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, status, instant_reserve, expected_finish_date)
SELECT f.id, 'NF-042', 'cattle', 'Black Angus', 'steer', 1050, 1300, 800, 6.75,
       'Grass-fed, grain-finished Black Angus steer. Dry-aged 21 days available.',
       ARRAY['grass-fed','regenerative'], ARRAY['organic','aga'],
       '{"whole":{"available":1,"reserved":0,"price":4200},"half":{"available":2,"reserved":0,"price":2200},"quarter":{"available":4,"reserved":1,"price":1150}}'::jsonb,
       'active', true, (CURRENT_DATE + INTERVAL '75 days')::date
FROM farms f WHERE f.slug = 'northfield-pastures'
  AND NOT EXISTS (SELECT 1 FROM listings WHERE number = 'NF-042');

INSERT INTO listings (farm_id, number, species, breed, sex, current_weight, estimated_finish_weight, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, status, instant_reserve, expected_finish_date)
SELECT f.id, 'NF-108', 'hog', 'Berkshire', 'barrow', 210, 280, 210, 7.50,
       'Heritage Berkshire hog, pasture-raised on non-GMO feed.',
       ARRAY['pasture-raised'], ARRAY['non-gmo'],
       '{"whole":{"available":2,"reserved":0,"price":950},"half":{"available":4,"reserved":1,"price":500}}'::jsonb,
       'active', true, (CURRENT_DATE + INTERVAL '45 days')::date
FROM farms f WHERE f.slug = 'northfield-pastures'
  AND NOT EXISTS (SELECT 1 FROM listings WHERE number = 'NF-108');

INSERT INTO listings (farm_id, number, species, breed, sex, current_weight, estimated_finish_weight, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, status, instant_reserve, expected_finish_date)
SELECT f.id, 'TP-011', 'cattle', 'Hereford', 'heifer', 980, 1250, 760, 6.25,
       '100% grass-fed Hereford heifer from a veteran-owned family ranch.',
       ARRAY['grass-fed'], ARRAY['amwa'],
       '{"whole":{"available":1,"reserved":0,"price":3900},"half":{"available":2,"reserved":0,"price":2050},"quarter":{"available":4,"reserved":0,"price":1075}}'::jsonb,
       'active', true, (CURRENT_DATE + INTERVAL '90 days')::date
FROM farms f WHERE f.slug = 'twin-pines-ranch'
  AND NOT EXISTS (SELECT 1 FROM listings WHERE number = 'TP-011');

INSERT INTO listings (farm_id, number, species, breed, sex, current_weight, estimated_finish_weight, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, status, instant_reserve, expected_finish_date)
SELECT f.id, 'PG-201', 'cattle', 'Black Angus', 'steer', 1100, 1350, 830, 6.50,
       'Corn-finished Black Angus, ready this fall. USDA harvest available on-site.',
       ARRAY['grain-finished'], ARRAY['usda-insp'],
       '{"whole":{"available":2,"reserved":0,"price":4400},"half":{"available":4,"reserved":0,"price":2300},"quarter":{"available":6,"reserved":2,"price":1200}}'::jsonb,
       'active', true, (CURRENT_DATE + INTERVAL '60 days')::date
FROM farms f WHERE f.slug = 'prairie-gold-beef'
  AND NOT EXISTS (SELECT 1 FROM listings WHERE number = 'PG-201');

INSERT INTO listings (farm_id, number, species, breed, sex, current_weight, estimated_finish_weight, estimated_hanging_weight, price_per_lb, description, practice, certs, shares, status, instant_reserve, expected_finish_date)
SELECT f.id, 'CH-014', 'cattle', 'Scottish Highland', 'steer', 900, 1150, 700, 7.10,
       'Slow-grown Scottish Highland beef — lean, richly marbled, 100% grass-fed.',
       ARRAY['grass-fed','regenerative'], ARRAY['aga'],
       '{"whole":{"available":1,"reserved":0,"price":4000},"half":{"available":2,"reserved":0,"price":2100},"quarter":{"available":4,"reserved":1,"price":1100}}'::jsonb,
       'active', true, (CURRENT_DATE + INTERVAL '100 days')::date
FROM farms f WHERE f.slug = 'cornhusker-highlands'
  AND NOT EXISTS (SELECT 1 FROM listings WHERE number = 'CH-014');
