// /api/institutions — Donation Depot recipient registry.
//   POST           — apply (anonymous form submission OK; if signed-in, links to user)
//   GET            — list approved (public) or all (admin); filter by ?status=
//   PATCH /:id     — admin: approve / reject / suspend (requires admin)
//
// Bootstraps the institutions table on first call so this works without a
// separate migration step. Idempotent.

import { sql, currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'edge' };

async function ensureSchema() {
  // CREATE TABLE IF NOT EXISTS — safe to call every cold start.
  await sql`
    CREATE TABLE IF NOT EXISTS institutions (
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS institutions_status_idx ON institutions(status)`;
  await sql`CREATE INDEX IF NOT EXISTS institutions_state_idx ON institutions(state)`;
}

function normalizeSpecies(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

export default async function handler(req) {
  try {
    await ensureSchema();
  } catch (e) {
    // Schema bootstrap failed — surface so it's visible in Vercel logs.
    return err(500, `Schema init failed: ${e.message}`);
  }

  const url = new URL(req.url);

  // ───── GET: list institutions ─────
  if (req.method === 'GET') {
    const user = await currentUser(req);
    const status = url.searchParams.get('status'); // optional filter
    const stateFilter = url.searchParams.get('state');

    let rows;
    if (user && user.role === 'admin') {
      // Admin sees everything; supports status + state filters.
      if (status && stateFilter) {
        rows = await sql`SELECT * FROM institutions WHERE status = ${status} AND state = ${stateFilter} ORDER BY created_at DESC LIMIT 500`;
      } else if (status) {
        rows = await sql`SELECT * FROM institutions WHERE status = ${status} ORDER BY created_at DESC LIMIT 500`;
      } else if (stateFilter) {
        rows = await sql`SELECT * FROM institutions WHERE state = ${stateFilter} ORDER BY created_at DESC LIMIT 500`;
      } else {
        rows = await sql`SELECT * FROM institutions ORDER BY created_at DESC LIMIT 500`;
      }
    } else {
      // Public/authenticated sees approved-only with safe-to-expose columns.
      rows = await sql`
        SELECT id, type, legal_name, state, people_per_week, species, lbs_received_ytd, verified_at
        FROM institutions
        WHERE status = 'approved'
        ORDER BY legal_name ASC
        LIMIT 500
      `;
    }

    return json({ institutions: rows });
  }

  // ───── POST: apply ─────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    // Validation — only the fields we need to qualify.
    const required = ['type', 'legal_name', 'contact_email'];
    for (const f of required) {
      if (!body[f] || String(body[f]).trim() === '') {
        return err(400, `Missing required field: ${f}`);
      }
    }
    const allowedTypes = ['school','government','foodbank','tribal','veterans','other'];
    if (!allowedTypes.includes(body.type)) return err(400, 'Invalid type');

    const user = await currentUser(req); // may be null — anonymous apply allowed
    const submittedBy = user ? user.id : null;

    const rows = await sql`
      INSERT INTO institutions (
        type, legal_name, ein, state, address,
        contact_name, contact_title, contact_email, contact_phone,
        people_per_week, storage, species, pickup,
        determination_doc_url, notes, submitted_by
      ) VALUES (
        ${body.type},
        ${body.legal_name.trim()},
        ${body.ein || null},
        ${body.state || null},
        ${body.address || null},
        ${body.contact_name || null},
        ${body.contact_title || null},
        ${body.contact_email.trim().toLowerCase()},
        ${body.contact_phone || null},
        ${body.people_per_week ? parseInt(body.people_per_week, 10) : null},
        ${body.storage || null},
        ${JSON.stringify(normalizeSpecies(body.species))},
        ${body.pickup || null},
        ${body.determination_doc_url || null},
        ${body.notes || null},
        ${submittedBy}
      )
      RETURNING id, status, created_at
    `;
    return json({ institution: rows[0], message: 'Application received — review usually within 3 business days.' });
  }

  // ───── PATCH: admin status update ─────
  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user || user.role !== 'admin') return err(403, 'Admin required');

    const id = url.searchParams.get('id');
    if (!id) return err(400, 'Missing id');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }

    const allowedStatuses = ['approved','rejected','suspended','pending'];
    if (body.status && !allowedStatuses.includes(body.status)) return err(400, 'Invalid status');

    // Build a dynamic update — only the fields admin wants to change.
    const sets = [];
    const params = [];
    let i = 1;
    if (body.status) {
      sets.push(`status = $${i++}`); params.push(body.status);
      if (body.status === 'approved') sets.push(`verified_at = NOW()`);
    }
    if (body.notes != null) { sets.push(`notes = $${i++}`); params.push(body.notes); }
    if (!sets.length) return err(400, 'Nothing to update');
    sets.push(`updated_at = NOW()`);

    // Use the pool for the dynamic SQL.
    const { rawQuery } = await import('./_lib/db.js');
    params.push(id);
    const rows = await rawQuery(`UPDATE institutions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (!rows[0]) return err(404, 'Institution not found');
    const updated = rows[0];

    // D2 institution-approval email (sends only on transition to 'approved').
    if (body.status === 'approved' && updated.contact_email) {
      try {
        const { sendLifecycleEmail } = await import('./_lib/email.js');
        await sendLifecycleEmail('D2.institution_approved', {
          to: updated.contact_email,
          institution_id: updated.id,
          contact_name: updated.contact_name,
          legal_name: updated.legal_name,
          type: updated.type,
          people_per_week: updated.people_per_week,
          storage: updated.storage,
          dedupKey: `D2::${updated.id}::approved`,
        });
      } catch (e) { console.error('D2 send failed:', e); }
    }

    return json({ institution: updated });
  }

  return err(405, 'Method not allowed');
}
