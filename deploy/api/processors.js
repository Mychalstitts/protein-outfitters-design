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
    const rows = await sql`SELECT * FROM processors ORDER BY created_at DESC LIMIT 60`;
    return json({ processors: rows });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
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
    const rows = await sql`
      INSERT INTO processors (owner_id, slug, name, city, state, zip, inspection, capabilities, base_fees, per_lb_fees, schedule, bio)
      VALUES (${user.id}, ${s}, ${body.name}, ${body.city || null}, ${body.state || null}, ${body.zip || null}, ${body.inspection || null}, ${body.capabilities || {}}, ${body.base_fees || {}}, ${body.per_lb_fees || {}}, ${body.schedule || {}}, ${body.bio || null})
      RETURNING *
    `;
    return json({ processor: rows[0] });
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
