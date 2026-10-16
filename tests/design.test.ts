import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../contracts/data.js';
import { buildMockDataset } from '../data/mock/index.js';
import {
  CATEGORY_COLORS,
  CATEGORY_META,
  CORE_COLORS,
  EASING,
  GRID_PRESETS,
  MOTION_TOKENS,
  MotionEventLogger,
  PALETTES,
  PALETTE_LIST,
  SOFT,
  SPR,
  WEEKDAY_NAMES_PLURAL,
  beatAtTime,
  formatDayIndexLabel,
  getContrastRatio,
  getDayCalendarCoords,
  getGridCellCenter,
  getIntensityBucket,
  getPaletteById,
  hexToRgb,
  hitTestGridDay,
  makeDampedSpring,
  meetsContrastAA,
  renderBigNumberHtml,
  renderBlockHtml,
  renderCategoryChipsHtml,
  renderComparisonBarsSvg,
  renderGridAnnotationsHtml,
  renderMiniYearDotsSvg,
  renderMonthlyBarsSvg,
  renderReceiptListHtml,
  renderStreakChainSvg,
  renderWeekdayBarsSvg,
  rgbToHex,
  snapToNextBeat,
  timeForBeat,
} from '../src/design/index.js';

describe('Motion System & Spring Solvers (src/design/motion.ts)', () => {
  it('defines all canonical MOTION_TOKENS on the 120 BPM beat grid', () => {
    expect(MOTION_TOKENS.bpm).toBe(120);
    expect(MOTION_TOKENS.beatSec).toBe(0.5);
    expect(MOTION_TOKENS.beat).toBe(0.5);

    expect(MOTION_TOKENS.tr).toEqual({
      textOut: 0.18,
      blockOut: 0.26,
      gap: 0.1,
      blockIn: 0.5,
      blockStagger: 0.07,
      textIn: 0.4,
      textStagger: 0.05,
      detailIn: 0.3,
    });

    expect(MOTION_TOKENS.spring.overshoot).toBe(0.15);
    expect(MOTION_TOKENS.spring.settleSec).toBe(0.3);
    expect(MOTION_TOKENS.soft.overshoot).toBe(0.05);
    expect(MOTION_TOKENS.soft.settleSec).toBe(0.5);

    expect(MOTION_TOKENS.st).toEqual({
      letter: 0.022,
      col: 0.003,
      wave: 0.0007,
      particle: 0.0021,
    });
    expect(MOTION_TOKENS.speeds).toEqual([0.5, 1, 2]);
  });

  it('solves 15% damped spring (SPR) with exact boundary values and +15% peak overshoot', () => {
    expect(SPR(0)).toBe(0);
    expect(SPR(-0.25)).toBe(0);
    expect(SPR(1)).toBe(1);
    expect(SPR(1.25)).toBe(1);

    // Peak at peakTime = Math.PI / wd
    const peakAtExact = SPR(SPR.peakTime);
    expect(peakAtExact).toBeCloseTo(1.15, 4);

    // Sample 1,000 steps in [0, 1] to verify numerical maximum
    let maxVal = 0;
    for (let i = 0; i <= 1000; i++) {
      const v = SPR(i / 1000);
      if (v > maxVal) maxVal = v;
    }
    expect(maxVal).toBeCloseTo(1.15, 3);
    expect(SPR.zeta).toBeCloseTo(0.5169, 3);
  });

  it('solves 5% soft block spring (SOFT) with exact boundary values and +5% peak overshoot', () => {
    expect(SOFT(0)).toBe(0);
    expect(SOFT(1)).toBe(1);

    const peakAtExact = SOFT(SOFT.peakTime);
    expect(peakAtExact).toBeCloseTo(1.05, 4);

    let maxVal = 0;
    for (let i = 0; i <= 1000; i++) {
      const v = SOFT(i / 1000);
      if (v > maxVal) maxVal = v;
    }
    expect(maxVal).toBeCloseTo(1.05, 3);
    expect(SOFT.zeta).toBeCloseTo(0.6901, 3);

    const customSpring = makeDampedSpring(0.2);
    expect(customSpring(customSpring.peakTime)).toBeCloseTo(1.2, 4);
  });

  it('computes easing curves and 120 BPM beat snapping accurately', () => {
    for (const fn of [EASING.out3, EASING.in2, EASING.inOut3, EASING.glide, EASING.linear]) {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
    expect(EASING.inOut3(0.5)).toBeCloseTo(0.5, 6);
    expect(EASING.glide(0.5)).toBeCloseTo(0.5, 6);

    expect(beatAtTime(0)).toBe(0);
    expect(beatAtTime(0.49)).toBe(0);
    expect(beatAtTime(0.5)).toBe(1);
    expect(beatAtTime(2.75)).toBe(5);
    expect(timeForBeat(4)).toBe(2.0);

    // Exit at 0.35s + 0.10s gap = 0.45s -> snaps to 0.50s (Beat 1)
    expect(snapToNextBeat(0.35, 0.1, 120)).toBeCloseTo(0.5, 6);
    // Exit at 0.44s + 0.10s gap = 0.54s -> snaps to 1.00s (Beat 2)
    expect(snapToNextBeat(0.44, 0.1, 120)).toBeCloseTo(1.0, 6);
  });

  it('records deterministic audio-sync events via MotionEventLogger', () => {
    const logger = new MotionEventLogger({ enableConsoleLog: false });
    logger.setCurrentChapter('year_as_squares');
    logger.setDeterministicTimeMs(12500);

    const ev = logger.log('sweep.payday', { day: 'Fri 31 Jan', spend: 412.8 });
    expect(ev).toEqual({
      type: 'sweep.payday',
      timestamp: 12500,
      beat: 25,
      chapter_id: 'year_as_squares',
      value: { day: 'Fri 31 Jan', spend: 412.8 },
    });
    expect(logger.getEvents()).toHaveLength(1);
    expect(JSON.parse(logger.toJSON())).toHaveLength(1);
  });
});

describe('Palettes, Category Colors & WCAG Contrast (src/design/palette.ts)', () => {
  it('computes accurate WCAG 2.1 contrast ratios and hex/RGB conversions', () => {
    expect(hexToRgb('#111111')).toEqual([17, 17, 17]);
    expect(rgbToHex([244, 240, 58])).toBe('#F4F03A');
    expect(getContrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(getContrastRatio('#111111', '#111111')).toBeCloseTo(1, 2);
  });

  it('verifies >= 4.5 WCAG AA contrast across all 9 curated Blocks palettes', () => {
    expect(Object.keys(PALETTES).length).toBeGreaterThanOrEqual(8);
    expect(PALETTE_LIST.length).toBeGreaterThanOrEqual(8);

    for (const palette of PALETTE_LIST) {
      const stageRatio = getContrastRatio(palette.fg, palette.bg);
      expect(
        stageRatio,
        `Palette "${palette.id}" stage fg (${palette.fg}) vs bg (${palette.bg}) contrast ${stageRatio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);

      const accentRatio = getContrastRatio(palette.accent, CORE_COLORS.ink);
      expect(
        accentRatio,
        `Palette "${palette.id}" accent (${palette.accent}) vs ink contrast ${accentRatio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);

      const blockRoles = [
        palette.blocks.primary,
        palette.blocks.secondary,
        palette.blocks.tertiary,
        ...(palette.blocks.quaternary ? [palette.blocks.quaternary] : []),
      ];

      for (const blk of blockRoles) {
        const ratio = getContrastRatio(blk.fg, blk.bg);
        expect(
          ratio,
          `Palette "${palette.id}" block fg (${blk.fg}) vs bg (${blk.bg}) contrast ${ratio.toFixed(2)}`
        ).toBeGreaterThanOrEqual(4.5);
        expect(meetsContrastAA(blk.fg, blk.bg)).toBe(true);
      }
    }

    expect(getPaletteById('solar_ember').id).toBe('solar_ember');
    expect(getPaletteById('non_existent_palette').id).toBe('ink_solar');
  });

  it('verifies >= 4.5 WCAG AA contrast for all 17 canonical category colors against ink (#111111)', () => {
    for (const cat of CATEGORIES) {
      const color = CATEGORY_COLORS[cat];
      expect(color).toBeDefined();
      const meta = CATEGORY_META[cat];
      expect(meta.id).toBe(cat);
      const ratio = getContrastRatio(color, CORE_COLORS.ink);
      expect(
        ratio,
        `Category "${cat}" (${color}) vs #111111 contrast ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }

    expect(getIntensityBucket(0, 10000)).toBe(0);
    expect(getIntensityBucket(9800, 10000)).toBe(4);
  });
});

describe('Design Tokens, 53×7 Grid Geometry & Components (src/design/tokens.ts & components)', () => {
  it('maps all 365 days of 2025 to valid 53×7 grid coordinates and round-trips hit testing', () => {
    const jan1 = getDayCalendarCoords(0);
    expect(jan1).toEqual({
      dayIndex: 0,
      col: 0,
      row: 2, // Wednesday (Mon = 0)
      month: 0,
      dom: 1,
      dow: 2,
    });
    expect(formatDayIndexLabel(0)).toBe('Wed 1 Jan');

    const dec31 = getDayCalendarCoords(364);
    expect(dec31).toEqual({
      dayIndex: 364,
      col: 52,
      row: 2, // Wednesday
      month: 11,
      dom: 31,
      dow: 2,
    });
    expect(formatDayIndexLabel(364)).toBe('Wed 31 Dec');

    // Verify plural weekday names (ensuring "Saturdays" has no typo)
    expect(WEEKDAY_NAMES_PLURAL[5]).toBe('Saturdays');

    // Round-trip hit testing for every day in desktop & phone presets
    for (const preset of [
      GRID_PRESETS.opener,
      GRID_PRESETS.sweep,
      GRID_PRESETS.explore,
      GRID_PRESETS.phoneVertical,
    ]) {
      for (let d = 0; d < 365; d++) {
        const [cx, cy] = getGridCellCenter(d, preset);
        const hit = hitTestGridDay(cx, cy, preset);
        expect(hit).toBe(d);
      }
    }
    expect(hitTestGridDay(-50, -50, GRID_PRESETS.opener)).toBe(-1);
  });

  it('renders clean HTML/SVG for blocks, odometers, receipts, chips, and shapes', () => {
    const mock = buildMockDataset();
    const numHtml = renderBigNumberHtml({
      valueFormatted: '2,184',
      sizePx: 112,
      prefixSup: 'US$',
    });
    expect(numHtml).toContain('<sup>US$</sup>');
    expect(numHtml).toContain('data-v="2,184"');

    const blkHtml = renderBlockHtml({
      id: 'test-blk',
      axis: 'b',
      x: 100,
      y: 200,
      width: 400,
      height: 300,
      bg: '#F4F03A',
      fg: '#111111',
      label: 'LEFT THERE',
      valueFormatted: '2,184',
      prefixSup: 'US$',
      receiptCount: 72,
    });
    expect(blkHtml).toContain('data-ax="b"');
    expect(blkHtml).toContain('RECEIPTS · 72');

    const receiptsHtml = renderReceiptListHtml(mock.transactions.slice(0, 5), {
      showTotalRow: true,
    });
    expect(receiptsHtml).toContain('TOTAL');
    // Must not expose raw_description
    expect(receiptsHtml).not.toContain('SQ *BLUE BOTTLE COFFEE SEATTLE WA');

    const chipsHtml = renderCategoryChipsHtml(['coffee', 'groceries'], 'coffee');
    expect(chipsHtml).toContain('data-cat="coffee" aria-pressed="true"');

    const weekdaySvg = renderWeekdayBarsSvg([15, 7, 10, 7, 8, 16, 9]);
    expect(weekdaySvg).toContain('<svg');
    expect(weekdaySvg).toContain('>16<');

    const monthlySvg = renderMonthlyBarsSvg([7, 4, 6, 4, 6, 5, 4, 5, 6, 8, 7, 10]);
    expect(monthlySvg).toContain('<svg');

    const dotsSvg = renderMiniYearDotsSvg(new Set([0, 10, 20]));
    expect(dotsSvg).toContain('<svg');

    const gridAnno = renderGridAnnotationsHtml(GRID_PRESETS.opener, {
      showRibbon: true,
      showLegend: true,
    });
    expect(gridAnno).toContain('MONDAY ON TOP');

    const streakSvg = renderStreakChainSvg({ lengthDays: 9 });
    expect(streakSvg).toContain('<svg');

    const compSvg = renderComparisonBarsSvg([
      { label: 'January Purchase', valueFormatted: 'US$1,850', ratio: 1, color: '#F4F03A' },
      { label: 'Typical Week', valueFormatted: 'US$420', ratio: 0.23, color: '#FFA8E4' },
    ]);
    expect(compSvg).toContain('JANUARY PURCHASE');
  });
});
