/**
 * Procedural cover art for listings without a real photo.
 *
 * Goal: every supplier and processor card looks designed, even before
 * anyone uploads a real image. Output is a self-contained SVG string —
 * deterministic by id, so the same listing always renders the same art.
 *
 * Composition language: warm Digital-Epicurean gradients, oversized
 * protein silhouette as a half-bleed mark, a serif monogram of the
 * subject's initials, subtle paper noise. Six layouts cycled by id hash.
 */

import { PROTEIN_ICON_PATHS, PROTEIN_ICON_VIEWBOX } from './protein-icons';
import type { ProteinType } from './discovery';
import type { Role } from '../types/processor';

export interface CoverArtInput {
  /** Stable id — drives variant + monogram + composition */
  id: string;
  /** Display name — first letter of each word becomes the monogram */
  name: string;
  /** 'supplier' | 'processor' — picks the green vs blue base palette when no protein type */
  role?: Role;
  /** Optional protein type — picks a warm food palette */
  proteinType?: ProteinType | null;
  /** Output dimensions — defaults to 16:9 banner */
  width?: number;
  height?: number;
}

interface Palette {
  bg: string;       // page warmth behind everything
  base: string;     // gradient stop A — soft warm tone
  deep: string;     // gradient stop B — deeper, contrasty
  accent: string;   // ornament + monogram color (light)
  ink: string;      // type color (mostly unused — silhouettes do the lifting)
}

// Editorial palettes — all warm, all in the Digital Epicurean family
const PALETTES_BY_PROTEIN: Record<ProteinType, Palette> = {
  // Burgundy + cream (steakhouse / butcher)
  beef: {
    bg: '#f3ecde',
    base: '#a83838',
    deep: '#5e1a1a',
    accent: '#f3e3c3',
    ink: '#1f1a14',
  },
  // Coral + cream (heritage farm pink)
  pork: {
    bg: '#f3ecde',
    base: '#c95f4f',
    deep: '#7d2d24',
    accent: '#f7e0d2',
    ink: '#1f1a14',
  },
  // Mustard + cream (sun-drenched poultry yard)
  poultry: {
    bg: '#f3ecde',
    base: '#c89432',
    deep: '#7e561a',
    accent: '#f5e6c0',
    ink: '#1f1a14',
  },
  // Sage + cream (pastoral lamb)
  lamb: {
    bg: '#f3ecde',
    base: '#7c8a5b',
    deep: '#3f4d2e',
    accent: '#e8e8d4',
    ink: '#1f1a14',
  },
  // Umber + cream (deep prairie bison)
  bison: {
    bg: '#f3ecde',
    base: '#8a4d24',
    deep: '#4a2710',
    accent: '#f0d8b8',
    ink: '#1f1a14',
  },
  // Slate + cream (mountain goat)
  goat: {
    bg: '#f3ecde',
    base: '#5b6b78',
    deep: '#2d3a45',
    accent: '#dfe4ea',
    ink: '#1f1a14',
  },
};

// Fallback palettes for items with no protein type — match brand role color
const PALETTE_SUPPLIER: Palette = {
  bg: '#f3ecde',
  base: '#2c6fa5',
  deep: '#143958',
  accent: '#dde8f3',
  ink: '#1f1a14',
};
const PALETTE_PROCESSOR: Palette = {
  bg: '#f3ecde',
  base: '#3f7a3a',
  deep: '#1d3c1c',
  accent: '#dce8d6',
  ink: '#1f1a14',
};

// ─────────────────────────────────────────────────────────────────────────
// Hashing — stable pseudo-random keyed by id so the same listing always
// renders the same composition.
// ─────────────────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function pickPalette(role: Role | undefined, proteinType: ProteinType | null | undefined): Palette {
  if (proteinType && PALETTES_BY_PROTEIN[proteinType]) {
    return PALETTES_BY_PROTEIN[proteinType];
  }
  return role === 'processor' ? PALETTE_PROCESSOR : PALETTE_SUPPLIER;
}

function monogram(name: string): string {
  const parts = name
    .replace(/[^A-Za-z\s'\-&]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────────────────────────────────
// Compositions — six layouts. Each takes the same context and returns a
// chunk of SVG to drop inside the root <svg>.
// ─────────────────────────────────────────────────────────────────────────

interface Ctx {
  w: number;
  h: number;
  p: Palette;
  silhouette: string | null;   // svg path d-attr or null
  mono: string;
  variant: number;
  uid: string;                 // unique per render — for filter ids
  rng: () => number;
}

function silhouetteSvg(d: string, opts: {
  x: number; y: number; size: number; opacity: number; color: string; rotate?: number;
}): string {
  const { x, y, size, opacity, color, rotate = 0 } = opts;
  // The path is in a 512×512 viewbox; scale to size.
  const scale = size / 512;
  const t = `translate(${x} ${y}) scale(${scale})${rotate ? ` rotate(${rotate} 256 256)` : ''}`;
  return `<g transform="${t}" fill="${color}" opacity="${opacity}"><path d="${d}"/></g>`;
}

// Variant 0: Half-bleed silhouette bottom-right + huge monogram top-left
function variantBleedRight(c: Ctx): string {
  const grad = `<linearGradient id="g${c.uid}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${c.p.base}"/>
    <stop offset="100%" stop-color="${c.p.deep}"/>
  </linearGradient>`;
  const sil = c.silhouette
    ? silhouetteSvg(c.silhouette, {
        x: c.w * 0.55, y: c.h * 0.05, size: c.h * 1.4, opacity: 0.18, color: c.p.accent,
      })
    : '';
  const monoSize = Math.round(c.h * 0.62);
  const monoX = c.w * 0.06;
  const monoY = c.h * 0.78;
  return `${grad}
    <rect width="${c.w}" height="${c.h}" fill="url(#g${c.uid})"/>
    ${sil}
    <text x="${monoX}" y="${monoY}" font-family="Fraunces, Georgia, serif" font-weight="500" font-size="${monoSize}" fill="${c.p.accent}" opacity="0.92" letter-spacing="-0.04em">${escapeXml(c.mono)}</text>
    <line x1="${c.w * 0.06}" y1="${c.h * 0.86}" x2="${c.w * 0.36}" y2="${c.h * 0.86}" stroke="${c.p.accent}" stroke-width="${Math.max(1, c.h * 0.008)}" opacity="0.75"/>`;
}

// Variant 1: Centered silhouette behind a tag-like rectangle holding the monogram
function variantBadge(c: Ctx): string {
  const grad = `<linearGradient id="g${c.uid}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${c.p.base}"/>
    <stop offset="100%" stop-color="${c.p.deep}"/>
  </linearGradient>`;
  const sil = c.silhouette
    ? silhouetteSvg(c.silhouette, {
        x: c.w * 0.18, y: c.h * 0.03, size: c.h * 1.05, opacity: 0.22, color: c.p.accent, rotate: -3,
      })
    : '';
  const tagW = c.w * 0.34;
  const tagH = c.h * 0.36;
  const tagX = (c.w - tagW) / 2;
  const tagY = (c.h - tagH) / 2;
  return `${grad}
    <rect width="${c.w}" height="${c.h}" fill="url(#g${c.uid})"/>
    ${sil}
    <rect x="${tagX}" y="${tagY}" width="${tagW}" height="${tagH}" rx="6" fill="${c.p.accent}" opacity="0.96"/>
    <rect x="${tagX + 4}" y="${tagY + 4}" width="${tagW - 8}" height="${tagH - 8}" rx="3" fill="none" stroke="${c.p.deep}" stroke-width="1" opacity="0.4"/>
    <text x="${c.w / 2}" y="${tagY + tagH * 0.66}" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="500" font-size="${Math.round(tagH * 0.55)}" fill="${c.p.deep}" letter-spacing="-0.04em">${escapeXml(c.mono)}</text>`;
}

// Variant 2: Diagonal two-tone split, silhouette in the lighter half
function variantDiagonal(c: Ctx): string {
  const sil = c.silhouette
    ? silhouetteSvg(c.silhouette, {
        x: -c.w * 0.05, y: -c.h * 0.05, size: c.h * 1.15, opacity: 0.92, color: c.p.accent,
      })
    : '';
  return `<rect width="${c.w}" height="${c.h}" fill="${c.p.base}"/>
    <polygon points="0,0 ${c.w * 0.55},0 ${c.w * 0.35},${c.h} 0,${c.h}" fill="${c.p.deep}"/>
    ${sil}
    <text x="${c.w * 0.95}" y="${c.h * 0.85}" text-anchor="end" font-family="Fraunces, Georgia, serif" font-weight="500" font-size="${Math.round(c.h * 0.32)}" fill="${c.p.accent}" letter-spacing="-0.04em">${escapeXml(c.mono)}</text>
    <text x="${c.w * 0.95}" y="${c.h * 0.95}" text-anchor="end" font-family="Inter, sans-serif" font-weight="600" font-size="${Math.round(c.h * 0.085)}" fill="${c.p.accent}" opacity="0.7" letter-spacing="0.18em">EST.</text>`;
}

// Variant 3: Repeating silhouette pattern (wallpaper) over a deep solid
function variantPattern(c: Ctx): string {
  if (!c.silhouette) return variantBadge(c);
  const tile = c.h * 0.45;
  const cols = Math.ceil(c.w / tile) + 1;
  const rows = Math.ceil(c.h / tile) + 1;
  let pattern = '';
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const offset = r % 2 === 0 ? 0 : tile / 2;
      const x = col * tile - tile / 2 + offset;
      const y = r * tile - tile / 2;
      pattern += silhouetteSvg(c.silhouette, {
        x, y, size: tile, opacity: 0.10, color: c.p.accent,
      });
    }
  }
  return `<rect width="${c.w}" height="${c.h}" fill="${c.p.deep}"/>
    ${pattern}
    <rect width="${c.w}" height="${c.h}" fill="${c.p.base}" opacity="0.55"/>
    <text x="${c.w / 2}" y="${c.h * 0.62}" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-style="italic" font-weight="500" font-size="${Math.round(c.h * 0.42)}" fill="${c.p.accent}" letter-spacing="-0.04em">${escapeXml(c.mono)}</text>`;
}

// Variant 4: "Chapter card" — tiny silhouette + decorative chapter number
function variantChapter(c: Ctx): string {
  const grad = `<linearGradient id="g${c.uid}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c.p.base}"/>
    <stop offset="100%" stop-color="${c.p.deep}"/>
  </linearGradient>`;
  const num = String((hashStr(c.uid) % 99) + 1).padStart(2, '0');
  const sil = c.silhouette
    ? silhouetteSvg(c.silhouette, {
        x: c.w * 0.1, y: c.h * 0.18, size: c.h * 0.65, opacity: 0.85, color: c.p.accent,
      })
    : '';
  return `${grad}
    <rect width="${c.w}" height="${c.h}" fill="url(#g${c.uid})"/>
    ${sil}
    <text x="${c.w * 0.96}" y="${c.h * 0.78}" text-anchor="end" font-family="Fraunces, Georgia, serif" font-weight="300" font-style="italic" font-size="${Math.round(c.h * 0.78)}" fill="${c.p.accent}" opacity="0.88" letter-spacing="-0.05em">${num}</text>
    <line x1="${c.w * 0.45}" y1="${c.h * 0.5}" x2="${c.w * 0.62}" y2="${c.h * 0.5}" stroke="${c.p.accent}" stroke-width="${Math.max(1, c.h * 0.01)}" opacity="0.6"/>
    <text x="${c.w * 0.45}" y="${c.h * 0.42}" font-family="Inter, sans-serif" font-weight="600" font-size="${Math.round(c.h * 0.07)}" fill="${c.p.accent}" opacity="0.85" letter-spacing="0.18em">${escapeXml(c.mono)}</text>`;
}

// Variant 5: Off-canvas silhouette top-left + subtle watermark text
function variantTopLeft(c: Ctx): string {
  const grad = `<radialGradient id="g${c.uid}" cx="20%" cy="20%" r="100%">
    <stop offset="0%" stop-color="${c.p.base}"/>
    <stop offset="100%" stop-color="${c.p.deep}"/>
  </radialGradient>`;
  const sil = c.silhouette
    ? silhouetteSvg(c.silhouette, {
        x: -c.w * 0.18, y: -c.h * 0.15, size: c.h * 1.3, opacity: 0.20, color: c.p.accent, rotate: 12,
      })
    : '';
  return `${grad}
    <rect width="${c.w}" height="${c.h}" fill="url(#g${c.uid})"/>
    ${sil}
    <text x="${c.w * 0.94}" y="${c.h * 0.92}" text-anchor="end" font-family="Fraunces, Georgia, serif" font-weight="500" font-size="${Math.round(c.h * 0.55)}" fill="${c.p.accent}" letter-spacing="-0.04em">${escapeXml(c.mono)}</text>`;
}

const VARIANTS = [
  variantBleedRight,
  variantBadge,
  variantDiagonal,
  variantPattern,
  variantChapter,
  variantTopLeft,
];

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns a complete <svg>...</svg> string. Drop straight into innerHTML
 * or dangerouslySetInnerHTML, or wrap in a <Cover> component.
 */
export function generateCoverArt(input: CoverArtInput): string {
  const w = input.width ?? 800;
  const h = input.height ?? 450;
  const p = pickPalette(input.role, input.proteinType ?? null);
  const seed = hashStr(input.id);
  const variant = seed % VARIANTS.length;
  const silhouette = input.proteinType
    ? PROTEIN_ICON_PATHS[input.proteinType]
    : null;
  const ctx: Ctx = {
    w, h, p, silhouette,
    mono: monogram(input.name),
    variant,
    uid: `c${seed.toString(36)}`,
    rng: rng(seed),
  };
  const composition = VARIANTS[variant]!(ctx);

  // Paper noise — always on, very subtle. Uses feTurbulence to feel like
  // a printed press card.
  const noise = `<filter id="n${ctx.uid}">
    <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed="${seed % 1000}"/>
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.18 0"/>
    <feComposite in2="SourceGraphic" operator="in"/>
  </filter>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" role="img" aria-label="${escapeXml(input.name)} cover art">
    <defs>
      ${noise}
    </defs>
    ${composition}
    <rect width="${w}" height="${h}" filter="url(#n${ctx.uid})" opacity="0.5"/>
    <!-- Tiny inner border so the banner reads as a designed object, not a CSS bg -->
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>
  </svg>`;
}

/**
 * Inline data-URL form — use as background-image: url('...') in CSS without
 * any extra components. base64-safe via encodeURIComponent.
 */
export function coverArtDataUrl(input: CoverArtInput): string {
  const svg = generateCoverArt(input);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Returns the resolved palette for an item — useful for matching ambient hues elsewhere */
export function coverArtPalette(input: Pick<CoverArtInput, 'role' | 'proteinType'>): Palette {
  return pickPalette(input.role, input.proteinType ?? null);
}
