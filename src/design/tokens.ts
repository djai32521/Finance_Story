/**
 * Design Tokens: Typography, Spacing, Viewports, 2025 Calendar Constants,
 * and 53×7 Contribution Grid Geometry (`src/design/tokens.ts`).
 */

export const FONT_FAMILIES = {
  display: "'Inter Tight', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const TYPE_SCALE = {
  desktop: {
    watermark: { sizePx: 920, weight: 300, tracking: '-0.05em', lineHeight: 0.85 },
    megaDisplay: { sizePx: 640, weight: 300, tracking: '-0.07em', lineHeight: 0.88 },
    title2025: { sizePx: 560, weight: 400, tracking: '-0.045em', lineHeight: 1.0 },
    heroMerchant: { sizePx: 300, weight: 300, tracking: '-0.06em', lineHeight: 0.88 },
    askAnswer: { sizePx: 280, weight: 300, tracking: '-0.045em', lineHeight: 1.0 },
    sweepTotal: { sizePx: 220, weight: 300, tracking: '-0.045em', lineHeight: 1.0 },
    personalityTitle: { sizePx: 166, weight: 300, tracking: '-0.055em', lineHeight: 0.92 },
    primaryMetric: { sizePx: 150, weight: 300, tracking: '-0.045em', lineHeight: 1.0 },
    secondaryMetric: { sizePx: 112, weight: 300, tracking: '-0.045em', lineHeight: 1.0 },
    chapterHeadline: { sizePx: 92, weight: 300, tracking: '-0.04em', lineHeight: 1.0 },
    sectionHeadline: { sizePx: 72, weight: 300, tracking: '-0.035em', lineHeight: 1.02 },
    subHeadline: { sizePx: 34, weight: 400, tracking: '-0.015em', lineHeight: 1.25 },
    bodyEditorial: { sizePx: 31, weight: 400, tracking: '-0.01em', lineHeight: 1.28 },
    receiptRow: { sizePx: 15, weight: 500, tracking: '0.01em', lineHeight: 1.0 },
    label: { sizePx: 14, weight: 500, tracking: '0.14em', lineHeight: 1.45 },
    labelSmall: { sizePx: 12, weight: 500, tracking: '0.12em', lineHeight: 1.4 },
    microCaption: { sizePx: 11, weight: 500, tracking: '0.1em', lineHeight: 1.35 },
  },
  phone: {
    megaDisplay: { sizePx: 240, weight: 300, tracking: '-0.07em', lineHeight: 0.88 },
    heroMerchant: { sizePx: 104, weight: 300, tracking: '-0.06em', lineHeight: 0.88 },
    primaryMetric: { sizePx: 76, weight: 300, tracking: '-0.045em', lineHeight: 1.0 },
    secondaryMetric: { sizePx: 54, weight: 300, tracking: '-0.045em', lineHeight: 1.0 },
    chapterHeadline: { sizePx: 56, weight: 300, tracking: '-0.045em', lineHeight: 1.0 },
    bodyEditorial: { sizePx: 18, weight: 400, tracking: '-0.01em', lineHeight: 1.32 },
    receiptRow: { sizePx: 13, weight: 500, tracking: '0.01em', lineHeight: 1.1 },
    label: { sizePx: 11, weight: 500, tracking: '0.12em', lineHeight: 1.4 },
    microCaption: { sizePx: 10, weight: 500, tracking: '0.1em', lineHeight: 1.35 },
  },
} as const;

export const VIEWPORTS = {
  desktop1080: { width: 1920, height: 1080, mode: 'desktop' as const },
  desktop900: { width: 1440, height: 900, mode: 'desktop' as const },
  phone: { width: 390, height: 844, mode: 'phone' as const },
} as const;

export const SPACING = {
  desktopMarginX: 64,
  desktopMarginY: 28,
  desktopSafeTop: 84,
  desktopSafeBottom: 56,
  blockGap: 6,
  phoneMarginX: 20,
  phoneMarginY: 20,
  phoneBlockGap: 5,
} as const;

/**
 * 2025 Calendar Constants (Jan 1, 2025 is a Wednesday -> weekday = 2 when Mon = 0)
 */
export const JAN_1_2025_WEEKDAY = 2;

export const MONTH_DAYS_2025 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export const MONTH_START_DOY_2025: readonly number[] = (() => {
  const starts: number[] = [];
  let acc = 0;
  for (const d of MONTH_DAYS_2025) {
    starts.push(acc);
    acc += d;
  }
  return starts;
})();

export const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const MONTH_NAMES_UPPER = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

export const MONTH_NAMES_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const WEEKDAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Full plural weekday names ("Mondays".."Sundays") — fixes "SATDAYS" typo in sketch */
export const WEEKDAY_NAMES_PLURAL = [
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
  'Sundays',
] as const;

export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export interface GridPreset {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Center-to-center cell pitch in stage pixels (`p` in prototype) */
  readonly p: number;
  /** Square side length in stage pixels (`c` in prototype) */
  readonly c: number;
  readonly orientation?: 'horizontal' | 'vertical';
}

/**
 * Canonical 53×7 Grid Layout Presets (in 1920×1080 stage coordinates, plus phone vertical).
 */
export const GRID_PRESETS = {
  opener: { id: 'opener', x: 165, y: 700, p: 30, c: 26, orientation: 'horizontal' },
  sweep: { id: 'sweep', x: 112, y: 520, p: 32, c: 28, orientation: 'horizontal' },
  explore: { id: 'explore', x: 160, y: 330, p: 30, c: 26, orientation: 'horizontal' },
  ask: { id: 'ask', x: 112, y: 810, p: 24, c: 20, orientation: 'horizontal' },
  mini: { id: 'mini', x: 64, y: 880, p: 10, c: 8.4, orientation: 'horizontal' },
  phoneVertical: { id: 'phoneVertical', x: 20, y: 300, p: 10, c: 8.4, orientation: 'vertical' },
} as const satisfies Record<string, GridPreset>;

/**
 * Convert a 0-based day-of-year index (0..364) into `(col, row, month, dom, dow)`.
 */
export function getDayCalendarCoords(
  dayIndex: number,
  jan1Weekday = JAN_1_2025_WEEKDAY
): {
  dayIndex: number;
  col: number;
  row: number;
  month: number;
  dom: number;
  dow: number;
} {
  const clamped = Math.max(0, Math.min(364, Math.floor(dayIndex)));
  const offset = clamped + jan1Weekday;
  const col = Math.floor(offset / 7);
  const row = offset % 7;
  let month = 0;
  while (month < 11 && MONTH_START_DOY_2025[month + 1]! <= clamped) {
    month++;
  }
  const dom = clamped - MONTH_START_DOY_2025[month]! + 1;
  return {
    dayIndex: clamped,
    col,
    row,
    month,
    dom,
    dow: row,
  };
}

/**
 * Compute the center `[cx, cy]` of day `dayIndex` (0..364) in the given `GridPreset`.
 */
export function getGridCellCenter(
  dayIndex: number,
  preset: GridPreset,
  jan1Weekday = JAN_1_2025_WEEKDAY
): [number, number] {
  const { col, row } = getDayCalendarCoords(dayIndex, jan1Weekday);
  if (preset.orientation === 'vertical') {
    const colPitch = 13.6;
    return [preset.x + row * colPitch + preset.c / 2, preset.y + col * preset.p + preset.c / 2];
  }
  return [preset.x + col * preset.p + preset.c / 2, preset.y + row * preset.p + preset.c / 2];
}

/**
 * Hit-test stage coordinates `(x, y)` against a 53×7 `GridPreset`.
 * Returns day index `0..364`, or `-1` if outside the valid 365 days.
 */
export function hitTestGridDay(
  x: number,
  y: number,
  preset: GridPreset,
  loose = true,
  jan1Weekday = JAN_1_2025_WEEKDAY
): number {
  if (preset.orientation === 'vertical') {
    const colPitch = 13.6;
    const r = Math.floor((x - preset.x) / colPitch);
    const c = Math.floor((y - preset.y) / preset.p);
    if (c < 0 || c > 52 || r < 0 || r > 6) return -1;
    const idx = c * 7 + r - jan1Weekday;
    return idx >= 0 && idx < 365 ? idx : -1;
  }

  const c = Math.floor((x - preset.x) / preset.p);
  const r = Math.floor((y - preset.y) / preset.p);
  if (c < 0 || c > 52 || r < 0 || r > 6) return -1;
  if (!loose) {
    const localX = (x - preset.x) % preset.p;
    const localY = (y - preset.y) % preset.p;
    if (localX > preset.c || localY > preset.c) return -1;
  }
  const idx = c * 7 + r - jan1Weekday;
  return idx >= 0 && idx < 365 ? idx : -1;
}

/**
 * Format a 0-based day index (0..364) as e.g. `"Wed 1 Jan"`.
 */
export function formatDayIndexLabel(dayIndex: number, jan1Weekday = JAN_1_2025_WEEKDAY): string {
  const { dow, dom, month } = getDayCalendarCoords(dayIndex, jan1Weekday);
  return `${WEEKDAY_NAMES_SHORT[dow]} ${dom} ${MONTH_NAMES_SHORT[month]}`;
}
