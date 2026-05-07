// /api/admin/email-preview — render any lifecycle email template inline
//
//   GET  /api/admin/email-preview                       → list of templates + sample contexts
//   GET  /api/admin/email-preview?id=C1.reservation_confirmed → rendered HTML (text/html)
//   GET  /api/admin/email-preview?id=...&format=json    → { subject, html, ctx }
//   POST /api/admin/email-preview?id=...&to=foo@bar.com → fires sendLifecycleEmail with sample ctx
//
// Admin-only. Lets ops QA every customer-facing email without touching real reservations.
// The "test send" path uses a unique dedup_key so it doesn't collide with real lifecycle sends.

import { TEMPLATES, sendLifecycleEmail, listTemplates } from './_lib/email.js';
import { currentUser, err, json } from './_lib/db.js';

export const config = { runtime: 'nodejs' };

// Sample contexts so previews aren't blank — use realistic-looking values.
const SAMPLE_CTX = {
  'C1.reservation_confirmed': {
    buyer_name: 'Sarah Cardinal', buyer_email: 'sarah@example.com',
    fraction_pretty: '1/4 share', animal_label: 'Angus heifer #4421',
    farm_name: 'Twin Pines Ranch', farm_city: 'Bemidji', farm_state: 'MN',
    drop_off_date: '2026-08-12', processor_name: 'Stittsworth Meats',
    deposit_amount: 250, total_estimate: 1450,
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'C2.cutsheet_reminder': {
    buyer_name: 'Sarah Cardinal', drop_off_date: '2026-05-19',
    animal_label: 'Angus heifer #4421',
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'C4.balance_capture_warning': {
    buyer_name: 'Sarah Cardinal', drop_off_date: '2026-05-14',
    estimated_balance: 1200,
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'C8.cancel_confirmation': {
    buyer_name: 'Sarah Cardinal', refund_amount: 250, animal_label: 'Angus heifer #4421',
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'C11.animal_condemned_refund': {
    buyer_name: 'Sarah Cardinal', animal_label: 'Angus heifer #4421',
    refund_amount: 250, condemnation_reason: 'liver abscess detected on inspection',
  },
  'C16.animal_arrived': {
    buyer_name: 'Sarah Cardinal', animal_label: 'Angus heifer #4421',
    processor_name: 'Stittsworth Meats',
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'C18.ready_for_pickup': {
    buyer_name: 'Sarah Cardinal', animal_label: 'Angus heifer #4421',
    pickup_address: '123 Stittsworth Way, Bemidji, MN 56601',
    pickup_window_open: '2026-05-21', pickup_window_close: '2026-05-28',
    final_balance: 1187.50, hanging_weight: 712,
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'C19.delivered_complaint_window': {
    buyer_name: 'Sarah Cardinal', animal_label: 'Angus heifer #4421',
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'C20.complaint_received': {
    buyer_name: 'Sarah Cardinal', complaint_summary: 'Two cuts of brisket appeared overcooked at chill-down.',
    reservation_id: '00000000-0000-0000-0000-000000000001',
  },
  'F2.first_sale_pick_processor': {
    farmer_name: 'Henry Karjala', animal_label: 'Angus heifer #4421',
    listing_id: '00000000-0000-0000-0000-000000000010',
  },
  'F4.dropoff_reminder': {
    farmer_name: 'Henry Karjala', drop_off_date: '2026-05-08',
    processor_name: 'Stittsworth Meats', booking_id: '00000000-0000-0000-0000-000000000020',
  },
  'F7.payout_disbursed': {
    farmer_name: 'Henry Karjala', payout_amount: 2840.00,
    animal_label: 'Angus heifer #4421', transfer_id: 'tr_test_1abc',
  },
  'F11.no_show_flag': {
    farmer_name: 'Henry Karjala', animal_label: 'Angus heifer #4421',
    drop_off_date: '2026-05-05', strike_count: 2,
  },
  'P1.new_booking': {
    processor_name: 'Stittsworth Meats',
    farmer_name: 'Henry Karjala', animal_label: 'Angus heifer #4421',
    drop_off_date: '2026-08-12', checkin_code: 'D7K2-9F',
    booking_id: '00000000-0000-0000-0000-000000000020',
  },
  'P2.cut_sheet_finalized': {
    processor_name: 'Stittsworth Meats', buyer_name: 'Sarah Cardinal',
    animal_label: 'Angus heifer #4421',
    booking_id: '00000000-0000-0000-0000-000000000020',
  },
  'P3.checkin_reminder': {
    processor_name: 'Stittsworth Meats', booking_count: 3,
    next_checkin_date: '2026-05-06',
  },
  'D1.tax_letter_ready': {
    donor_name: 'Janelle Birch', animal_label: 'Hereford steer #5102',
    fmv: 1850, hanging_weight: 740,
    donation_id: '00000000-0000-0000-0000-000000000030',
  },
  'D2.institution_approved': {
    contact_name: 'Pastor Diane', legal_name: 'St. Olaf Food Shelf',
    type: 'foodbank', people_per_week: 220, storage: 'walk-in freezer',
    institution_id: '00000000-0000-0000-0000-000000000040',
  },
  'D3.annual_acknowledgment': {
    donor_name: 'Janelle Birch', year: 2025,
    donation_count: 3, total_lb: 2120, total_fmv: 5440,
    oldest_date: '2025-04-12', newest_date: '2025-12-04',
  },
  'Hardware.lead_received': {
    full_name: 'Bryce Lemoine', bundle_interest: 'mhu', timeline: '3-6m',
  },
};

// Defensive: fallback context for any template not covered above.
const DEFAULT_CTX = { buyer_name: 'Sample User', donor_name: 'Sample Donor', farmer_name: 'Sample Farmer' };

function buildCtx(templateId, override = {}) {
  return {
    to: 'preview@example.com',
    ...DEFAULT_CTX,
    ...(SAMPLE_CTX[templateId] || {}),
    ...override,
  };
}

export default async function handler(req) {
  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return err(403, 'Admin only');

  const url = new URL(req.url, 'https://www.proteinoutfitters.com');
  const id = url.searchParams.get('id');
  const format = url.searchParams.get('format') || (req.method === 'GET' && id ? 'html' : 'json');

  // ── No id → list all templates with their sample contexts ──
  if (req.method === 'GET' && !id) {
    const ids = listTemplates();
    return json({
      templates: ids.map(tid => ({
        id: tid,
        sample_ctx: SAMPLE_CTX[tid] || null,
        has_sample: !!SAMPLE_CTX[tid],
      })),
    });
  }

  if (!id || !TEMPLATES[id]) return err(404, `Unknown template: ${id}`);
  const tpl = TEMPLATES[id];
  const ctx = buildCtx(id);
  let subject, html;
  try {
    subject = tpl.subject(ctx);
    html = tpl.render(ctx);
  } catch (e) {
    return err(500, `Template render failed: ${e.message}`);
  }

  // ── GET: render preview (HTML or JSON) ──
  if (req.method === 'GET') {
    if (format === 'json') return json({ id, subject, ctx, html });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // ── POST: fire a real test send to a chosen address ──
  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch {}
    const to = url.searchParams.get('to') || body.to || user.email;
    if (!to) return err(400, 'Recipient required (?to= or body.to)');
    const testCtx = { ...ctx, to, dedupKey: `test::${id}::${to}::${Date.now()}` };
    const result = await sendLifecycleEmail(id, testCtx);
    return json({ id, to, ...result });
  }

  return err(405, 'Method not allowed');
}
