// /api/pdf/tax-letter — Generate the IRS-compliant donation acknowledgment letter
//
// GET /api/pdf/tax-letter?donation=<id>
//   200 application/pdf  → streams the letter
//   401  → not signed in or not the donor
//   404  → donation not found
//
// IRS requirements covered (Pub 1771):
//   - Charity name + address + tax-exempt status
//   - Date of contribution (signed Deed of Gift)
//   - Description of donated property (no $ value attributed by charity for non-cash)
//   - Statement: "no goods or services were provided in exchange"
//   - Donor name + address
//
// Note: Final hanging weight + estimated FMV are reported as informational data
// the donor uses with their CPA. The charity does NOT assign a dollar value to
// non-cash gifts — that's the donor's responsibility.

import { sql, currentUser, err } from '../_lib/db.js';
import { pdfResponse, header, footer, paragraph, fieldGrid, BRAND } from '../_lib/pdf.js';

// ⚠ KNOWN ISSUE (2026-05-17): nodejs functions hang past 14s when invoked
// via the www.proteinoutfitters.com production alias. Edge endpoints work
// fine; nodejs endpoints respond fast on the preview URL of the same
// deployment. This is a project-level routing/config issue on Vercel that
// needs admin investigation — possibly DATABASE_URL not exposed to nodejs
// functions on the production domain, or a stale function deployment.
// /api/pdf/* will fail (504) on www.proteinoutfitters.com until that's
// fixed; pdfkit can't move to edge (needs Buffer + streams + fs for fonts).
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
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';

async function _handler(req) {
  if (req.method !== 'GET') return err(405, 'Method not allowed');
  const url = new URL(req.url, 'http://' + (req.headers?.host || 'www.proteinoutfitters.com'));
  const donationId = url.searchParams.get('donation');
  if (!donationId) return err(400, 'donation id required');

  const user = await currentUser(req);
  if (!user) return err(401, 'Sign in required');

  // Fetch donation + linked listing/farm/donor
  const rows = await sql`
    SELECT d.*, l.number AS animal_number, l.breed, l.species, l.estimated_hanging_weight,
           l.expected_finish_date, f.name AS farm_name, f.city AS farm_city, f.state AS farm_state,
           u.name AS donor_name, u.email AS donor_email, u.zip AS donor_zip
    FROM donations d
    LEFT JOIN listings l ON l.id = d.listing_id
    LEFT JOIN farms f ON f.id = l.farm_id
    LEFT JOIN users u ON u.id = d.donor_id
    WHERE d.id = ${donationId} LIMIT 1`;
  const d = rows[0];
  if (!d) return err(404, 'Donation not found');

  // Auth: only donor or admin can pull their letter
  if (user.role !== 'admin' && d.donor_id !== user.id) return err(403, 'Not your donation');

  const animalLabel = `${d.animal_number ? d.animal_number + ' · ' : ''}${d.breed || d.species || 'donated animal'}`;
  const filename = `Tax-Letter-${(animalLabel || 'donation').replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;

  return pdfResponse((doc) => {
    header(doc, {
      title: 'Tax acknowledgment letter',
      subtitle: 'IRS Publication 1771 — written acknowledgment of a charitable contribution',
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
      `Date of contribution: ${fmtDate(d.created_at)}`,
    ].join('   ·   '), { size: 9, color: BRAND.ink3 });

    paragraph(doc, ' '); // spacer

    // Greeting
    paragraph(doc, `Dear ${d.donor_name || 'donor'},`, { size: 11, color: BRAND.ink });
    paragraph(doc,
      `Thank you for your generous donation to ${CHARITY.name}. Your contribution helps us feed local food banks, schools, food shelves, and government feeding programs across the upper Midwest.`,
      { size: 11 });

    // Donation summary
    paragraph(doc, 'Donation summary', { bold: true, size: 12, color: BRAND.ink });
    fieldGrid(doc, [
      ['Donor', `${d.donor_name || '—'}${d.donor_email ? ` · ${d.donor_email}` : ''}`],
      ['Origin farm',     `${d.farm_name || '—'}${d.farm_city ? `, ${d.farm_city}, ${d.farm_state || ''}` : ''}`],
      ['Donated property', animalLabel],
      ['Hanging weight',  d.estimated_hanging_weight ? `${d.estimated_hanging_weight} lb` : (d.estimated_lb ? `${d.estimated_lb} lb (estimated take-home)` : '—')],
      ['Estimated FMV',    fmt$(d.fmv)],
      ['Recipient',        d.recipient_org || 'Producer Partnership distribution network'],
      ['Charitable EIN',   CHARITY.ein],
    ]);

    // Disclosures
    paragraph(doc,
      `${CHARITY.name} certifies that no goods or services were provided to the donor in exchange for this contribution.`,
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

    footer(doc, { footnote: `${CHARITY.name} · ${CHARITY.address} · EIN ${CHARITY.ein}` });
  }, filename);
}

// Top-level guard — see deed-of-gift.js for rationale.
export default async function handler(req) {
  try {
    return await _handler(req);
  } catch (e) {
    console.error('[/api/pdf/tax-letter]', e);
    return new Response(
      JSON.stringify({ error: 'pdf_generation_failed', message: String(e?.message || e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
