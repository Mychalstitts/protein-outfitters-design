// /api/donations — pledges to donate an animal to a 501(c)(3) food bank partner
//   POST {listing_id, recipient_org, estimated_lb, fmv}
//   GET  → all donations for current user (auth) or all if admin
//   PATCH ?id=…  admin: status transition (pledged → processing → delivered → receipted)
//                fires D1 (tax letter ready) when status flips to 'receipted'.
import { sql, currentUser, err, json } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'nodejs' };

const ALLOWED_DONATION_STATUSES = ['pledged','processing','delivered','receipted','cancelled'];

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let rows;
    if (user.role === 'admin') {
      rows = await sql`SELECT * FROM donations ORDER BY created_at DESC LIMIT 200`;
    } else {
      rows = await sql`SELECT * FROM donations WHERE donor_id = ${user.id} ORDER BY created_at DESC`;
    }
    return json({ donations: rows });
  }

  if (req.method === 'PATCH') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    if (user.role !== 'admin') return err(403, 'Admin only');
    const id = url.searchParams.get('id');
    if (!id) return err(400, 'id query param required');

    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    const newStatus = body.status;
    if (!newStatus || !ALLOWED_DONATION_STATUSES.includes(newStatus)) {
      return err(400, `Invalid status: ${newStatus}`);
    }

    // Optional: actual hanging weight + final FMV when admin processes the receipt.
    const finalHwLbs = Number(body.final_hw_lbs) || null;
    const finalFmv   = Number(body.final_fmv)   || null;

    // Build dynamic update so caller can flip status + record the final HW/FMV in one call.
    const sets = [];
    sets.push(sql`status = ${newStatus}`);
    if (finalHwLbs) sets.push(sql`estimated_lb = ${finalHwLbs}`);
    if (finalFmv)   sets.push(sql`fmv = ${finalFmv}`);

    await sql`UPDATE donations SET status = ${newStatus}${
      finalHwLbs ? sql`, estimated_lb = ${finalHwLbs}` : sql``
    }${
      finalFmv ? sql`, fmv = ${finalFmv}` : sql``
    } WHERE id = ${id}`;

    // ─── Fire D1 when status flips to 'receipted' ───
    if (newStatus === 'receipted') {
      try {
        const rows = await sql`
          SELECT d.*, u.email AS donor_email, u.name AS donor_name,
                 l.estimated_hanging_weight,
                 i.legal_name AS recipient_legal_name, i.ein AS recipient_ein
          FROM donations d
          LEFT JOIN users u ON u.id = d.donor_id
          LEFT JOIN listings l ON l.id = d.listing_id
          LEFT JOIN institutions i ON i.legal_name = d.recipient_org
          WHERE d.id = ${id} LIMIT 1`;
        const d = rows[0];
        if (d?.donor_email) {
          await sendLifecycleEmail('D1.tax_letter_ready', {
            to: d.donor_email,
            donor_name: d.donor_name,
            donation_id: d.id,
            final_hw_lbs: finalHwLbs || d.estimated_hanging_weight || d.estimated_lb,
            fmv: finalFmv || d.fmv,
            recipient_org: d.recipient_legal_name || d.recipient_org,
            recipient_ein: d.recipient_ein || null,
            dedupKey: `D1::${d.id}`,
          });
          await sql`UPDATE donations SET tax_letter_sent = TRUE WHERE id = ${id}`;
        }
      } catch (e) { console.error('D1 send failed:', e.message); }
    }

    return json({ donation: { id, status: newStatus } });
  }

  if (req.method === 'POST') {
    const user = await currentUser(req);
    if (!user) return err(401, 'Sign in required');
    let body;
    try { body = await req.json(); } catch { return err(400, 'Bad JSON'); }
    if (!body.listing_id) return err(400, 'listing_id required');

    // Verify ownership of listing's farm
    const ownership = await sql`
      SELECT l.id FROM listings l JOIN farms f ON f.id = l.farm_id
      WHERE l.id = ${body.listing_id} AND f.owner_id = ${user.id} LIMIT 1
    `;
    if (!ownership[0]) return err(403, 'Not your listing');

    const rows = await sql`
      INSERT INTO donations (listing_id, donor_id, recipient_org, estimated_lb, fmv, notes)
      VALUES (${body.listing_id}, ${user.id}, ${body.recipient_org || null}, ${body.estimated_lb || null}, ${body.fmv || null}, ${body.notes || null})
      RETURNING *
    `;

    // Mark listing as 'donated'
    await sql`UPDATE listings SET status = 'donated', donate_to_foodbank = TRUE, donation_recipient_org = ${body.recipient_org || null}, updated_at = NOW() WHERE id = ${body.listing_id}`;

    return json({ donation: rows[0] });
  }

  return err(405, 'Method not allowed');
}
