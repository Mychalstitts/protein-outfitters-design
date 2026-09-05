// Stittsworth Smokehouse harvest jobs — shared trailer calendar (Phase A1).
// Pure helpers: validate payloads, quote kill+trip, roll up daily capacity.
// Persistence lives in /api/harvest-jobs → harvest_jobs (Neon). This file
// does not write a database and does not touch checkout or listing 123.
// Smokehouse-only: processor_slug is always stittsworth-smokehouse.

(function (root, factory) {
  const harvest = (typeof module === 'object' && module.exports)
    ? require('./stittsworth-harvest.js')
    : (root && root.POStittsworth);
  const api = factory(harvest);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.POHarvestJobs = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (H) {
  'use strict';

  const PROCESSOR_SLUG = 'stittsworth-smokehouse';
  const PROCESSOR_NAME = 'Stittsworth Smokehouse';
  const SOURCES = ['app', 'phone'];
  const STATUSES = ['requested', 'confirmed', 'capacity_used', 'cancelled'];
  const SHARE_KINDS = ['whole', 'half', 'quarter'];
  const SPECIES = ['beef', 'hog', 'lamb', 'goat', 'bison'];

  function clampHeads(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(4, n));
  }

  function normalizeShare(raw) {
    const s = String(raw || 'whole').toLowerCase().trim();
    if (s === 'side' || s === 'half') return 'half';
    if (s === 'quarter') return 'quarter';
    return 'whole';
  }

  function normalizeSource(raw) {
    const s = String(raw || '').toLowerCase().trim();
    return s === 'phone' ? 'phone' : 'app';
  }

  function normalizeStatus(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (STATUSES.indexOf(s) !== -1) return s;
    return 'requested';
  }

  function isKnownTown(name) {
    const key = String(name || '').trim().toLowerCase();
    return !!(H && H.TOWNS && H.TOWNS.some((t) => t.name.toLowerCase() === key));
  }

  function isAllowedSpecies(species) {
    return SPECIES.indexOf(H.normalizeSpecies(species)) !== -1;
  }

  function countsTowardCapacity(status) {
    return normalizeStatus(status) !== 'cancelled';
  }

  function isoDay(value) {
    if (!H || !H.isoDate) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return H.isoDate(value);
  }

  function bookedHeadsByDay(jobs) {
    const map = {};
    (jobs || []).forEach((j) => {
      if (!j || !countsTowardCapacity(j.status)) return;
      const iso = isoDay(j.trailer_day);
      if (!iso) return;
      map[iso] = (map[iso] || 0) + clampHeads(j.heads);
    });
    return map;
  }

  function remainingCapacity(iso, bookedMap, capacity) {
    const cap = Number.isFinite(Number(capacity)) ? Number(capacity) : H.DAILY_HARVEST_CAPACITY;
    const booked = Number(bookedMap && bookedMap[iso]) || 0;
    return Math.max(0, cap - booked);
  }

  function canFitJob(jobs, opts) {
    const o = opts || {};
    const day = isoDay(o.day || o.trailer_day);
    if (!day) return false;
    const heads = clampHeads(o.heads);
    const excludeId = o.excludeId || o.id || null;
    const others = (jobs || []).filter((j) => !excludeId || j.id !== excludeId);
    const booked = bookedHeadsByDay(others);
    return remainingCapacity(day, booked, o.capacity) >= heads;
  }

  function quoteJob(species, town, heads) {
    const due = H.harvestDue(species, town, heads);
    return {
      kill_due: due.kill,
      trip_due: due.trip,
      total_due: due.total,
    };
  }

  function defaultStatusForSource(source) {
    return normalizeSource(source) === 'phone' ? 'confirmed' : 'requested';
  }

  function validateJobInput(body, opts) {
    const o = opts || {};
    const errors = [];
    const raw = body && typeof body === 'object' ? body : {};
    const farm_name = String(raw.farm_name || raw.farm || '').trim().slice(0, 120);
    const townName = String(raw.town || '').trim();
    const species = H.normalizeSpecies(raw.species || 'beef');
    const heads = clampHeads(raw.heads);
    const share_kind = normalizeShare(raw.share_kind || raw.share);
    const source = normalizeSource(raw.source);
    const trailer_day = isoDay(raw.trailer_day || raw.date);
    const phone = String(raw.phone || '').trim().slice(0, 40);
    const notes = String(raw.notes || '').trim().slice(0, 500);
    const listing_id = raw.listing_id ? String(raw.listing_id).trim() : null;

    if (!farm_name) errors.push('farm_name required');
    if (!townName) errors.push('town required');
    else if (!isKnownTown(townName)) errors.push('town must be on the Smokehouse list');
    if (!isAllowedSpecies(species)) errors.push('species not offered on this trailer');
    if (!trailer_day) errors.push('trailer_day required');
    else if (!H.isHarvestWeekday(trailer_day)) errors.push('trailer_day must be a harvest weekday (Tue–Thu)');

    if (source === 'app' && !o.skipCompass && trailer_day && townName && isKnownTown(townName)) {
      const now = o.now || new Date();
      if (!H.isSelectableTrailerDay(trailer_day, townName, { now: now })) {
        errors.push('trailer_day is not leftover harvest on that town’s compass week');
      }
    }

    if (listing_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listing_id)) {
      errors.push('listing_id must be a UUID');
    }

    const town = H.resolveTown(townName);
    const quote = quoteJob(species, town, heads);
    const status = raw.status ? normalizeStatus(raw.status) : defaultStatusForSource(source);

    const job = {
      processor_slug: PROCESSOR_SLUG,
      farm_name: farm_name,
      town: town.name,
      species: species,
      heads: heads,
      share_kind: share_kind,
      trailer_day: trailer_day,
      source: source,
      status: status,
      kill_due: quote.kill_due,
      trip_due: quote.trip_due,
      total_due: quote.total_due,
      phone: phone || null,
      notes: notes || null,
      listing_id: listing_id || null,
    };

    const existing = o.existingJobs || [];
    if (job.trailer_day && countsTowardCapacity(job.status) && !canFitJob(existing, {
      day: job.trailer_day,
      heads: job.heads,
      excludeId: o.excludeId,
      capacity: o.capacity,
    })) {
      errors.push('not enough leftover harvest on that trailer day');
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      job: job,
    };
  }

  function publicJob(row) {
    if (!row) return null;
    const share = normalizeShare(row.share_kind || row.share);
    return {
      id: row.id,
      processor_slug: PROCESSOR_SLUG,
      processor_name: PROCESSOR_NAME,
      farm_name: row.farm_name,
      town: row.town,
      species: H.normalizeSpecies(row.species),
      heads: clampHeads(row.heads),
      share_kind: share,
      share_label: H.SHARE_LABELS[share] || 'Whole',
      trailer_day: isoDay(row.trailer_day),
      source: normalizeSource(row.source),
      status: normalizeStatus(row.status),
      kill_due: Number(row.kill_due) || 0,
      trip_due: Number(row.trip_due) || 0,
      total_due: Number(row.total_due) || 0,
      phone: row.phone || null,
      notes: row.notes || null,
      listing_id: row.listing_id || null,
      created_by: row.created_by || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    };
  }

  function isPlantStaff(user) {
    const role = String(user && user.role || '').toLowerCase();
    return role === 'processor' || role === 'admin';
  }

  return {
    PROCESSOR_SLUG: PROCESSOR_SLUG,
    PROCESSOR_NAME: PROCESSOR_NAME,
    SOURCES: SOURCES,
    STATUSES: STATUSES,
    SHARE_KINDS: SHARE_KINDS,
    SPECIES: SPECIES,
    clampHeads: clampHeads,
    normalizeShare: normalizeShare,
    normalizeSource: normalizeSource,
    normalizeStatus: normalizeStatus,
    isKnownTown: isKnownTown,
    isAllowedSpecies: isAllowedSpecies,
    countsTowardCapacity: countsTowardCapacity,
    isoDay: isoDay,
    bookedHeadsByDay: bookedHeadsByDay,
    remainingCapacity: remainingCapacity,
    canFitJob: canFitJob,
    quoteJob: quoteJob,
    defaultStatusForSource: defaultStatusForSource,
    validateJobInput: validateJobInput,
    publicJob: publicJob,
    isPlantStaff: isPlantStaff,
  };
});
