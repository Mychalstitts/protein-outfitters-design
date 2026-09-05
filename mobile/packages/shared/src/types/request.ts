/**
 * A consumer's service request to a processor.
 *
 * Core flow:
 *   1. User submits — status: 'pending'
 *   2. Email goes out to the processor (claimed or not)
 *   3. Processor responds → 'accepted' / 'declined' / 'needs_info'
 *   4. Closed when complete or cancelled
 */

export type RequestStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'needs_info'
  | 'completed'
  | 'cancelled';

export type AnimalType =
  | 'beef'
  | 'pork'
  | 'lamb'
  | 'goat'
  | 'poultry'
  | 'venison'
  | 'elk'
  | 'wild_game'
  | 'other';

export type ServiceRequested =
  | 'whole_animal_processing'
  | 'half_animal_processing'
  | 'quarter_animal_processing'
  | 'custom_cuts'
  | 'smoking'
  | 'sausage_making'
  | 'curing'
  | 'game_processing'
  | 'retail_purchase'
  | 'consultation';

export interface ProcessorRequest {
  id: string;
  processor_id: string;
  /** Authenticated user who submitted, or null if anonymous */
  user_id: string | null;
  /** Required even for authed users so we have a single source of truth */
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  contact_zip: string | null;

  animal_type: AnimalType;
  service_requested: ServiceRequested;
  /** When the consumer ideally wants the work done */
  preferred_date: string | null;
  notes: string | null;

  status: RequestStatus;
  created_at: string;
  updated_at: string;
}
