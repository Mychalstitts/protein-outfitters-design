/**
 * Processor calendar blocks — the external-animal calendar.
 *
 * A block is any chunk of time on a processor's schedule:
 *   * 'platform' — booked through Protein Outfitters (has a request_id)
 *   * 'external' — booked off-platform (walk-in book) — calendar-only, no cutsheet
 *   * 'closed'   — vacation / maintenance / out of office
 *
 * Anyone can READ blocks (so customers see availability). Only the claimed
 * processor can write their own.
 */

export type BlockKind = 'platform' | 'external' | 'closed';

import type { AnimalType } from './request';

export interface ProcessorBlock {
  id: string;
  processor_id: string;
  starts_at: string;
  ends_at: string;
  kind: BlockKind;
  animal_type: AnimalType | null;
  notes: string | null;
  request_id: string | null;
  created_at: string;
  updated_at: string;
}
