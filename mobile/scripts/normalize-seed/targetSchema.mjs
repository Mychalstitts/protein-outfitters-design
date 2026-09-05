// Lightweight runtime validation of an LLM-normalized processor row.
// Mirrors the shape of the `Processor` interface in
// app/packages/shared/src/types/processor.ts.
//
// We don't depend on zod here on purpose — this is a one-file script that
// should run with just Node + nothing installed. Plain validators keep it
// portable.

const VALID_ROLE = new Set(['processor', 'supplier']);
const VALID_GEOCODE = new Set([
  'street',
  'zip-centroid',
  'census-approx',
  'manual',
  'unknown',
]);

function isString(v) {
  return typeof v === 'string';
}
function isNullableString(v) {
  return v === null || typeof v === 'string';
}
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Returns { ok: true, value } or { ok: false, reason }.
 * Mutates a few fields in place (trim strings, fill defaults) where safe.
 */
export function validateRow(row) {
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'not an object' };
  }

  // Required strings
  for (const key of ['id', 'slug', 'name', 'role', 'source']) {
    if (!isString(row[key]) || row[key].trim() === '') {
      return { ok: false, reason: `missing required string '${key}'` };
    }
    row[key] = row[key].trim();
  }

  if (!VALID_ROLE.has(row.role)) {
    return { ok: false, reason: `role must be processor|supplier, got '${row.role}'` };
  }

  // Lat / lng required and within US-ish bounds. Anything outside the
  // continental US + Alaska + Hawaii is almost certainly bad.
  if (!isFiniteNumber(row.lat) || !isFiniteNumber(row.lng)) {
    return { ok: false, reason: 'lat/lng missing or not numbers' };
  }
  if (row.lat < 17 || row.lat > 72) {
    return { ok: false, reason: `lat ${row.lat} out of US bounds` };
  }
  if (row.lng < -180 || row.lng > -60) {
    return { ok: false, reason: `lng ${row.lng} out of US bounds` };
  }

  // Geocode source — default unknown
  if (row.geocode_source == null) row.geocode_source = 'unknown';
  if (!VALID_GEOCODE.has(row.geocode_source)) {
    return { ok: false, reason: `geocode_source '${row.geocode_source}' invalid` };
  }

  // Address — nested object with all-nullable strings
  if (!row.address || typeof row.address !== 'object') {
    row.address = { street: null, city: null, state: null, zip: null, full: null };
  }
  for (const key of ['street', 'city', 'state', 'zip', 'full']) {
    if (row.address[key] === undefined) row.address[key] = null;
    if (!isNullableString(row.address[key])) {
      return { ok: false, reason: `address.${key} must be string or null` };
    }
    if (typeof row.address[key] === 'string') {
      row.address[key] = row.address[key].trim() || null;
    }
  }
  // State must be 2 letters if present
  if (row.address.state && !/^[A-Z]{2}$/.test(row.address.state)) {
    return {
      ok: false,
      reason: `address.state '${row.address.state}' must be a 2-letter code`,
    };
  }

  // Services — always an array of strings
  if (!Array.isArray(row.services)) row.services = [];
  row.services = row.services
    .filter((s) => isString(s) && s.trim() !== '')
    .map((s) => s.trim());

  // Nullable optional strings
  for (const key of [
    'contact_name',
    'phone',
    'email',
    'website',
    'inspection_status',
    'usda_establishment_number',
    'source_url',
  ]) {
    if (row[key] === undefined) row[key] = null;
    if (!isNullableString(row[key])) {
      return { ok: false, reason: `${key} must be string or null` };
    }
    if (typeof row[key] === 'string') row[key] = row[key].trim() || null;
  }

  // claim_status — must be one of the three values
  if (!row.claim_status) row.claim_status = 'unclaimed';
  if (!['unclaimed', 'pending', 'claimed'].includes(row.claim_status)) {
    return { ok: false, reason: `claim_status invalid: ${row.claim_status}` };
  }

  return { ok: true, value: row };
}
