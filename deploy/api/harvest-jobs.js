// /api/harvest-jobs — Stittsworth Smokehouse trailer calendar (Phase A2).
//
// Shared jobs for online farm requests (source=app from /harvest) and
// phone call-ins Jeff adds on /plant-desk (source=phone).
//
// Persistence: Neon table `harvest_jobs` (created here on first call and
// declared in deploy/db/schema.sql + /api/migrate). Smokehouse-only —
// processor_slug is hardcoded to stittsworth-smokehouse. Do not use this
// as a national multi-processor desk.
//
//   GET  ?view=capacity[&from=&to=]  → public leftover heads by day (no farm names)
//   GET  ?from=&to=  or  ?day=        → full jobs (processor/admin)
//   POST body: farm_name, town, species, heads, share_kind, trailer_day,
//              source=app|phone, phone?, notes?, listing_id?
//     source=app   → any signed-in user (farmer request)
//     source=phone → processor/admin only
//     New jobs always start pay_status=unpaid
//   PATCH ?id=  body: farm_name?, town?, species?, heads?, share_kind?,
//                     trailer_day?, phone?, notes?, status?, pay_status?,
//                     paid_note?
//     status: requested | confirmed | capacity_used | cancelled
//     pay_status: unpaid | cash | app  (flag only — does not charge a card)
//     processor/admin only
//
// Kill + trip are computed server-side from deploy/lib/stittsworth-harvest.js.
// Does not charge a card, read CHECKOUT_ENABLED, or publish listing 123.

import { sql, rawQuery, currentUser, err, json, isUuid, nodejsHandler } from './_lib/db.js';
import * as Jobs from '../lib/harvest-jobs.js';

export const config = { runtime: 'nodejs' };

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS harvest_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processor_slug TEXT NOT NULL DEFAULT 'stittsworth-smokehouse',
    farm_name TEXT NOT NULL,
    town TEXT NOT NULL,
    species TEXT NOT NULL,
    heads INT NOT NULL CHECK (heads BETWEEN 1 AND 4),
    share_kind TEXT NOT NULL DEFAULT 'whole'
      CHECK (share_kind IN ('whole','half','quarter')),
    trailer_day DATE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('app','phone')),
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested','confirmed','capacity_used','cancelled')),
    kill_due NUMERIC(10,2) NOT NULL DEFAULT 0,
    trip_due NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_due NUMERIC(10,2) NOT NULL DEFAULT 0,
    pay_status TEXT NOT NULL DEFAULT 'unpaid'
      CHECK (pay_status IN ('unpaid','cash','app')),
    paid_at TIMESTAMPTZ,
    paid_note TEXT,
    phone TEXT,
    notes TEXT,
    listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

const ALTER_PAY_COLUMNS = [
  `ALTER TABLE harvest_jobs ADD COLUMN IF NOT EXISTS pay_status TEXT NOT NULL DEFAULT 'unpaid'`,
  `ALTER TABLE harvest_jobs ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
  `ALTER TABLE harvest_jobs ADD COLUMN IF NOT EXISTS paid_note TEXT`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'harvest_jobs_pay_status_check'
     ) THEN
       ALTER TABLE harvest_jobs ADD CONSTRAINT harvest_jobs_pay_status_check
         CHECK (pay_status IN ('unpaid','cash','app'));
     END IF;
   END $$`,
];

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await rawQuery(CREATE_TABLE);
  await rawQuery(`CREATE INDEX IF NOT EXISTS harvest_jobs_day_idx ON harvest_jobs(processor_slug, trailer_day)`);
  await rawQuery(`CREATE INDEX IF NOT EXISTS harvest_jobs_status_idx ON harvest_jobs(status)`);
  // Live A1 tables have no pay_status yet — ALTER first, then index.
  for (const stmt of ALTER_PAY_COLUMNS) {
    await rawQuery(stmt);
  }
  await rawQuery(`CREATE INDEX IF NOT EXISTS harvest_jobs_pay_idx ON harvest_jobs(pay_status)`);
  schemaReady = true;
}

function isoParam(raw) {
  const s = String(raw || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function rangeDefaults(url) {
  const day = isoParam(url.searchParams.get('day'));
  let from = isoParam(url.searchParams.get('from'));
  let to = isoParam(url.searchParams.get('to'));
  if (day) return { from: day, to: day };
  if (!from || !to) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90);
    from = from || Jobs.isoDay(start);
    to = to || Jobs.isoDay(end);
  }
  return { from, to };
}

async function loadJobs(from, to) {
  const rows = await sql`
    SELECT * FROM harvest_jobs
    WHERE processor_slug = ${Jobs.PROCESSOR_SLUG}
      AND trailer_day >= ${from}::date
      AND trailer_day <= ${to}::date
    ORDER BY trailer_day ASC, created_at ASC`;
  return rows.map(Jobs.publicJob);
}

function capacityPayload(jobs) {
  const booked = Jobs.bookedHeadsByDay(jobs);
  return {
    processor_slug: Jobs.PROCESSOR_SLUG,
    processor_name: Jobs.PROCESSOR_NAME,
    capacity: 4,
    booked,
  };
}

async function handler(req) {
  await ensureSchema().catch(() => { schemaReady = false; });

  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const view = (url.searchParams.get('view') || '').toLowerCase();

  if (req.method === 'GET') {
    const { from, to } = rangeDefaults(url);
    const jobs = await loadJobs(from, to);
    const cap = capacityPayload(jobs);
    if (view === 'capacity') {
      return json({ ...cap, from, to });
    }
    const user = await currentUser(req);
    if (!Jobs.isPlantStaff(user)) return err(401, 'Sign in as Smokehouse staff to see the trailer list');
    return json({ ...cap, from, to, jobs, pay_totals: Jobs.payTotals(jobs) });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const source = Jobs.normalizeSource(body && body.source);
    if (source === 'phone' && !Jobs.isPlantStaff(user)) {
      return err(403, 'Only Smokehouse staff can add a phone job');
    }

    const { from, to } = rangeDefaults(url);
    const windowFrom = isoParam(body && (body.trailer_day || body.date)) || from;
    const windowTo = isoParam(body && (body.trailer_day || body.date)) || to;
    const existing = await loadJobs(windowFrom, windowTo);
    const checked = Jobs.validateJobInput(Object.assign({}, body, { source, pay_status: 'unpaid' }), {
      existingJobs: existing,
      now: new Date(),
    });
    if (!checked.ok) return err(400, checked.errors[0], { errors: checked.errors });

    const j = checked.job;
    const rows = await sql`
      INSERT INTO harvest_jobs (
        processor_slug, farm_name, town, species, heads, share_kind,
        trailer_day, source, status, kill_due, trip_due, total_due,
        pay_status, paid_at, paid_note,
        phone, notes, listing_id, created_by
      ) VALUES (
        ${Jobs.PROCESSOR_SLUG}, ${j.farm_name}, ${j.town}, ${j.species}, ${j.heads}, ${j.share_kind},
        ${j.trailer_day}::date, ${j.source}, ${j.status}, ${j.kill_due}, ${j.trip_due}, ${j.total_due},
        ${'unpaid'}, ${null}, ${null},
        ${j.phone}, ${j.notes}, ${j.listing_id}, ${user.id}
      )
      RETURNING *`;
    return json({ job: Jobs.publicJob(rows[0]), checkout_touched: false, listing_123_published: false, charged: false }, { status: 201 });
  }

  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!Jobs.isPlantStaff(user)) return err(403, 'Only Smokehouse staff can edit trailer jobs');
    const id = url.searchParams.get('id');
    if (!id || !isUuid(id)) return err(400, 'id query param required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const current = await sql`
      SELECT * FROM harvest_jobs
      WHERE id = ${id} AND processor_slug = ${Jobs.PROCESSOR_SLUG}
      LIMIT 1`;
    const row = current[0];
    if (!row) return err(404, 'Job not found');

    if (body.pay_status != null && body.pay_status !== '' && !Jobs.isKnownPayStatus(body.pay_status)) {
      return err(400, 'pay_status must be unpaid, cash, or app');
    }

    const merged = {
      farm_name: body.farm_name != null ? body.farm_name : row.farm_name,
      town: body.town != null ? body.town : row.town,
      species: body.species != null ? body.species : row.species,
      heads: body.heads != null ? body.heads : row.heads,
      share_kind: body.share_kind != null ? body.share_kind : row.share_kind,
      trailer_day: body.trailer_day != null ? body.trailer_day : row.trailer_day,
      source: row.source,
      status: body.status != null ? body.status : row.status,
      pay_status: body.pay_status != null ? body.pay_status : (row.pay_status || 'unpaid'),
      paid_at: row.paid_at,
      paid_note: body.paid_note !== undefined ? body.paid_note : row.paid_note,
      phone: body.phone !== undefined ? body.phone : row.phone,
      notes: body.notes !== undefined ? body.notes : row.notes,
      listing_id: row.listing_id,
    };

    const day = Jobs.isoDay(merged.trailer_day);
    const existing = await loadJobs(day, day);
    const checked = Jobs.validateJobInput(merged, {
      existingJobs: existing,
      excludeId: id,
      skipCompass: true,
    });
    if (!checked.ok) return err(400, checked.errors[0], { errors: checked.errors });

    const j = checked.job;
    const stamp = Jobs.payStamp(j.pay_status, row);
    const paidNote = body.paid_note !== undefined
      ? (String(body.paid_note || '').trim().slice(0, 200) || null)
      : (row.paid_note || null);
    const updated = await sql`
      UPDATE harvest_jobs SET
        farm_name = ${j.farm_name},
        town = ${j.town},
        species = ${j.species},
        heads = ${j.heads},
        share_kind = ${j.share_kind},
        trailer_day = ${j.trailer_day}::date,
        status = ${j.status},
        kill_due = ${j.kill_due},
        trip_due = ${j.trip_due},
        total_due = ${j.total_due},
        pay_status = ${stamp.pay_status},
        paid_at = ${stamp.paid_at},
        paid_note = ${paidNote},
        phone = ${j.phone},
        notes = ${j.notes},
        updated_at = NOW()
      WHERE id = ${id} AND processor_slug = ${Jobs.PROCESSOR_SLUG}
      RETURNING *`;
    return json({ job: Jobs.publicJob(updated[0]), checkout_touched: false, charged: false });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
