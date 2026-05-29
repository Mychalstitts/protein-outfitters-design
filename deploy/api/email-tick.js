// /api/email-tick — sweeps for time-based lifecycle emails and fires them.
//
// Designed to be called once a day from a cron (Vercel Cron or external).
// Idempotent — `email_log.dedup_key` blocks re-sending the same trigger.
//
// What it fires (on the hour the cron runs):
//   C2  Cut-sheet reminder         T-14 days, no cut sheet on file
//   C4  Balance capture warning    T-9  days
//   C16 Animal arrived             posted by webhook on QR check-in (not by us)
//   F4  Drop-off reminder          T-3  days
//   P3  Check-in reminder          T-1  day
//
// Auth: requires ?secret=$EMAIL_TICK_SECRET to prevent random callers.
//
// Vercel cron config (vercel.json):
//   { "crons": [{ "path": "/api/email-tick?secret=...", "schedule": "0 14 * * *" }] }

import { sql, err, json, nodejsHandler } from './_lib/db.js';
import { sendLifecycleEmail } from './_lib/email.js';

export const config = { runtime: 'nodejs' };

// Helper: list reservations whose drop-off date is exactly N days out.
async function reservationsAtDayOffset(daysOut) {
  return await sql`
    SELECT r.id, r.share_size, r.buyer_email, r.buyer_name, r.deposit_amount,
           r.total_estimate, r.cut_sheet, r.processor_id, r.listing_id,
           l.number AS animal_number, l.breed, l.species, l.expected_finish_date,
           f.id   AS farm_id, f.name AS farm_name, f.city AS farm_city, f.state AS farm_state,
           p.id   AS processor_id_full, p.slug AS processor_slug, p.name AS processor_name
    FROM reservations r
    JOIN listings l ON l.id = r.listing_id
    JOIN farms f    ON f.id = l.farm_id
    LEFT JOIN processors p ON p.id = r.processor_id
    WHERE r.status NOT IN ('cancelled','refunded','picked-up')
      AND l.expected_finish_date IS NOT NULL
      AND l.expected_finish_date::date = (CURRENT_DATE + (${daysOut} || ' days')::interval)::date
  `;
}

// Helper: farms with active reservations at offset (one email per booking, deduped via email_log).
async function farmerBookingsAtDayOffset(daysOut) {
  return await sql`
    SELECT DISTINCT ON (l.id)
           l.id AS listing_id, l.number, l.breed, l.species, l.expected_finish_date,
           f.id AS farm_id, f.name AS farm_name,
           u.email AS farmer_email, u.name AS farmer_name,
           p.id AS processor_id, p.name AS processor_name
    FROM listings l
    JOIN farms f ON f.id = l.farm_id
    JOIN users u ON u.id = f.owner_id
    LEFT JOIN reservations r ON r.listing_id = l.id AND r.status NOT IN ('cancelled','refunded')
    LEFT JOIN processors p ON p.id = r.processor_id
    WHERE l.expected_finish_date IS NOT NULL
      AND l.expected_finish_date::date = (CURRENT_DATE + (${daysOut} || ' days')::interval)::date
      AND u.email IS NOT NULL
  `;
}

async function processorBookingsAtDayOffset(daysOut) {
  return await sql`
    SELECT DISTINCT ON (l.id, p.id)
           l.id AS listing_id, l.number, l.breed, l.species, l.expected_finish_date,
           f.name AS farm_name,
           p.id AS processor_id, p.name AS processor_name,
           pu.email AS processor_email, pu.name AS processor_contact
    FROM reservations r
    JOIN listings l    ON l.id = r.listing_id
    JOIN farms f       ON f.id = l.farm_id
    JOIN processors p  ON p.id = r.processor_id
    JOIN users pu      ON pu.id = p.owner_id
    WHERE r.status NOT IN ('cancelled','refunded')
      AND l.expected_finish_date IS NOT NULL
      AND l.expected_finish_date::date = (CURRENT_DATE + (${daysOut} || ' days')::interval)::date
      AND pu.email IS NOT NULL
  `;
}

const animalLabelOf = (r) => `${r.animal_number ? r.animal_number + ' · ' : ''}${r.breed || r.species || 'animal'}`;
const fractionPretty = (s) => ({whole:'Whole animal', half:'Half share', quarter:'Quarter share', eighth:'Eighth share'}[s] || 'Share');

async function handler(req) {
  // Vercel Node runtime delivers req.url as a relative path; URL() needs a base.
  // The host doesn't matter for query-string parsing.
  const url = new URL(req.url, 'https://www.proteinoutfitters.com');

  // Two auth paths:
  // 1. Vercel Cron — sets `Authorization: Bearer ${CRON_SECRET}` automatically.
  // 2. Manual call — pass ?secret=$EMAIL_TICK_SECRET.
  const auth = req.headers.get('authorization') || '';
  const isVercelCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const manualSecret = url.searchParams.get('secret');
  const isManualOK = process.env.EMAIL_TICK_SECRET && manualSecret === process.env.EMAIL_TICK_SECRET;
  if (!isVercelCron && !isManualOK) {
    return err(401, 'Unauthorized — Vercel cron uses CRON_SECRET; manual calls use ?secret=$EMAIL_TICK_SECRET');
  }

  const results = { c2: 0, c4: 0, f4: 0, p3: 0, f11_noshow: 0, errors: [] };

  // ─── C2: cutsheet reminder T-14 ─────────────────────────────────
  try {
    const rows = await reservationsAtDayOffset(14);
    for (const r of rows) {
      // Skip if cut sheet already on file
      if (r.cut_sheet && Object.keys(r.cut_sheet || {}).length > 0) continue;
      const out = await sendLifecycleEmail('C2.cutsheet_reminder', {
        to: r.buyer_email,
        reservation_id: r.id,
        buyer_name: r.buyer_name,
        cutsheet_deadline: new Date(r.expected_finish_date).toISOString(),
        processor_slug: r.processor_slug,
        dedupKey: `C2::${r.id}`,
      });
      if (out.sent) results.c2++;
    }
  } catch (e) { results.errors.push(`C2: ${e.message}`); }

  // ─── C4: balance capture warning T-9 ────────────────────────────
  try {
    const rows = await reservationsAtDayOffset(9);
    for (const r of rows) {
      const balance = Number(r.total_estimate || 0) - Number(r.deposit_amount || 0);
      const captureDate = new Date(r.expected_finish_date);
      captureDate.setDate(captureDate.getDate() - 7);
      const out = await sendLifecycleEmail('C4.balance_capture_warning', {
        to: r.buyer_email,
        reservation_id: r.id,
        buyer_name: r.buyer_name,
        animal_label: animalLabelOf(r),
        balance_amount: balance,
        balance_capture_date: captureDate.toISOString(),
        dedupKey: `C4::${r.id}`,
      });
      if (out.sent) results.c4++;
    }
  } catch (e) { results.errors.push(`C4: ${e.message}`); }

  // ─── F4: drop-off reminder T-3 ──────────────────────────────────
  try {
    const rows = await farmerBookingsAtDayOffset(3);
    for (const r of rows) {
      const out = await sendLifecycleEmail('F4.dropoff_reminder', {
        to: r.farmer_email,
        farm_id: r.farm_id,
        listing_id: r.listing_id,
        farmer_name: r.farmer_name,
        animal_label: animalLabelOf(r),
        drop_off_date: r.expected_finish_date,
        processor_name: r.processor_name,
        booking_id: r.listing_id, // proxy until bookings table exists
        dedupKey: `F4::${r.listing_id}`,
      });
      if (out.sent) results.f4++;
    }
  } catch (e) { results.errors.push(`F4: ${e.message}`); }

  // ─── P3: check-in reminder T-1 ──────────────────────────────────
  try {
    const rows = await processorBookingsAtDayOffset(1);
    for (const r of rows) {
      const out = await sendLifecycleEmail('P3.checkin_reminder', {
        to: r.processor_email,
        processor_id: r.processor_id,
        listing_id: r.listing_id,
        processor_contact: r.processor_contact,
        farm_name: r.farm_name,
        animal_label: animalLabelOf(r),
        dedupKey: `P3::${r.processor_id}::${r.listing_id}`,
      });
      if (out.sent) results.p3++;
    }
  } catch (e) { results.errors.push(`P3: ${e.message}`); }

  // ─── F11: farmer no-show — sweep bookings with drop-off in the past + still scheduled ──
  // Forfeits the deposit, flips the booking, and emails the farmer.
  try {
    const stale = await sql`
      SELECT b.id AS booking_id, b.farm_id, b.listing_id, b.processor_id, b.drop_off_date,
             l.number AS animal_number, l.breed, l.species,
             f.name AS farm_name, fu.email AS farmer_email, fu.name AS farmer_name,
             p.name AS processor_name,
             d.amount AS deposit_amount, d.status AS deposit_status
      FROM bookings b
      JOIN listings l   ON l.id = b.listing_id
      JOIN farms f      ON f.id = b.farm_id
      JOIN users fu     ON fu.id = f.owner_id
      JOIN processors p ON p.id = b.processor_id
      LEFT JOIN farmer_deposits d ON d.booking_id = b.id
      WHERE b.status = 'scheduled'
        AND b.drop_off_date < CURRENT_DATE
        AND b.drop_off_date >= (CURRENT_DATE - INTERVAL '14 days')`;
    for (const r of stale) {
      // Mark booking + deposit
      await sql`UPDATE bookings SET status = 'no-show', no_show_at = NOW(), updated_at = NOW() WHERE id = ${r.booking_id}`;
      if (r.deposit_status === 'held') {
        await sql`UPDATE farmer_deposits SET status = 'forfeit', forfeit_at = NOW(), updated_at = NOW() WHERE booking_id = ${r.booking_id}`;
      }
      // Best-effort email — F11 isn't a registered template yet, but we still log the event.
      // When F11 lands in TEMPLATES it'll auto-pick up.
      try {
        const out = await sendLifecycleEmail('F11.no_show_flag', {
          to: r.farmer_email,
          farm_id: r.farm_id,
          farmer_name: r.farmer_name,
          animal_label: `${r.animal_number ? r.animal_number + ' · ' : ''}${r.breed || r.species || 'animal'}`,
          drop_off_date: r.drop_off_date,
          processor_name: r.processor_name,
          deposit_amount: r.deposit_amount,
          dedupKey: `F11::${r.booking_id}`,
        });
        if (out.sent) results.f11_noshow++;
      } catch (e) { /* template not registered yet — fine */ }
    }
  } catch (e) { results.errors.push(`F11: ${e.message}`); }

  return json({
    ok: true,
    ranAt: new Date().toISOString(),
    sent: results,
  });
}

export default nodejsHandler(handler);
