/**
 * Client-side search and filter helpers. For tiny result sets (< 1000 rows
 * already returned). Real fuzzy search uses Postgres full-text on the server.
 */

import type { Processor, Service, ClaimStatus } from '../types/processor';

export interface ProcessorFilters {
  /** Free-text search against name, city, services */
  query?: string;
  /** Two-letter state codes — empty array means all states */
  states?: string[];
  services?: Service[];
  claimStatus?: ClaimStatus | 'any';
  /** Only show processors with a phone number set */
  hasPhone?: boolean;
}

export function filterProcessors(
  processors: Processor[],
  filters: ProcessorFilters,
): Processor[] {
  const q = filters.query?.toLowerCase().trim();
  const states = filters.states?.length ? new Set(filters.states) : null;
  const services = filters.services?.length
    ? new Set(filters.services.map(s => s.toLowerCase()))
    : null;

  return processors.filter(p => {
    if (q) {
      const haystack = [
        p.name,
        p.address.city ?? '',
        p.address.state ?? '',
        ...p.services,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (states && p.address.state && !states.has(p.address.state)) return false;
    if (services) {
      const has = p.services.some(s => services.has(s.toLowerCase()));
      if (!has) return false;
    }
    if (filters.claimStatus && filters.claimStatus !== 'any') {
      if (p.claim_status !== filters.claimStatus) return false;
    }
    if (filters.hasPhone && !p.phone) return false;
    return true;
  });
}
