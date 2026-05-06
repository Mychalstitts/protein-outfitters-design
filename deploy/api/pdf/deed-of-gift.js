// /api/pdf/deed-of-gift — Generate the Deed of Gift PDF for a donation
//
// GET /api/pdf/deed-of-gift?donation=<id>
//   200 application/pdf  → streams the deed
//
// The Deed of Gift is the legal instrument transferring title of the donated
// animal/share from the donor to the receiving 501(c)(3). Donor signs once
// (e-signature flow already in donation-flow.html); this endpoint produces
// the file the donor and charity each retain a copy of.

import { sql, currentUser, err } from '../_lib/db.js';
import { pdfResponse, header, footer, paragraph, fieldGrid, signatureBlock, BRAND } from '../_lib/pdf.js';

export const config = { runtime: 'nodejs' };

const CHARITY = {
  name: 'Producer Partnership, Inc.',
  state: 'Montana',
  status: '501(c)(3)',
  signer: process.env.PARTNER_SIGNER || 'M. Stittsworth, on behalf of Producer Partnership',
  signer_title: process.env.PARTNER_SIGNER_TITLE || 'Authorized Representative',
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';

export default async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const url = new URL(req.url);
  const donationId = url.searchParams.get('donation');
  if (!donationId) return err(400, 'donation id required');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  const rows = await sql`
    SELECT d.*, l.number AS animal_number, l.breed, l.species, l.estimated_hanging_weight,
           l.expected_finish_date,
           f.name AS farm_name, f.city AS farm_city, f.state AS farm_state,
           u.name AS donor_name, u.email AS donor_email
    FROM donations d
    LEFT JOIN listings l ON l.id = d.listing_id
    LEFT JOIN farms f ON f.id = l.farm_id
    LEFT JOIN users u ON u.id = d.donor_id
    WHERE d.id = ${donationId} LIMIT 1`;
  const d = rows[0];
  if (!d) return err(404, 'Donation not found');
  if (user.role !== 'admin' && d.donor_id !== user.id) return err(403, 'Not your donation');

  const animalLabel = `${d.animal_number ? d.animal_number + ' · ' : ''}${d.breed || d.species || 'donated animal'}`;
  const filename = `Deed-of-Gift-${animalLabel.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;

  return pdfResponse((doc) => {
    header(doc, {
      title: 'Deed of Gift',
      subtitle: 'Charitable transfer of title — for retention by donor and donee',
    });

    paragraph(doc,
      `THIS DEED OF GIFT, made effective ${fmtDate(d.created_at)}, between:`,
      { size: 11 });

    // Parties
    paragraph(doc, '1. The Donor', { bold: true, size: 11, color: BRAND.ink });
    fieldGrid(doc, [
      ['Name',  d.donor_name || '—'],
      ['Origin farm', d.farm_name ? `${d.farm_name}${d.farm_city ? `, ${d.farm_city}, ${d.farm_state || ''}` : ''}` : '—'],
      ['Email', d.donor_email || '—'],
    ]);

    paragraph(doc, '2. The Donee', { bold: true, size: 11, color: BRAND.ink });
    fieldGrid(doc, [
      ['Organization', CHARITY.name],
      ['Type', `${CHARITY.state} ${CHARITY.status} corporation`],
      ['Acting through', `${CHARITY.signer}, ${CHARITY.signer_title}`],
    ]);

    // Recitals
    paragraph(doc, 'WITNESSETH:', { bold: true, size: 11 });
    paragraph(doc,
      `WHEREAS the Donor desires to make a charitable contribution of the donated property identified below to the Donee in furtherance of the Donee's tax-exempt charitable purposes; and`);
    paragraph(doc,
      `WHEREAS the Donee, a tax-exempt organization under section 501(c)(3) of the Internal Revenue Code, agrees to accept the donated property and use it solely in furtherance of its charitable mission;`);
    paragraph(doc,
      `NOW, THEREFORE, in consideration of the mutual covenants set forth below, the parties agree:`);

    // Operative provisions
    paragraph(doc, '3. Donated property', { bold: true, size: 11, color: BRAND.ink });
    fieldGrid(doc, [
      ['Description',        animalLabel],
      ['Origin',             d.farm_name || '—'],
      ['Estimated yield',    d.estimated_lb ? `${d.estimated_lb} lb take-home protein` : '—'],
      ['Hanging weight',     d.estimated_hanging_weight ? `${d.estimated_hanging_weight} lb` : '—'],
      ['Scheduled processing', fmtDate(d.expected_finish_date)],
    ]);

    paragraph(doc, '4. Transfer of title', { bold: true, size: 11, color: BRAND.ink });
    paragraph(doc,
      `The Donor hereby transfers, conveys, and gifts to the Donee all right, title, and interest in and to the donated property identified above, free and clear of all liens and encumbrances, effective on the date first written above.`);

    paragraph(doc, '5. Donor warranties', { bold: true, size: 11, color: BRAND.ink });
    paragraph(doc,
      `The Donor warrants that (a) the Donor has full title to the donated property, (b) the property is healthy and fit for human consumption to the best of the Donor's knowledge, and (c) no third party has a competing interest, lien, or encumbrance on the donated property.`);

    paragraph(doc, '6. No goods or services', { bold: true, size: 11, color: BRAND.ink });
    paragraph(doc,
      `The Donee certifies that no goods or services were provided to the Donor in exchange for this contribution. The Donor is solely responsible for any tax valuation under IRC §170 and IRS Publication 561.`);

    paragraph(doc, '7. Acceptance', { bold: true, size: 11, color: BRAND.ink });
    paragraph(doc,
      `The Donee accepts the donated property in furtherance of its charitable mission of distributing meat to qualified feeding programs, food banks, schools, and government feeding programs.`);

    // Signatures
    paragraph(doc, 'IN WITNESS WHEREOF, the parties have executed this Deed of Gift as of the date first written above.',
      { size: 10, color: BRAND.ink3 });

    signatureBlock(doc, { lines: ['Donor signature', 'Date'] });
    paragraph(doc, d.donor_name || ' ', { size: 10, color: BRAND.ink3 });

    signatureBlock(doc, { lines: ['Donee signature (Producer Partnership)', 'Date'] });
    paragraph(doc, `${CHARITY.signer}, ${CHARITY.signer_title}`, { size: 10, color: BRAND.ink3 });

    footer(doc, { footnote: `Deed of Gift — Donation ${donationId.slice(0, 8)} · ${CHARITY.name}` });
  }, filename);
}
