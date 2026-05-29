// /api/processors
//   GET → all processors (with optional filters)
//   GET ?slug=... → single processor
//   POST → create (auth, role auto-upgrades to processor)
//   PATCH ?slug=... → update (owner only)
import { sql, rawQuery, currentUser, err, json, slugify } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
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
    const allowed = ['name','city','state','zip','inspection','capabilities','base_fees','per_lb_fees','schedule','date_overrides','cover_url','avatar_url','bio','certs'];
    for (const [k, v] of Object.entries(body)) {
      if (allowed.includes(k)) {
        await rawQuery(`UPDATE processors SET ${k} = $1, updated_at = NOW() WHERE slug = $2`, [v, slug]);
      }
    }
    const updated = await sql`SELECT * FROM processors WHERE slug = ${slug}`;
    return json({ processor: updated[0] });
  }

  return err(405, 'Method not allowed');
}
