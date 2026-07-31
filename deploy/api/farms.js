// /api/farms
//   GET   → all farms (or ?owner=me for current user)
//   POST  → create new farm (auth required, role auto-upgrades to producer)
//   GET ?slug=northfield-pastures → single farm
import { sql, rawQuery, currentUser, err, json, slugify, nodejsHandler } from './_lib/db.js';
import { geocode } from './_lib/geocode.js';

export const config = { runtime: 'nodejs' };

async function handler(req) {
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  if (req.method === 'GET') {
    const slug = url.searchParams.get('slug');
    const owner = url.searchParams.get('owner');
    if (slug) {
      const rows = await sql`SELECT * FROM farms WHERE slug = ${slug} LIMIT 1`;
      if (!rows[0]) return err(404, 'Farm not found');
      const listings = await sql`SELECT * FROM listings WHERE farm_id = ${rows[0].id} AND status = 'active' ORDER BY created_at DESC LIMIT 30`;
      return json({ farm: rows[0], listings });
    }
    if (owner === 'me') {
      const user = await currentUser(req);
      if (!user) return err(401, 'Sign in required');
      const rows = await sql`SELECT * FROM farms WHERE owner_id = ${user.id} ORDER BY created_at`;
      return json({ farms: rows });
    }
    const rows = await sql`SELECT id, slug, name, bio, city, state, practices, certs, identity, cover_url, avatar_url, established_year FROM farms ORDER BY created_at DESC LIMIT 60`;
    return json({ farms: rows });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body.name) return err(400, 'name required');
    let slug = slugify(body.slug || body.name);
    if (!slug) return err(400, 'Could not derive slug from name');
    // Ensure unique slug
    let n = 0;
    while (true) {
      const trial = n === 0 ? slug : `${slug}-${n}`;
      const exists = await sql`SELECT 1 FROM farms WHERE slug = ${trial} LIMIT 1`;
      if (!exists[0]) { slug = trial; break; }
      n++;
      if (n > 50) return err(500, 'Could not allocate slug');
    }

    // Upgrade user to producer if buyer
    if (user.role === 'buyer') {
      await sql`UPDATE users SET role = 'producer' WHERE id = ${user.id}`;
    }

    const city = body.city ? String(body.city).trim().slice(0, 80) : null;
    const state = body.state ? String(body.state).trim().toUpperCase().slice(0, 2) : null;
    const zip = body.zip ? String(body.zip).trim().slice(0, 12) : null;
    if (state && !/^[A-Z]{2}$/.test(state)) return err(400, 'state must be a 2-letter US code');

    // Best-effort geocode so the farm appears on the national map immediately.
    let lat = body.lat != null ? Number(body.lat) : null;
    let lng = body.lng != null ? Number(body.lng) : null;
    if ((lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) && (city || state || zip)) {
      try {
        const geo = await geocode({ city, state, zip });
        if (geo) { lat = geo.lat; lng = geo.lng; }
      } catch (_) { /* non-fatal */ }
    }

    const rows = await sql`
      INSERT INTO farms (owner_id, slug, name, bio, story, city, state, zip, lat, lng, practices, certs, identity, cover_url, avatar_url, established_year)
      VALUES (${user.id}, ${slug}, ${String(body.name).trim().slice(0, 160)}, ${body.bio || null}, ${body.story || null}, ${city}, ${state}, ${zip}, ${lat}, ${lng}, ${body.practices || []}, ${body.certs || []}, ${body.identity || []}, ${body.cover_url || null}, ${body.avatar_url || null}, ${body.established_year || null})
      RETURNING *
    `;
    return json({ farm: rows[0] });
  }

  if (req.method === 'PATCH') {
    const slug = url.searchParams.get('slug');
    if (!slug) return err(400, 'slug required');
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    const owns = await sql`SELECT 1 FROM farms WHERE slug = ${slug} AND owner_id = ${user.id} LIMIT 1`;
    if (!owns[0] && user.role !== 'admin') return err(403, 'Not your farm');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const allowed = ['name','bio','story','city','state','zip','practices','certs','identity','cover_url','avatar_url','established_year','credentials_docs'];
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.includes(k)) continue;
      if (k === 'credentials_docs') {
        // jsonb column — bind the serialized value and cast explicitly.
        // Replaced wholesale, not merged: turning a credential off has to be
        // able to remove its document entry, which a `||` merge can never do.
        await rawQuery(
          `UPDATE farms SET credentials_docs = $1::jsonb, updated_at = NOW() WHERE slug = $2`,
          [v === undefined || v === null ? null : JSON.stringify(v), slug]
        );
      } else {
        await rawQuery(`UPDATE farms SET ${k} = $1, updated_at = NOW() WHERE slug = $2`, [v, slug]);
      }
    }
    const updated = await sql`SELECT * FROM farms WHERE slug = ${slug}`;
    return json({ farm: updated[0] });
  }

  return err(405, 'Method not allowed');
}

export default nodejsHandler(handler);
