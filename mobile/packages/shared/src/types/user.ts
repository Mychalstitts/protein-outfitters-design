/**
 * App user profile — separate from Supabase's auth.users so we control
 * which fields are public, which require auth, and which are admin-only.
 *
 * Lives in `public.profiles`, joined to auth.users by id.
 */

export type UserRole = 'consumer' | 'processor_owner' | 'admin';

export interface Profile {
  /** Same UUID as auth.users.id */
  id: string;
  display_name: string | null;
  /** Optional, used to default-center the map */
  home_zip: string | null;
  role: UserRole;
  created_at: string;
}

/**
 * A claim is a processor owner asserting they own/manage a processor.
 * Admin reviews and either approves or denies.
 */
export type ClaimReviewStatus = 'pending' | 'approved' | 'denied';

export interface ProcessorClaim {
  id: string;
  processor_id: string;
  claimant_user_id: string;
  /** What they sent us to prove ownership — license, business doc, etc. */
  evidence_url: string | null;
  evidence_notes: string | null;
  review_status: ClaimReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
