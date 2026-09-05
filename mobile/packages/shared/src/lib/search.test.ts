import { describe, it, expect } from 'vitest';
import { filterProcessors } from './search';
import type { Processor } from '../types/processor';

const proc = (overrides: Partial<Processor> = {}): Processor => ({
  id: 'test-1',
  slug: 'test-1',
  name: 'Test Shop',
  role: 'processor',
  contact_name: null,
  phone: '555-1234',
  email: null,
  website: null,
  address: { street: null, city: 'Madison', state: 'WI', zip: null, full: null },
  lat: 43,
  lng: -89,
  geocode_source: 'manual',
  services: ['Retail'],
  inspection_status: null,
  usda_establishment_number: null,
  source: 'WAMP',
  source_url: null,
  claim_status: 'unclaimed',
  ...overrides,
});

describe('filterProcessors', () => {
  it('returns the input when no filters apply', () => {
    const list = [proc(), proc({ id: 'x', slug: 'x' })];
    expect(filterProcessors(list, {})).toHaveLength(2);
  });

  it('matches name case-insensitively', () => {
    const list = [proc({ name: 'Big Sky Beef' }), proc({ name: 'River Valley' })];
    expect(filterProcessors(list, { query: 'big sky' })).toHaveLength(1);
    expect(filterProcessors(list, { query: 'BIG SKY' })).toHaveLength(1);
    expect(filterProcessors(list, { query: 'River' })).toHaveLength(1);
  });

  it('matches city in the query', () => {
    const list = [
      proc({ address: { ...proc().address, city: 'Madison' } }),
      proc({ id: 'm', slug: 'm', address: { ...proc().address, city: 'Milwaukee' } }),
    ];
    expect(filterProcessors(list, { query: 'milwaukee' })).toHaveLength(1);
  });

  it('matches against services', () => {
    const list = [
      proc({ services: ['Retail'] }),
      proc({ id: 'g', slug: 'g', services: ['Game Processing'] }),
    ];
    expect(filterProcessors(list, { query: 'game' })).toHaveLength(1);
  });

  it('filters by state', () => {
    const list = [
      proc({ address: { ...proc().address, state: 'WI' } }),
      proc({ id: 'm', slug: 'm', address: { ...proc().address, state: 'MN' } }),
    ];
    expect(filterProcessors(list, { states: ['WI'] })).toHaveLength(1);
    expect(filterProcessors(list, { states: ['WI', 'MN'] })).toHaveLength(2);
  });

  it('filters by service', () => {
    const list = [
      proc({ services: ['Retail'] }),
      proc({ id: 'g', slug: 'g', services: ['Game Processing', 'Retail'] }),
    ];
    expect(filterProcessors(list, { services: ['Game Processing'] })).toHaveLength(1);
  });

  it('filters by claim status', () => {
    const list = [
      proc({ claim_status: 'unclaimed' }),
      proc({ id: 'c', slug: 'c', claim_status: 'claimed' }),
    ];
    expect(filterProcessors(list, { claimStatus: 'claimed' })).toHaveLength(1);
    expect(filterProcessors(list, { claimStatus: 'unclaimed' })).toHaveLength(1);
    expect(filterProcessors(list, { claimStatus: 'any' })).toHaveLength(2);
  });

  it('filters by hasPhone', () => {
    const list = [proc({ phone: '555' }), proc({ id: 'np', slug: 'np', phone: null })];
    expect(filterProcessors(list, { hasPhone: true })).toHaveLength(1);
  });

  it('combines filters with AND semantics', () => {
    const list = [
      proc({ name: 'Foo', address: { ...proc().address, state: 'WI' }, services: ['Retail'] }),
      proc({ id: 'b', slug: 'b', name: 'Bar', address: { ...proc().address, state: 'WI' }, services: ['Smoking'] }),
      proc({ id: 'c', slug: 'c', name: 'Foo', address: { ...proc().address, state: 'MN' }, services: ['Retail'] }),
    ];
    const out = filterProcessors(list, {
      query: 'foo',
      states: ['WI'],
      services: ['Retail'],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('test-1');
  });

  it('handles empty input', () => {
    expect(filterProcessors([], { query: 'anything' })).toEqual([]);
  });
});
