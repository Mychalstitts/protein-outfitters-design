/**
 * Live activity events — what's happening across the network right now.
 *
 * Today: deterministically generated from the current minute + a salt so
 * the feed feels fresh on every load but stays stable enough not to flicker
 * between renders. Replace with a real `events` table + Supabase Realtime
 * subscription when you ship transactions.
 */

export type ActivityKind =
  | 'booking'
  | 'claim'
  | 'capacity-up'
  | 'capacity-down'
  | 'new-listing'
  | 'price-drop';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  /** Human-readable subject — e.g. "Cedar Ridge Cattle Co." */
  subject: string;
  /** Where the thing happened — e.g. "Des Moines, IA" */
  where: string;
  /** Coordinates of the subject — used for fly-to from the ticker */
  lat: number;
  lng: number;
  /** Tag-along detail to color the line — e.g. "12k lbs/wk" or "Just claimed" */
  detail: string;
  /** Minutes ago (1-720) */
  minutesAgo: number;
}

const SUBJECTS: Array<[string, string, number, number]> = [
  ['Cedar Ridge Cattle Co.', 'Des Moines, IA', 41.59, -93.62],
  ['Hollow Creek Pork', 'Iowa City, IA', 41.66, -91.53],
  ['Plainsong Beef Co-op', 'Lincoln, NE', 40.81, -96.68],
  ['Sandhills Bison', 'Scottsbluff, NE', 41.86, -103.66],
  ['Heartland Meat Co.', 'Omaha, NE', 41.25, -95.93],
  ['Wichita Beef Works', 'Wichita, KS', 37.69, -97.34],
  ['Dallas-Fort Worth Meats', 'Dallas, TX', 32.77, -96.80],
  ['Austin Custom Cuts', 'Austin, TX', 30.27, -97.74],
  ['Sonoma Heritage', 'Santa Rosa, CA', 38.44, -122.71],
  ['Big Sky Bison', 'Billings, MT', 45.79, -108.54],
  ['Blue Ridge Beef', 'Asheville, NC', 35.59, -82.55],
  ['Catskill Heritage Pork', 'Roxbury, NY', 42.03, -74.12],
  ['Vermont Grass Beef', 'Montpelier, VT', 44.26, -72.58],
  ['Madison Custom Processors', 'Madison, WI', 43.07, -89.38],
  ['Atlanta Southern Meats', 'Atlanta, GA', 33.75, -84.39],
  ['Carolina Heritage Plant', 'New Bern, NC', 35.10, -77.04],
  ['Twin Cities Meat Co.', 'Minneapolis, MN', 44.98, -93.27],
  ['Pennsylvania Dutch Beef', 'Lancaster, PA', 40.04, -76.31],
  ['Lake Erie Pork', 'Cleveland, OH', 41.50, -81.69],
  ['Bluegrass Beef Co.', 'Lexington, KY', 38.04, -84.50],
];

const KIND_TEMPLATES: Record<ActivityKind, (n: number) => string> = {
  booking: n => `Booked ${(n * 250).toLocaleString()} lbs`,
  claim: () => 'Just claimed',
  'capacity-up': n => `+${(n * 500).toLocaleString()} lbs available`,
  'capacity-down': n => `${(n * 380).toLocaleString()} lbs filled`,
  'new-listing': () => 'Joined the directory',
  'price-drop': n => `Lowered $${0.15 + n * 0.08}/lb`,
};

const KIND_VERB: Record<ActivityKind, string> = {
  booking: 'New booking',
  claim: 'Claimed listing',
  'capacity-up': 'Capacity opened',
  'capacity-down': 'Capacity filling',
  'new-listing': 'New supplier',
  'price-drop': 'Price drop',
};

const KINDS: ActivityKind[] = [
  'booking',
  'booking',
  'capacity-down',
  'claim',
  'capacity-up',
  'new-listing',
  'price-drop',
  'booking',
];

function pseudoRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Generate a plausible feed of `count` events based on a `seed` (typically
 * the current minute). Same seed always produces the same feed.
 */
export function generateActivityFeed(seed: number, count = 18): ActivityEvent[] {
  const rng = pseudoRng(seed);
  const out: ActivityEvent[] = [];
  for (let i = 0; i < count; i++) {
    const subj = SUBJECTS[Math.floor(rng() * SUBJECTS.length)] ?? SUBJECTS[0]!;
    const kind = KINDS[Math.floor(rng() * KINDS.length)] ?? 'booking';
    const minutesAgo = Math.floor(1 + rng() * 240);
    const detailNumber = 1 + Math.floor(rng() * 12);
    out.push({
      id: `${seed}-${i}`,
      kind,
      subject: subj[0],
      where: subj[1],
      lat: subj[2],
      lng: subj[3],
      detail: KIND_TEMPLATES[kind](detailNumber),
      minutesAgo,
    });
  }
  return out.sort((a, b) => a.minutesAgo - b.minutesAgo);
}

export function activityVerb(kind: ActivityKind): string {
  return KIND_VERB[kind];
}

/** Stable color hue per kind for the ticker dot */
export function activityHue(kind: ActivityKind): 'sup' | 'proc' | 'hw' | 'warn' {
  switch (kind) {
    case 'claim':
    case 'new-listing':
      return 'proc';
    case 'capacity-up':
    case 'price-drop':
      return 'sup';
    case 'booking':
      return 'sup';
    case 'capacity-down':
      return 'hw';
  }
}

/** "12 min ago" / "2 hr ago" / "Just now" */
export function relativeTime(minutesAgo: number): string {
  if (minutesAgo < 1) return 'Just now';
  if (minutesAgo < 60) return `${minutesAgo} min ago`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
