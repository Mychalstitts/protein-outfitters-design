/**
 * Attribution helpers used by the /r/{code} route handler and the
 * request-create Edge Function.
 *
 * Cookies set by /r/{code}:
 *   po_vid — 1-year stable opaque visitor ID (UUID). Read-only on the client.
 *   po_aff — 30-day code slug the visitor most recently landed through.
 *
 * `hashVisitorToken` produces what we store in attribution_events.visitor_token
 * so we never persist the raw cookie alongside the event row. The hash is
 * deterministic (no salt) so the request-create flow can look up the same
 * visitor and stamp `converted_request_id`.
 *
 * No third-party crypto dep — we use the standard Web Crypto API which is
 * present in modern Node (>=20), Deno, browsers, and Next.js edge runtime.
 */

export const COOKIE_VISITOR_ID = 'po_vid';
export const COOKIE_AFFILIATE = 'po_aff';
export const ATTRIBUTION_WINDOW_DAYS = 30;
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
export const AFFILIATE_COOKIE_MAX_AGE = 60 * 60 * 24 * ATTRIBUTION_WINDOW_DAYS;

/** Slug regex matching the migration's check constraint */
export const AFFILIATE_CODE_PATTERN = /^[a-z0-9_-]{3,32}$/;

export function isValidAffiliateCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && AFFILIATE_CODE_PATTERN.test(code);
}

/**
 * SHA-256 of the visitor cookie. Returns a 64-char hex string.
 * Deterministic — same input always produces same output.
 */
export async function hashVisitorToken(visitorId: string): Promise<string> {
  const data = new TextEncoder().encode(visitorId);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a share URL. Pass `to` to override the destination — otherwise the
 * /r/{code} handler defaults to the owner's profile page.
 */
export function buildShareUrl(
  origin: string,
  code: string,
  options?: { to?: string },
): string {
  const url = new URL(`/r/${code}`, origin);
  if (options?.to) url.searchParams.set('to', options.to);
  return url.toString();
}
