// /api/processors
//   GET → all processors (with optional filters)
//   GET ?slug=... → single processor
//   POST → create (auth, role auto-upgrades to processor)
//   PATCH ?slug=... → update (owner only)
import { sql, rawQuery, currentUser, err, json, slugify, nodejsHandler } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

// ─── PATCH column policy ───────────────────────────────────────────
// Hardcoded allow-list. Column names from this list are interpolated into
// SQL text (Postgres can't bind an identifier), so it must stay a literal
// list — values are always passed as bind params.
const ALLOWED = ['name','city','state','zip','inspection','capabilities','base_fees','per_lb_fees','schedule','date_overrides','credentials_docs','cover_url','avatar_url','bio','certs'];

// Columns declared JSONB in the processors DDL. `certs` is deliberately
// absent — it is TEXT[], not jsonb.
const JSONB_COLUMNS = new Set(['capabilities','base_fees','per_lb_fees','schedule','date_overrides','credentials_docs']);

// Of those, these get a shallow MERGE on PATCH, because several pages own
// different key subsets of the same blob (processor-config, -schedule and
// -pricing all write `capabilities`) and a plain replace made whichever page
// saved last wipe the others' keys.
//
// The rest are REPLACED wholesale. They are complete maps owned by a single
// page, and under a merge a key can never be removed: clearing your last
// blackout date, or switching a credential off, would leave the old entry in
// the blob forever. Deletion has to be possible for those.
const MERGE_COLUMNS = new Set(['capabilities','base_fees','per_lb_fees','schedule']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// processors.credentials_docs post-dates the original CREATE TABLE, so add it
// lazily the first time someone PATCHes it (same lazy-bootstrap convention as
// /api/complaint and /api/institutions). Memoized so we do at most one DDL
// round-trip per warm instance.
let _credsColumnReady = null;
function ensureCredentialsDocsColumn() {
  if (!_credsColumnReady) {
    _credsColumnReady = sql`
      ALTER TABLE processors ADD COLUMN IF NOT EXISTS credentials_docs JSONB DEFAULT '{}'::jsonb
    `.catch((e) => {
      // Don't cache a failure — retry on the next request.
      _credsColumnReady = null;
      console.warn('[processors] could not ensure credentials_docs column:', e?.message);
    });
  }
  return _credsColumnReady;
}

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const slug = url.searchParams.get('slug');

  if (req.method === 'GET') {
    if (slug) {
      const rows = await sql`SELECT * FROM processors WHERE slug = ${slug} LIMIT 1`;
      if (!rows[0]) return err(404, 'Processor not found');
      return json({ processor: rows[0] });
    }
    const owner = url.searchParams.get('owner');
    if (owner === 'me') {
      const user = await currentUser(req);
      if (!user) return err(401, 'Sign in required');
      const rows = await sql`SELECT * FROM processors WHERE owner_id = ${user.id} ORDER BY created_at`;
      return json({ processors: rows });
    }
    const state = (url.searchParams.get('state') || '').toUpperCase().slice(0, 2);
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 300);
    const claimable = url.searchParams.get('claimable') === '1';

    let rows;
    if (state && q) {
      const like = `%${q}%`;
      rows = claimable
        ? await sql`SELECT id, slug, name, city, state, zip, inspection, phone, lat, lng, owner_id, created_at FROM processors WHERE owner_id IS NULL AND state = ${state} AND name ILIKE ${like} ORDER BY name LIMIT ${limit}`
        : await sql`SELECT id, slug, name, city, state, zip, inspection, phone, lat, lng, owner_id, created_at FROM processors WHERE state = ${state} AND name ILIKE ${like} ORDER BY name LIMIT ${limit}`;
    } else if (state) {
      rows = claimable
        ? await sql`SELECT id, slug, name, city, state, zip, inspection, phone, lat, lng, owner_id, created_at FROM processors WHERE owner_id IS NULL AND state = ${state} ORDER BY name LIMIT ${limit}`
        : await sql`SELECT id, slug, name, city, state, zip, inspection, phone, lat, lng, owner_id, created_at FROM processors WHERE state = ${state} ORDER BY name LIMIT ${limit}`;
    } else if (q) {
      const like = `%${q}%`;
      rows = claimable
        ? await sql`SELECT id, slug, name, city, state, zip, inspection, phone, lat, lng, owner_id, created_at FROM processors WHERE owner_id IS NULL AND name ILIKE ${like} ORDER BY name LIMIT ${limit}`
        : await sql`SELECT id, slug, name, city, state, zip, inspection, phone, lat, lng, owner_id, created_at FROM processors WHERE name ILIKE ${like} ORDER BY name LIMIT ${limit}`;
    } else if (claimable) {
      rows = await sql`SELECT id, slug, name, city, state, zip, inspection, phone, lat, lng, owner_id, created_at FROM processors WHERE owner_id IS NULL ORDER BY created_at DESC LIMIT ${limit}`;
    } else {
      // Default list stays compact for dashboards; use ?state= or ?q= for national search.
      rows = await sql`SELECT * FROM processors ORDER BY created_at DESC LIMIT ${limit}`;
    }
    return json({ processors: rows });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    // Claim an existing unowned plant (FSIS/MPA import) instead of creating a duplicate.
    if (body.claim_id || body.claim_slug) {
      const target = body.claim_id
        ? await sql`SELECT * FROM processors WHERE id = ${body.claim_id} LIMIT 1`
        : await sql`SELECT * FROM processors WHERE slug = ${body.claim_slug} LIMIT 1`;
      if (!target[0]) return err(404, 'Processor not found');
      if (target[0].owner_id && target[0].owner_id !== user.id) {
        return err(409, 'This plant is already claimed by another account');
      }
      if (user.role === 'buyer') {
        await sql`UPDATE users SET role = 'processor' WHERE id = ${user.id}`;
      }
      // Ensure slug for plants imported without one
      let plantSlug = target[0].slug;
      if (!plantSlug) {
        plantSlug = slugify(target[0].name || 'plant');
        let n = 0;
        while (true) {
          const trial = n === 0 ? plantSlug : `${plantSlug}-${n}`;
          const exists = await sql`SELECT 1 FROM processors WHERE slug = ${trial} AND id <> ${target[0].id} LIMIT 1`;
          if (!exists[0]) { plantSlug = trial; break; }
          n++;
          if (n > 50) return err(500, 'Could not allocate slug');
        }
      }
      const rows = await sql`
        UPDATE processors
        SET owner_id = ${user.id},
            slug = ${plantSlug},
            updated_at = NOW()
        WHERE id = ${target[0].id} AND (owner_id IS NULL OR owner_id = ${user.id})
        RETURNING *`;
      if (!rows[0]) return err(409, 'Could not claim plant — it may have just been claimed');
      return json({ processor: rows[0], claimed: true });
    }

    if (!body.name) return err(400, 'name required');
    let s = slugify(body.slug || body.name);
    let n = 0;
    while (true) {
      const trial = n === 0 ? s : `${s}-${n}`;
      const exists = await sql`SELECT 1 FROM processors WHERE slug = ${trial} LIMIT 1`;
      if (!exists[0]) { s = trial; break; }
      n++;
      if (n > 50) return err(500, 'Could not allocate slug');
    }
    if (user.role === 'buyer') {
      await sql`UPDATE users SET role = 'processor' WHERE id = ${user.id}`;
    }
    // If an unowned plant with the same name+state exists, claim it instead of duplicating.
    const stateNorm = body.state ? String(body.state).trim().toUpperCase().slice(0, 2) : null;
    if (stateNorm) {
      const match = await sql`
        SELECT id FROM processors
        WHERE owner_id IS NULL
          AND state = ${stateNorm}
          AND lower(name) = ${String(body.name).trim().toLowerCase()}
        LIMIT 1`;
      if (match[0]) {
        const claimed = await sql`
          UPDATE processors
          SET owner_id = ${user.id}, slug = COALESCE(slug, ${s}), city = COALESCE(city, ${body.city || null}),
              zip = COALESCE(zip, ${body.zip || null}), inspection = COALESCE(inspection, ${body.inspection || null}),
              updated_at = NOW()
          WHERE id = ${match[0].id} AND owner_id IS NULL
          RETURNING *`;
        if (claimed[0]) return json({ processor: claimed[0], claimed: true });
      }
    }
    const rows = await sql`
      INSERT INTO processors (owner_id, slug, name, city, state, zip, inspection, capabilities, base_fees, per_lb_fees, schedule, bio)
      VALUES (${user.id}, ${s}, ${body.name}, ${body.city || null}, ${stateNorm}, ${body.zip || null}, ${body.inspection || null}, ${body.capabilities || {}}, ${body.base_fees || {}}, ${body.per_lb_fees || {}}, ${body.schedule || {}}, ${body.bio || null})
      RETURNING *
    `;
    return json({ processor: rows[0], claimed: false });
  }

  if (req.method === 'PATCH') {
    if (!slug) return err(400, 'slug required');
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const owns = await sql`SELECT 1 FROM processors WHERE slug = ${slug} AND owner_id = ${user.id} LIMIT 1`;
    if (!owns[0] && user.role !== 'admin') return err(403, 'Not your processor');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body || typeof body !== 'object') return err(400, 'Body must be a JSON object');

    // credentials.html PATCHes credentials_docs; the column was never in the
    // original processors DDL, so make sure it exists before we write to it.
    // Idempotent + memoized per instance (see ensureCredentialsDocsColumn).
    if (Object.prototype.hasOwnProperty.call(body, 'credentials_docs')) {
      await ensureCredentialsDocsColumn();
    }

    for (const [k, v] of Object.entries(body)) {
      // ALLOWED is a hardcoded allow-list — that is the only reason it's safe
      // to interpolate `k` into the SQL text below. Never widen this to
      // arbitrary caller-supplied keys.
      if (!ALLOWED.includes(k)) continue;

      if (k.endsWith('__unset')) continue;  // handled alongside its column

      if (MERGE_COLUMNS.has(k) && isPlainObject(v)) {
        // Shallow MERGE — see MERGE_COLUMNS above.
        // A merge can never remove a key, so a caller that wants one gone
        // sends `<column>__unset: ['key', ...]` alongside the column. Without
        // this, clearing a fee in the UI left the old value live in the blob
        // that /api/bookings and /api/checkout price from — the operator saw a
        // blank field while customers kept being charged the deleted amount.
        const unsetRaw = body[`${k}__unset`];
        const unset = Array.isArray(unsetRaw)
          ? unsetRaw.filter(x => typeof x === 'string' && x.length && x.length < 64)
          : [];
        if (unset.length) {
          await rawQuery(
            `UPDATE processors SET ${k} = (COALESCE(${k}, '{}'::jsonb) || $1::jsonb) - $2::text[], updated_at = NOW() WHERE slug = $3`,
            [JSON.stringify(v), unset, slug]
          );
          continue;
        }
        await rawQuery(
          `UPDATE processors SET ${k} = COALESCE(${k}, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE slug = $2`,
          [JSON.stringify(v), slug]
        );
      } else if (JSONB_COLUMNS.has(k)) {
        // Replace wholesale. Two cases land here: the single-owner maps
        // (date_overrides, credentials_docs), and arrays/scalars in any jsonb
        // column — `||` on a jsonb array concatenates and on a scalar wraps,
        // neither of which is a key-merge.
        await rawQuery(
          `UPDATE processors SET ${k} = $1::jsonb, updated_at = NOW() WHERE slug = $2`,
          [v === undefined || v === null ? null : JSON.stringify(v), slug]
        );
      } else {
        // Non-jsonb columns (incl. certs, which is TEXT[]) keep replace semantics.
        await rawQuery(
          `UPDATE processors SET ${k} = $1, updated_at = NOW() WHERE slug = $2`,
          [v, slug]
        );
      }
    }
    const updated = await sql`SELECT * FROM processors WHERE slug = ${slug}`;
    return json({ processor: updated[0] });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
