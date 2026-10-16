/**
 * "Blocks" Flat Color System, Curated Chapter Palettes, Category Colors,
 * and WCAG 2.1 Contrast Verification Utilities.
 *
 * Strictly flat saturated color fields — zero gradients, zero glow, zero grain.
 */

import type { Category } from '../../contracts/data.js';
import type { PaletteTheme } from '../../contracts/story.js';

export type RGBTuple = [number, number, number];

export const CORE_COLORS = {
  ink: '#111111',
  bone: '#F3F0E6',
  paper: '#E6E4DE',
  ghostOnInk: '#1C1C1B',
  ghostOnBone: '#DCD8CA',
  emptyCell: '#232322',
  dimCell: '#1B1B1A',
  quietCell: '#2C2C2A',
  ruleDark: '#3A3A38',
  ruleLight: '#C9C5BA',
  mutedTextOnInk: '#B8B4A9',
  mutedTextOnBone: '#4A4842',
  solar: '#F4F03A',
  rose: '#FFA8E4',
  olive: '#B9B744',
  ember: '#FF5A14',
  ochre: '#E3A83C',
  coral: '#FF6B57',
  lavender: '#A9A2E0',
  mint: '#B9F0C6',
  cobalt: '#6E8BFF',
  lime: '#D7F246',
  cyan: '#6BE8F2',
  peach: '#FFB58A',
} as const;

/**
 * Parse a 6-digit or 3-digit hex color string into an [R, G, B] tuple (0..255).
 */
export function hexToRgb(hex: string): RGBTuple {
  const clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    return [r, g, b];
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Convert an [R, G, B] tuple (0..255) to a #RRGGBB hex string.
 */
export function rgbToHex(rgb: Readonly<RGBTuple>): string {
  const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    clampByte(rgb[0]).toString(16).padStart(2, '0').toUpperCase() +
    clampByte(rgb[1]).toString(16).padStart(2, '0').toUpperCase() +
    clampByte(rgb[2]).toString(16).padStart(2, '0').toUpperCase()
  );
}

/**
 * Linearly interpolate between two RGB tuples.
 */
export function mixRgb(a: Readonly<RGBTuple>, b: Readonly<RGBTuple>, t: number): RGBTuple {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ];
}

/**
 * Compute WCAG 2.1 relative luminance (0.0 for pure black, 1.0 for pure white).
 */
export function getRelativeLuminance(hexOrRgb: string | Readonly<RGBTuple>): number {
  const [r, g, b] = typeof hexOrRgb === 'string' ? hexToRgb(hexOrRgb) : hexOrRgb;
  const toLinear = (channel: number): number => {
    const sRGB = channel / 255;
    return sRGB <= 0.04045 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Compute WCAG 2.1 contrast ratio between two colors (range 1.0 .. 21.0).
 */
export function getContrastRatio(
  fg: string | Readonly<RGBTuple>,
  bg: string | Readonly<RGBTuple>
): number {
  const l1 = getRelativeLuminance(fg);
  const l2 = getRelativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Verify whether a foreground/background pair meets WCAG AA contrast (default >= 4.5).
 */
export function meetsContrastAA(
  fg: string | Readonly<RGBTuple>,
  bg: string | Readonly<RGBTuple>,
  minRatio = 4.5
): boolean {
  return getContrastRatio(fg, bg) >= minRatio;
}

/**
 * Category metadata and high-contrast flat colors for all 17 canonical categories.
 * Every category color is chosen so that `getContrastRatio(color, '#111111') >= 4.5`.
 */
export interface CategoryMeta {
  id: Category;
  label: string;
  shortLabel: string;
  color: string;
  rgb: RGBTuple;
  textColor: string;
}

export const CATEGORY_COLORS: Record<Category, string> = {
  groceries: '#B9B744', // Olive
  'eating out': '#FF6B57', // Vermilion Coral
  takeaway: '#FF884D', // Tangerine
  coffee: '#E3A83C', // Warm Ochre
  transport: '#A9A2E0', // Lavender
  travel: '#6E8BFF', // Electric Cobalt
  shopping: '#FFA8E4', // Rose Pink
  fun: '#F4F03A', // Solar Yellow
  subscriptions: '#6BE8F2', // Cyan Ice
  bills: '#B9F0C6', // Mint
  rent: '#D7F246', // Acid Lime
  health: '#98E690', // Sage Green
  gifts: '#FFB58A', // Warm Peach
  fees: '#D4CFC2', // Stone Bone
  savings: '#8FD6FF', // Sky Blue
  transfers: '#A8A49B', // Neutral Warm Grey
  income: '#FF5A14', // Payday Ember Orange
};

export const CATEGORY_LABELS: Record<Category, string> = {
  groceries: 'Groceries',
  'eating out': 'Eating out',
  takeaway: 'Takeaway',
  coffee: 'Coffee',
  transport: 'Transport',
  travel: 'Travel',
  shopping: 'Shopping',
  fun: 'Fun',
  subscriptions: 'Subscriptions',
  bills: 'Bills',
  rent: 'Rent',
  health: 'Health',
  gifts: 'Gifts',
  fees: 'Fees',
  savings: 'Savings',
  transfers: 'Transfers',
  income: 'Income',
};

export const CATEGORY_META: Record<Category, CategoryMeta> = Object.fromEntries(
  (Object.keys(CATEGORY_COLORS) as Category[]).map((cat) => {
    const color = CATEGORY_COLORS[cat];
    return [
      cat,
      {
        id: cat,
        label: CATEGORY_LABELS[cat],
        shortLabel: CATEGORY_LABELS[cat].toUpperCase(),
        color,
        rgb: hexToRgb(color),
        textColor: CORE_COLORS.ink,
      },
    ];
  })
) as Record<Category, CategoryMeta>;

/**
 * 5-step intensity ramp for the 53×7 contribution grid (quiet -> loud),
 * matching the Blocks v2 visual direction.
 */
export const GRID_INTENSITY_STEPS_RGB: readonly RGBTuple[] = [
  hexToRgb('#2C2C2A'), // Step 0: Quiet / near-zero
  mixRgb(hexToRgb('#262626'), hexToRgb(CORE_COLORS.solar), 0.3), // Step 1: Low
  mixRgb(hexToRgb('#262626'), hexToRgb(CORE_COLORS.solar), 0.62), // Step 2: Medium
  hexToRgb(CORE_COLORS.solar), // Step 3: High (Solar Yellow)
  hexToRgb(CORE_COLORS.bone), // Step 4: Loudest (Warm Bone)
];

export const GRID_INTENSITY_STEPS_HEX: readonly string[] = GRID_INTENSITY_STEPS_RGB.map(rgbToHex);

/**
 * Compute the 0..4 intensity bucket for a day's spend relative to the p97 threshold.
 */
export function getIntensityBucket(spendMinor: number, p97Minor: number): 0 | 1 | 2 | 3 | 4 {
  if (spendMinor <= 0 || p97Minor <= 0) return 0;
  const v = Math.min(1, Math.sqrt(spendMinor / p97Minor));
  if (v < 0.14) return 0;
  if (v < 0.36) return 1;
  if (v < 0.6) return 2;
  if (v < 0.82) return 3;
  return 4;
}

/**
 * 9 Curated Flat "Blocks" Palettes for Chapters.
 * Every foreground/background pair is verified to have WCAG contrast >= 4.5.
 */
export const PALETTES: Record<string, PaletteTheme> = {
  ink_solar: {
    id: 'ink_solar',
    name: 'Ink & Solar Yellow',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#F4F03A',
    secondary: '#FF5A14',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#F4F03A', fg: '#111111' },
      secondary: { bg: '#FFA8E4', fg: '#111111' },
      tertiary: { bg: '#FF5A14', fg: '#111111' },
      quaternary: { bg: '#A9A2E0', fg: '#111111' },
    },
  },
  solar_ember: {
    id: 'solar_ember',
    name: 'Solar & Ember Poster',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#F4F03A',
    secondary: '#FF5A14',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#F4F03A', fg: '#111111' },
      secondary: { bg: '#FF5A14', fg: '#111111' },
      tertiary: { bg: '#FFA8E4', fg: '#111111' },
      quaternary: { bg: '#A9A2E0', fg: '#111111' },
    },
  },
  ink_rose: {
    id: 'ink_rose',
    name: 'Ink & Rose Matrix',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#FFA8E4',
    secondary: '#F4F03A',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#FFA8E4', fg: '#111111' },
      secondary: { bg: '#F4F03A', fg: '#111111' },
      tertiary: { bg: '#B9F0C6', fg: '#111111' },
      quaternary: { bg: '#6E8BFF', fg: '#111111' },
    },
  },
  paper_studio: {
    id: 'paper_studio',
    name: 'Warm Bone & Studio Ink',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#FF5A14',
    secondary: '#B9B744',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#F3F0E6', fg: '#111111' },
      secondary: { bg: '#FF5A14', fg: '#111111' },
      tertiary: { bg: '#B9B744', fg: '#111111' },
      quaternary: { bg: '#F4F03A', fg: '#111111' },
    },
  },
  olive_lime: {
    id: 'olive_lime',
    name: 'Olive & Acid Lime',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#D7F246',
    secondary: '#B9B744',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#D7F246', fg: '#111111' },
      secondary: { bg: '#B9B744', fg: '#111111' },
      tertiary: { bg: '#E3A83C', fg: '#111111' },
      quaternary: { bg: '#B9F0C6', fg: '#111111' },
    },
  },
  lavender_night: {
    id: 'lavender_night',
    name: 'Lavender & Coral Night',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#A9A2E0',
    secondary: '#FFA8E4',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#A9A2E0', fg: '#111111' },
      secondary: { bg: '#FFA8E4', fg: '#111111' },
      tertiary: { bg: '#F4F03A', fg: '#111111' },
      quaternary: { bg: '#FF6B57', fg: '#111111' },
    },
  },
  cobalt_bone: {
    id: 'cobalt_bone',
    name: 'Electric Cobalt & Bone',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#6E8BFF',
    secondary: '#F4F03A',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#6E8BFF', fg: '#111111' },
      secondary: { bg: '#F3F0E6', fg: '#111111' },
      tertiary: { bg: '#F4F03A', fg: '#111111' },
      quaternary: { bg: '#B9F0C6', fg: '#111111' },
    },
  },
  crimson_ink: {
    id: 'crimson_ink',
    name: 'Vermilion Coral & Ochre',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#FF6B57',
    secondary: '#E3A83C',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#FF6B57', fg: '#111111' },
      secondary: { bg: '#E3A83C', fg: '#111111' },
      tertiary: { bg: '#F4F03A', fg: '#111111' },
      quaternary: { bg: '#F3F0E6', fg: '#111111' },
    },
  },
  mint_obsidian: {
    id: 'mint_obsidian',
    name: 'Mint & Obsidian',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#B9F0C6',
    secondary: '#F4F03A',
    muted: '#B8B4A9',
    blocks: {
      primary: { bg: '#B9F0C6', fg: '#111111' },
      secondary: { bg: '#F4F03A', fg: '#111111' },
      tertiary: { bg: '#A9A2E0', fg: '#111111' },
      quaternary: { bg: '#FF5A14', fg: '#111111' },
    },
  },
};

export const PALETTE_LIST: readonly PaletteTheme[] = Object.values(PALETTES);

/**
 * Retrieve a PaletteTheme by ID, falling back to `ink_solar` if unknown.
 */
export function getPaletteById(paletteId?: string): PaletteTheme {
  if (paletteId && PALETTES[paletteId]) {
    return PALETTES[paletteId]!;
  }
  return PALETTES.ink_solar!;
}
