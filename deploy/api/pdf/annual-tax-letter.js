// /api/pdf/annual-tax-letter — Consolidated year-end donation acknowledgment
//
// GET /api/pdf/annual-tax-letter?year=2025
//   200 application/pdf  → streams the consolidated letter for the signed-in donor
//   401  → not signed in
//   404  → no qualifying donations for that year
//
// GET /api/pdf/annual-tax-letter?year=2025&donor=<user_id>     (admin only)
//   Lets ops generate any donor's letter (for re-issue or audit)
//
// Aggregates every donation for one donor across the requested calendar year
// into a single IRS Pub 1771 acknowledgment with an itemized table.

import { sql, currentUser, err } from '../_lib/db.js';
import { pdfResponse, header, footer, paragraph, fieldGrid, BRAND } from '../_lib/pdf.js';

export const config = { runtime: 'nodejs' };

const CHARITY = {
  name: 'Producer Partnership, Inc.',
  status: 'A 501(c)(3) charitable organization',
  ein: process.env.PARTNER_EIN || '81-1234567',
  address: process.env.PARTNER_ADDRESS || '1234 Farm Road, Bozeman, MT 59715',
  signer: process.env.PARTNER_SIGNER || 'M. Stittsworth, on behalf of Producer Partnership',
};

const fmt$ = (n) => n != null
  ? Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default async function handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get('year') || (new Date().getFullYear() - 1), 10);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) return err(400, 'Invalid year');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  // Admins can request any donor; everyone else only gets their own.
  const adminDonor = url.searchParams.get('donor');
  let donorId = user.id;
  if (adminDonor) {
    if (user.role !== 'admin') return err(403, 'Admin only');
    donorId = adminDonor;
  }

  // Fetch donor profile + every qualifying donation in the calendar year
  const donorRows = await sql`
    SELECT id, name, email, zip FROM users WHERE id = ${donorId} LIMIT 1`;
  const donor = donorRows[0];
  if (!donor) return err(404, 'Donor not found');

  const donations = await sql`
    SELECT d.id, d.fmv, d.estimated_lb, d.recipient_org, d.status, d.created_at,
           l.number AS animal_number, l.breed, l.species, l.estimated_hanging_weight,
           f.name AS farm_name, f.city AS farm_city, f.state AS farm_state
    FROM donations d
    LEFT JOIN listings l ON l.id = d.listing_id
    LEFT JOIN farms f ON f.id = l.farm_id
    WHERE d.donor_id = ${donorId}
      AND d.status NOT IN ('cancelled')
      AND EXTRACT(YEAR FROM d.created_at) = ${year}
    ORDER BY d.created_at ASC`;

  if (!donations.length) return err(404, `No donations found for ${donor.name || 'this donor'} in ${year}`);

  const totalFMV = donations.reduce((s, d) => s + (Number(d.fmv) || 0), 0);
  const totalLb  = donations.reduce((s, d) => s + (Number(d.estimated_hanging_weight) || Number(d.estimated_lb) || 0), 0);
  const oldest = donations[0].created_at;
  const newest = donations[donations.length - 1].created_at;

  const filename = `${year}-Tax-Letter-${(donor.name || 'donor').replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;

  return pdfResponse((doc) => {
    header(doc, {
      title: `${year} consolidated tax acknowledgment`,
      subtitle: 'IRS Publication 1771 — written acknowledgment of charitable contributions',
    });

    // Issuer block
    paragraph(doc, CHARITY.name, { bold: true, size: 12, color: BRAND.ink });
    paragraph(doc, [
      CHARITY.status,
      `EIN ${CHARITY.ein}`,
      CHARITY.address,
    ].join(' · '), { size: 9, color: BRAND.ink3 });

    paragraph(doc, [
      `Date of letter: ${fmtDate(new Date())}`,
      `Tax year: ${year}`,
    ].join('   ·   '), { size: 9, color: BRAND.ink3 });

    paragraph(doc, ' ');

    // Greeting
    paragraph(doc, `Dear ${donor.name || 'donor'},`, { size: 11, color: BRAND.ink });
    paragraph(doc,
      `Thank you for your generous contributions to ${CHARITY.name} during ${year}. This letter acknowledges every donation you made through Protein Outfitters in that calendar year, in one consolidated record for your tax preparer.`,
      { size: 11 });

    // Year totals card
    paragraph(doc, `${year} Summary`, { bold: true, size: 12, color: BRAND.ink });
    fieldGrid(doc, [
      ['Donor',           `${donor.name || '—'}${donor.email ? ` · ${donor.email}` : ''}`],
      ['Donation count',  String(donations.length)],
      ['First donation',  fmtDate(oldest)],
      ['Most recent',     fmtDate(newest)],
      ['Total weight',    totalLb ? `${totalLb.toLocaleString()} lb` : '—'],
      ['Total estimated FMV', fmt$(totalFMV)],
      ['Charitable EIN',  CHARITY.ein],
    ]);

    // Itemized table
    paragraph(doc, 'Itemized donations', { bold: true, size: 12, color: BRAND.ink });
    paragraph(doc, ' ', { size: 4 });

    // Render a simple table using fixed column widths.
    const PAGE_WIDTH = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cols = [
      { header: 'Date',     w: PAGE_WIDTH * 0.14 },
      { header: 'Animal',   w: PAGE_WIDTH * 0.34 },
      { header: 'Origin farm', w: PAGE_WIDTH * 0.26 },
      { header: 'Weight',   w: PAGE_WIDTH * 0.12, align: 'right' },
      { header: 'Est. FMV', w: PAGE_WIDTH * 0.14, align: 'right' },
    ];

    const startX = doc.page.margins.left;
    let y = doc.y;
    const rowH = 20;

    function drawRow(values, opts = {}) {
      let x = startX;
      const isHeader = !!opts.header;
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(isHeader ? 9 : 9.5)
         .fillColor(isHeader ? BRAND.ink : BRAND.ink2);
      values.forEach((v, i) => {
        const c = cols[i];
        doc.text(String(v ?? '—'), x + 6, y + 5, {
          width: c.w - 12,
          align: c.align || 'left',
          ellipsis: true,
          height: rowH - 6,
        });
        x += c.w;
      });
      // Border underline
      if (isHeader) {
        doc.strokeColor(BRAND.ink2).lineWidth(0.6)
           .moveTo(startX, y + rowH).lineTo(startX + PAGE_WIDTH, y + rowH).stroke();
      } else {
        doc.strokeColor('#e3ddc7').lineWidth(0.4)
           .moveTo(startX, y + rowH).lineTo(startX + PAGE_WIDTH, y + rowH).stroke();
      }
      y += rowH;
    }

    function pageBreakIfNeeded() {
      const bottom = doc.page.height - doc.page.margins.bottom - 80;
      if (y > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawRow(cols.map(c => c.header), { header: true });
      }
    }

    drawRow(cols.map(c => c.header), { header: true });
    donations.forEach(d => {
      pageBreakIfNeeded();
      const animal = `${d.animal_number ? d.animal_number + ' · ' : ''}${d.breed || d.species || 'animal'}`;
      const origin = `${d.farm_name || '—'}${d.farm_city ? ', ' + d.farm_city + (d.farm_state ? ', ' + d.farm_state : '') : ''}`;
      const wt = d.estimated_hanging_weight ? `${d.estimated_hanging_weight} lb`
              : d.estimated_lb ? `${d.estimated_lb} lb` : '—';
      drawRow([fmtDate(d.created_at), animal, origin, wt, fmt$(d.fmv)]);
    });
    // Totals row
    drawRow(['', '', 'Year totals', totalLb ? `${totalLb.toLocaleString()} lb` : '—', fmt$(totalFMV)], { header: true });

    // Move doc.y past the table
    doc.y = y + 14;
    doc.fillColor(BRAND.ink);

    // Disclosures (same compliance language as single-donation letter)
    paragraph(doc, ' ');
    paragraph(doc,
      `${CHARITY.name} certifies that no goods or services were provided to the donor in exchange for these contributions.`,
      { bold: true, size: 11 });

    paragraph(doc,
      `${CHARITY.name} is a tax-exempt organization under section 501(c)(3) of the Internal Revenue Code. Donations are deductible to the extent allowed by law.`,
      { size: 10, color: BRAND.ink3 });

    paragraph(doc,
      'For raised livestock, the IRS generally limits the donor\'s charitable deduction to the donor\'s tax basis in the animal. Some donations of "wholesome food" qualify for an enhanced deduction up to 2× basis, capped at fair market value. Talk to your tax professional for guidance on your specific deduction.',
      { size: 10, color: BRAND.ink3 });

    paragraph(doc,
      'No dollar value has been assigned by the recipient charity. Any value-related figures above are informational and reflect the donor\'s estimate; valuation for tax purposes is the donor\'s responsibility (see IRS Publication 561 for non-cash contribution valuation).',
      { size: 10, color: BRAND.ink3 });

    // Signature
    paragraph(doc, ' ');
    paragraph(doc, 'Signed,', { size: 11 });
    paragraph(doc, ' ');
    paragraph(doc, CHARITY.signer, { size: 11, bold: true, color: BRAND.ink });
    paragraph(doc, fmtDate(new Date()), { size: 10, color: BRAND.ink3 });

    footer(doc, { footnote: `${CHARITY.name} · ${CHARITY.address} · EIN ${CHARITY.ein} · ${year} consolidated acknowledgment` });
  }, filename);
}
