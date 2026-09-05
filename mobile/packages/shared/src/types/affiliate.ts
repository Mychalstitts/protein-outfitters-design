/**
 * Affiliate codes + attribution events.
 *
 * One affiliate_code per share link. Owners (farms or processors) hand them
 * out — each landing on /r/{code} creates an attribution_event. When the
 * visitor later submits a processor_request, the request-create flow stamps
 * `converted_request_id` on the most recent matching event.
 *
 * NULL `owner_processor_id` = a platform/admin code (e.g. a launch promo).
 */

/** Who pays for the discount/commission this code represents. */
export type AffiliatePaidBy = 'platform' | 'processor' | 'shared';

export interface AffiliateCode {
  id: string;
  /** URL-safe slug used in /r/{code} */
  code: string;
  /** NULL = platform/admin code; otherwise the farm or processor that owns this code */
  owner_processor_id: string | null;
  /** 0–50 — capped by the migration check constraint */
  default_percent: number;
  paid_by: AffiliatePaidBy;
  /** Whether the customer sees a discounted price in the request flow */
  customer_sees_discount: boolean;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttributionEvent {
  id: string;
  code_id: string;
  /** SHA-256 of the visitor's po_vid cookie — never the raw cookie */
  visitor_token: string;
  landed_at: string;
  landing_path: string;
  user_agent: string | null;
  ip_country: string | null;
  converted_request_id: string | null;
  converted_at: string | null;
}

/** Row shape returned by the `affiliate_stats_30d` view */
export interface AffiliateStats30d {
  code_id: string;
  code: string;
  owner_processor_id: string | null;
  default_percent: number;
  paid_by: AffiliatePaidBy;
  active: boolean;
  visitors: number;
  landings: number;
  conversions: number;
}
