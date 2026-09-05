/**
 * Geo utilities — pure functions, no platform deps. Used by both apps.
 *
 * For real production geo queries we use PostGIS server-side via
 * processors_within(); these client-side helpers are for sorting a
 * page of results, not for filtering a 500k-row table.
 */

const EARTH_RADIUS_MILES = 3958.8;
const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Haversine distance between two points */
export function distance(
  a: LatLng,
  b: LatLng,
  unit: 'mi' | 'km' = 'mi',
): number {
  const radius = unit === 'mi' ? EARTH_RADIUS_MILES : EARTH_RADIUS_KM;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function sortByDistance<T extends LatLng>(items: T[], from: LatLng): T[] {
  return [...items].sort((a, b) => distance(from, a) - distance(from, b));
}

/** Bounding box around a center point — used for prefiltering before haversine */
export function boundingBox(
  center: LatLng,
  radiusMiles: number,
): { north: number; south: number; east: number; west: number } {
  const latDelta = radiusMiles / 69; // ~69 miles per degree latitude
  const lngDelta =
    radiusMiles / (69 * Math.cos((center.lat * Math.PI) / 180));
  return {
    north: center.lat + latDelta,
    south: center.lat - latDelta,
    east: center.lng + lngDelta,
    west: center.lng - lngDelta,
  };
}

/** Format a distance for display: "12 mi" or "3.4 mi" depending on size */
export function formatDistance(miles: number): string {
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
