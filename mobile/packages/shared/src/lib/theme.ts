/**
 * Design tokens — single source of truth for colors, spacing, type.
 * Pulled directly from the existing protein_outfitters_map_system.html.
 *
 * Both mobile (StyleSheet.create) and web (CSS variables) consume these.
 */

export const colors = {
  // Backgrounds — dark mode only for now
  bg0: '#0f1115', // page
  bg1: '#141821', // sidebar
  bg2: '#1a1f2a', // cards, popups
  bg3: '#222936', // hover, active
  bg4: '#2a3140', // borders, button bg
  line: '#1f2530', // hairlines

  // Text
  text: '#e8ebf0',
  textDim: '#aab2c0',
  textMute: '#7d8896',
  textFaint: '#5a6271',

  // Roles — green for processor, blue for supplier (farm)
  proc: '#2c9a52',
  procDeep: '#1f7a3f',
  procLight: '#5fb377',
  sup: '#2c6fa5',
  supDeep: '#1d4f7d',
  supLight: '#6ea3d4',

  // Admin / hardware accent
  hw: '#c97a2c',
  hwDeep: '#9c5b1d',
  hwLight: '#e09a5a',

  // Heatmap gradient
  heat1: '#1d4f7d',
  heat2: '#2c9a52',
  heat3: '#d4a82a',
  heat4: '#c97a2c',
  heat5: '#a83838',

  warn: '#a83838',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 10,
  pill: 999,
} as const;

export const fontFamily = {
  // Inter on both platforms; falls back to system on RN if not loaded
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;
