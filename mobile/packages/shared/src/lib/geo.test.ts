import { describe, it, expect } from 'vitest';
import { distance, sortByDistance, boundingBox, formatDistance } from './geo';

describe('distance', () => {
  it('returns 0 for the same point', () => {
    const p = { lat: 40, lng: -75 };
    expect(distance(p, p)).toBe(0);
  });

  it('matches a known reference (NY → LA ≈ 2451 mi)', () => {
    const ny = { lat: 40.7128, lng: -74.006 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const miles = distance(ny, la);
    expect(miles).toBeGreaterThan(2440);
    expect(miles).toBeLessThan(2460);
  });

  it('respects the km unit', () => {
    const ny = { lat: 40.7128, lng: -74.006 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const km = distance(ny, la, 'km');
    expect(km).toBeGreaterThan(3930);
    expect(km).toBeLessThan(3960);
  });

  it('is symmetric', () => {
    const a = { lat: 44.95, lng: -93.15 }; // St. Paul
    const b = { lat: 43.99, lng: -92.72 }; // Kasson
    expect(distance(a, b)).toBeCloseTo(distance(b, a), 5);
  });
});

describe('sortByDistance', () => {
  it('sorts items by proximity to a center', () => {
    const center = { lat: 44.95, lng: -93.15 }; // St. Paul, MN
    const items = [
      { id: 'far', lat: 34.05, lng: -118.24 }, // LA
      { id: 'near', lat: 43.99, lng: -92.72 }, // Kasson
      { id: 'mid', lat: 41.88, lng: -87.63 }, // Chicago
    ];
    const sorted = sortByDistance(items, center);
    expect(sorted.map(i => i.id)).toEqual(['near', 'mid', 'far']);
  });

  it('does not mutate the input array', () => {
    const items = [
      { id: 'a', lat: 0, lng: 0 },
      { id: 'b', lat: 1, lng: 1 },
    ];
    const original = [...items];
    sortByDistance(items, { lat: 0.5, lng: 0.5 });
    expect(items).toEqual(original);
  });
});

describe('boundingBox', () => {
  it('contains the center point', () => {
    const c = { lat: 40, lng: -75 };
    const box = boundingBox(c, 50);
    expect(c.lat).toBeGreaterThan(box.south);
    expect(c.lat).toBeLessThan(box.north);
    expect(c.lng).toBeGreaterThan(box.west);
    expect(c.lng).toBeLessThan(box.east);
  });

  it('grows with the radius', () => {
    const c = { lat: 40, lng: -75 };
    const small = boundingBox(c, 10);
    const big = boundingBox(c, 100);
    expect(big.north - big.south).toBeGreaterThan(small.north - small.south);
    expect(big.east - big.west).toBeGreaterThan(small.east - small.west);
  });
});

describe('formatDistance', () => {
  it('uses one decimal place under 10 miles', () => {
    expect(formatDistance(0.5)).toBe('0.5 mi');
    expect(formatDistance(3.4)).toBe('3.4 mi');
    expect(formatDistance(9.9)).toBe('9.9 mi');
  });

  it('rounds to integer at 10+ miles', () => {
    expect(formatDistance(10)).toBe('10 mi');
    expect(formatDistance(12.4)).toBe('12 mi');
    expect(formatDistance(12.6)).toBe('13 mi');
  });
});
