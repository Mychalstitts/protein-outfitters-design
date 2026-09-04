// Stittsworth Smokehouse — Bemidji list-by-pound + trailer compass.
// Pure helpers (towns, kill, trip floor, 10% platform fee, hub vs quadrant days).
// Display listing harvest dates with harvest-label.js (earliest → 30 months).
// Do not invent a single fake harvest date. Do not persist trailer capacity here.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.POStittsworth = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PLATFORM_FEE_RATE = 0.10;
  const MILEAGE_RATE = 2.50;
  const TRIP_FLOOR = 85;
  const MILES_CAP = 60;
  const CUT_WRAP_PER_LB = 0.90;
  const DAILY_HARVEST_CAPACITY = 4;
  const LOCKED_DRAFT_HANGING_PER_LB = 4.50;

  const SMOKEHOUSE = {
    name: 'Stittsworth Smokehouse',
    address: '7972 Farley Dr NE',
    city: 'Turtle River',
    state: 'MN',
    phone: '(218) 586-2149',
  };

  const SHARE_FRACTIONS = { whole: 1, half: 0.5, side: 0.5, quarter: 0.25 };
  const SHARE_LABELS = {
    whole: 'Whole',
    half: 'Side (½)',
    side: 'Side (½)',
    quarter: 'Quarter',
  };

  const KILL_PER_HEAD = { beef: 185, hog: 95, lamb: 70, goat: 70, bison: 250 };
  const DEFAULT_HANGING_LB = { beef: 720, hog: 195, lamb: 58, goat: 40, bison: 450 };
  const DEFAULT_HANGING_PER_LB = { beef: 5.25, hog: 5.95, lamb: 8.5, goat: 8.25, bison: 9.25 };

  const COMPASS_WEEK = { 1: 'north', 2: 'west', 3: 'south', 4: 'east', 5: 'east' };
  const HARVEST_WEEKDAYS = [2, 3, 4]; // Tue, Wed, Thu

  // Hub towns use hub: true (quadrant is secondary; selectable days key off hub).
  const TOWNS = [
    { name: 'Turtle River', miles: 0, quadrant: 'north', hub: true },
    { name: 'Bemidji', miles: 9, quadrant: 'north', hub: true },
    { name: 'Tenstrike', miles: 12, quadrant: 'north', hub: false },
    { name: 'Funkley', miles: 14, quadrant: 'north', hub: false },
    { name: 'Blackduck', miles: 18, quadrant: 'north', hub: false },
    { name: 'Kelliher', miles: 32, quadrant: 'north', hub: false },
    { name: 'Northome', miles: 40, quadrant: 'north', hub: false },
    { name: 'Solway', miles: 18, quadrant: 'west', hub: false },
    { name: 'Shevlin', miles: 24, quadrant: 'west', hub: false },
    { name: 'Bagley', miles: 34, quadrant: 'west', hub: false },
    { name: 'Clearbrook', miles: 38, quadrant: 'west', hub: false },
    { name: 'Gonvick', miles: 48, quadrant: 'west', hub: false },
    { name: 'Laporte', miles: 28, quadrant: 'south', hub: false },
    { name: 'Walker', miles: 40, quadrant: 'south', hub: false },
    { name: 'Hackensack', miles: 48, quadrant: 'south', hub: false },
    { name: 'Park Rapids', miles: 55, quadrant: 'south', hub: false },
    { name: 'Cass Lake', miles: 20, quadrant: 'east', hub: false },
    { name: 'Bena', miles: 32, quadrant: 'east', hub: false },
    { name: 'Federal Dam', miles: 38, quadrant: 'east', hub: false },
    { name: 'Pennington', miles: 28, quadrant: 'east', hub: false },
  ];

  function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function startOfDay(value) {
    const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function isoDate(value) {
    const d = startOfDay(value);
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function addDays(value, n) {
    const d = startOfDay(value);
    if (!d) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function formatShort(value) {
    const d = startOfDay(value);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function normalizeSpecies(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (s === 'cattle' || s === 'cow' || s === 'steer' || s === 'beef') return 'beef';
    if (s === 'pork' || s === 'pig' || s === 'hog') return 'hog';
    if (s === 'sheep' || s === 'lamb') return 'lamb';
    if (s === 'goat') return 'goat';
    if (s === 'bison') return 'bison';
    return s || 'beef';
  }

  function speciesToDb(raw) {
    const s = normalizeSpecies(raw);
    return s === 'beef' ? 'cattle' : s;
  }

  function resolveTown(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) {
      return { name: 'Unknown', miles: MILES_CAP, quadrant: 'south', hub: false, unknown: true };
    }
    const hit = TOWNS.find((t) => t.name.toLowerCase() === key);
    if (!hit) {
      return { name: String(name).trim(), miles: MILES_CAP, quadrant: 'south', hub: false, unknown: true };
    }
    return Object.assign({ unknown: false }, hit);
  }

  function quotedMiles(townOrMiles) {
    if (typeof townOrMiles === 'number') {
      return Math.min(MILES_CAP, Math.max(0, townOrMiles));
    }
    const town = typeof townOrMiles === 'object' && townOrMiles
      ? townOrMiles
      : resolveTown(townOrMiles);
    const miles = Number(town.miles);
    const n = Number.isFinite(miles) ? miles : MILES_CAP;
    return Math.min(MILES_CAP, Math.max(0, n));
  }

  function tripFeeDollars(townOrMiles) {
    const miles = quotedMiles(townOrMiles);
    if (miles <= 0) return 0;
    return Math.max(TRIP_FLOOR, roundMoney(miles * MILEAGE_RATE));
  }

  function tripRateLabel(townOrMiles) {
    const miles = quotedMiles(townOrMiles);
    if (miles <= 0) return '$0 trip';
    const raw = roundMoney(miles * MILEAGE_RATE);
    if (raw < TRIP_FLOOR) return '$' + TRIP_FLOOR + ' minimum';
    return '$' + MILEAGE_RATE.toFixed(2) + '/mi';
  }

  function killFeePerHead(species) {
    return KILL_PER_HEAD[normalizeSpecies(species)] || KILL_PER_HEAD.beef;
  }

  function killFeeDollars(species, heads) {
    const n = Math.max(1, Math.min(4, parseInt(heads, 10) || 1));
    return roundMoney(killFeePerHead(species) * n);
  }

  function harvestDue(species, townOrMiles, heads) {
    const kill = killFeeDollars(species, heads);
    const trip = tripFeeDollars(townOrMiles);
    return { kill: kill, trip: trip, total: roundMoney(kill + trip) };
  }

  function platformFeeOnGross(gross) {
    return roundMoney(Math.max(0, Number(gross) || 0) * PLATFORM_FEE_RATE);
  }

  function farmerKeep(gross) {
    const g = roundMoney(Math.max(0, Number(gross) || 0));
    return roundMoney(g - platformFeeOnGross(g));
  }

  function shareTotals(pricePerLb, hangingLb) {
    const whole = roundMoney((Number(pricePerLb) || 0) * (Number(hangingLb) || 0));
    return {
      whole: whole,
      half: roundMoney(whole * SHARE_FRACTIONS.half),
      side: roundMoney(whole * SHARE_FRACTIONS.side),
      quarter: roundMoney(whole * SHARE_FRACTIONS.quarter),
    };
  }

  function cutWrapHint(hangingLb) {
    return roundMoney((Number(hangingLb) || 0) * CUT_WRAP_PER_LB);
  }

  function isLockedDraft123(number) {
    const id = String(number || '').replace(/^#/, '').toLowerCase().trim();
    return id === '123' || /\bstitt/i.test(id);
  }

  function hangingDefaults(species, opts) {
    const sp = normalizeSpecies(species);
    const locked = !!(opts && (opts.lockedDraft123 || isLockedDraft123(opts.number)));
    return {
      hangingPerLb: locked ? LOCKED_DRAFT_HANGING_PER_LB : (DEFAULT_HANGING_PER_LB[sp] || DEFAULT_HANGING_PER_LB.beef),
      hangingLb: DEFAULT_HANGING_LB[sp] || DEFAULT_HANGING_LB.beef,
      locked: locked,
    };
  }

  function weekOfMonth(value) {
    const d = startOfDay(value);
    if (!d) return 1;
    return Math.ceil(d.getDate() / 7);
  }

  function compassQuadrantForDate(value) {
    const week = weekOfMonth(value);
    return COMPASS_WEEK[week] || 'east';
  }

  function isHarvestWeekday(value) {
    const d = startOfDay(value);
    if (!d) return false;
    return HARVEST_WEEKDAYS.indexOf(d.getDay()) !== -1;
  }

  function isHub(town) {
    const t = typeof town === 'object' && town ? town : resolveTown(town);
    return !!t.hub;
  }

  function isSelectableTrailerDay(date, town, opts) {
    const d = startOfDay(date);
    const t = typeof town === 'object' && town ? town : resolveTown(town);
    if (!d || !isHarvestWeekday(d)) return false;
    const now = startOfDay((opts && opts.now) || new Date());
    if (now && d.getTime() < now.getTime()) return false;
    if (isHub(t)) return true;
    return compassQuadrantForDate(d) === t.quadrant;
  }

  function trailerDayInfo(date, town, opts) {
    const d = startOfDay(date);
    const t = typeof town === 'object' && town ? town : resolveTown(town);
    const o = opts || {};
    const iso = isoDate(d);
    const cap = Number.isFinite(Number(o.capacity && o.capacity[iso]))
      ? Number(o.capacity[iso])
      : DAILY_HARVEST_CAPACITY;
    const booked = Number(o.booked && o.booked[iso]) || 0;
    const open = Math.max(0, cap - booked);
    const selectable = !!(d && isSelectableTrailerDay(d, t, o) && open > 0);
    const week = d ? weekOfMonth(d) : 0;
    const quadrant = d ? compassQuadrantForDate(d) : t.quadrant;
    return {
      iso: iso,
      date: d,
      selectable: selectable,
      open: open,
      capacity: cap,
      week: week,
      quadrant: quadrant,
      hub: isHub(t),
    };
  }

  function listSelectableTrailerDays(town, opts) {
    const o = opts || {};
    const limit = Math.max(1, parseInt(o.limit, 10) || 12);
    const horizon = Math.max(limit, parseInt(o.horizon, 10) || 90);
    const now = startOfDay(o.now || new Date());
    const out = [];
    for (let i = 0; i < horizon && out.length < limit; i++) {
      const d = addDays(now, i);
      const info = trailerDayInfo(d, town, o);
      if (info.selectable) out.push(info);
    }
    return out;
  }

  function nextHarvestWindow(town, opts) {
    const days = listSelectableTrailerDays(town, Object.assign({}, opts, { limit: 6, horizon: 120 }));
    if (!days.length) return null;
    const first = days[0];
    const sameWeek = days.filter((x) => {
      return x.date.getMonth() === first.date.getMonth()
        && x.date.getFullYear() === first.date.getFullYear()
        && weekOfMonth(x.date) === first.week;
    });
    return {
      headline: first.date,
      rangeStart: sameWeek[0].date,
      rangeEnd: sameWeek[sameWeek.length - 1].date,
      days: sameWeek,
      quadrant: first.quadrant,
    };
  }

  function calendarMonthDays(year, month, town, opts) {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    const days = [];
    for (let day = 1; day <= end.getDate(); day++) {
      days.push(trailerDayInfo(new Date(year, month, day), town, opts));
    }
    return { start: start, end: end, days: days };
  }

  function listingShareInventory(enabled) {
    const on = enabled && typeof enabled === 'object' ? enabled : { whole: true, half: true, quarter: true };
    return {
      whole: { available: on.whole ? 1 : 0, reserved: 0 },
      half: { available: on.half ? 2 : 0, reserved: 0 },
      quarter: { available: on.quarter ? 4 : 0, reserved: 0 },
    };
  }

  function townSelectLabel(town) {
    const t = typeof town === 'object' && town ? town : resolveTown(town);
    const quad = t.hub ? 'Hub' : (t.quadrant.charAt(0).toUpperCase() + t.quadrant.slice(1));
    return t.name + ' · ' + t.miles + ' mi · ' + quad;
  }

  return {
    PLATFORM_FEE_RATE: PLATFORM_FEE_RATE,
    MILEAGE_RATE: MILEAGE_RATE,
    TRIP_FLOOR: TRIP_FLOOR,
    MILES_CAP: MILES_CAP,
    CUT_WRAP_PER_LB: CUT_WRAP_PER_LB,
    DAILY_HARVEST_CAPACITY: DAILY_HARVEST_CAPACITY,
    LOCKED_DRAFT_HANGING_PER_LB: LOCKED_DRAFT_HANGING_PER_LB,
    SMOKEHOUSE: SMOKEHOUSE,
    SHARE_FRACTIONS: SHARE_FRACTIONS,
    SHARE_LABELS: SHARE_LABELS,
    KILL_PER_HEAD: KILL_PER_HEAD,
    DEFAULT_HANGING_LB: DEFAULT_HANGING_LB,
    DEFAULT_HANGING_PER_LB: DEFAULT_HANGING_PER_LB,
    COMPASS_WEEK: COMPASS_WEEK,
    TOWNS: TOWNS,
    roundMoney: roundMoney,
    startOfDay: startOfDay,
    isoDate: isoDate,
    addDays: addDays,
    formatShort: formatShort,
    normalizeSpecies: normalizeSpecies,
    speciesToDb: speciesToDb,
    resolveTown: resolveTown,
    quotedMiles: quotedMiles,
    tripFeeDollars: tripFeeDollars,
    tripRateLabel: tripRateLabel,
    killFeePerHead: killFeePerHead,
    killFeeDollars: killFeeDollars,
    harvestDue: harvestDue,
    platformFeeOnGross: platformFeeOnGross,
    farmerKeep: farmerKeep,
    shareTotals: shareTotals,
    cutWrapHint: cutWrapHint,
    isLockedDraft123: isLockedDraft123,
    hangingDefaults: hangingDefaults,
    weekOfMonth: weekOfMonth,
    compassQuadrantForDate: compassQuadrantForDate,
    isHarvestWeekday: isHarvestWeekday,
    isHub: isHub,
    isSelectableTrailerDay: isSelectableTrailerDay,
    trailerDayInfo: trailerDayInfo,
    listSelectableTrailerDays: listSelectableTrailerDays,
    nextHarvestWindow: nextHarvestWindow,
    calendarMonthDays: calendarMonthDays,
    listingShareInventory: listingShareInventory,
    townSelectLabel: townSelectLabel,
  };
});
