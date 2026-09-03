// Shared harvest display helper.
// Display-only: never invents harvest_window_end from birth_date.
//
//   start AND end  → "Jun 20, 2025 – Sep 15, 2026"
//   earliest only  → that date (not presented as a whole window)
//   neither        → "TBD"
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.harvestLabel = api.harvestLabel;
    root.POHarvest = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parseIsoDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const s = String(value).trim();
    const iso = s.slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function formatHuman(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function harvestLabel(listing) {
    const row = listing && typeof listing === 'object' ? listing : {};
    // expected_finish_date is the earliest ISO only — never treat it as the
    // whole harvest field. Do not read birth_date.
    const start = parseIsoDate(row.harvest_window_start || row.expected_finish_date);
    const end = parseIsoDate(row.harvest_window_end);
    if (start && end) return formatHuman(start) + ' – ' + formatHuman(end);
    if (start) return formatHuman(start);
    return 'TBD';
  }

  return { harvestLabel: harvestLabel, parseIsoDate: parseIsoDate };
});
