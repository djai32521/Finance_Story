/**
 * High-DPI 2D/WebGL Hybrid Stage Canvas Engine (`src/design/canvas/stage-canvas.ts`)
 *
 * Powers the 4–5 signature "wow moments" at 1920 × 1080 (and responsive 1440 × 900 / 390 × 844) at 60fps:
 * 1. The Pour (~1,000 raw CSV rows unscrambling -> colored transaction particles)
 * 2. "2025" Title Assembly & Dissolve into the 53×7 calendar grid
 * 3. The Sweep (time-remapped 365-day fill on the 120 BPM beat grid with payday heartbeat rings)
 * 4. The Shatter (every purchase breaks out of the 53×7 grid into category columns sized by real totals, holding in interactive mode or snapping back on exit)
 * 5. Tactile Explore & Ask lighting (pointer hover magnification, radial ripples, lens wave re-coloring, marching-ants range selection)
 */

import type { Category, Day, Transaction } from '../../../contracts/data.js';
import { EASING, MOTION_TOKENS, SPR, isReducedMotion, mlog } from '../motion.js';
import {
  CATEGORY_META,
  CORE_COLORS,
  GRID_INTENSITY_STEPS_RGB,
  getIntensityBucket,
  hexToRgb,
  mixRgb,
  type RGBTuple,
} from '../palette.js';
import {
  GRID_PRESETS,
  JAN_1_2025_WEEKDAY,
  getDayCalendarCoords,
  getGridCellCenter,
  hitTestGridDay,
  type GridPreset,
} from '../tokens.js';

export interface TweenEntry {
  f: number | null;
  t: number;
  t0: number;
  d: number;
  e: (q: number) => number;
}

export interface FlightEntry {
  fx: number | null;
  fy: number | null;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  arc: number;
  t0: number;
  d: number;
  e: (q: number) => number;
  cb?: (p: ParticleView) => void;
}

export interface DayView {
  index: number;
  day: Day;
  col: number;
  row: number;
  month: number;
  dom: number;
  dow: number;
  spendDollars: number;
  spendMinor: number;
  isPayday: boolean;
  bucket: 0 | 1 | 2 | 3 | 4;
  baseRgb: RGBTuple;
  txIndices: number[];
  x: number;
  y: number;
  s: number;
  k: number;
  r: number;
  g: number;
  b: number;
  hov: number;
  hovT: number;
  pt: number | null;
  pa: number;
  rt: number | null;
  ra: number;
  A: Record<string, TweenEntry> | null;
  landedDollars: number;
  nLanded: number;
}

export interface ParticleView {
  index: number;
  tx: Transaction;
  dayIndex: number;
  category: Category;
  catRgb: RGBTuple;
  shatterRgb: RGBTuple;
  amtDollars: number;
  rawRow: string;
  cleanRow: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sc: number;
  r: number;
  g: number;
  b: number;
  v: number;
  pt: number | null;
  pa: number;
  A: Record<string, TweenEntry> | null;
  F: FlightEntry | null;
}

export interface RingPulse {
  x: number;
  y: number;
  t0: number;
  d: number;
  r0: number;
  r1: number;
  c: string;
  lw: number;
  sq: boolean;
}

export interface ShatterCategorySummary {
  category: Category;
  label: string;
  color: string;
  rgb: RGBTuple;
  totalDollars: number;
  totalMinor: number;
  count: number;
  share: number;
  txIndices: number[];
}

export interface ShatterLayoutConfig {
  x0: number;
  w: number;
  gap: number;
  baseY: number;
  maxH: number;
  topDollars: number;
  scale: number;
}

/**
 * Deterministic seeded PRNG (`mulberry32`) so particle flights & arcs are 100% reproducible.
 */
export function createDeterministicRng(seed = 20250101): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RGB_BONE = hexToRgb(CORE_COLORS.bone);
const RGB_EMBER = hexToRgb(CORE_COLORS.ember);
const RGB_DIM = hexToRgb(CORE_COLORS.dimCell);

export class StageCanvasEngine {
  public readonly canvas: HTMLCanvasElement;
  public readonly ctx: CanvasRenderingContext2D;
  public readonly dayViews: DayView[] = [];
  public readonly particleViews: ParticleView[] = [];
  public readonly categories: ShatterCategorySummary[] = [];
  public readonly cumulativeSpendDollars: number[] = [0];
  public readonly paydayIndices: number[] = [];

  public currentGrid: GridPreset = GRID_PRESETS.opener;
  public backingScale = 1;
  public nowSec = 0;
  public frameCount = 0;
  public daysVisible = true;
  public particlesAlpha = 1;
  public activeParticleCount = 0;
  public lensBracketAlpha = 0;
  public selection: { a: number; b: number; on: boolean } = { a: -1, b: -1, on: false };
  public rings: RingPulse[] = [];

  public totalSpendDollars = 0;
  public p97DayDollars = 100;
  public p95DayDollars = 80;
  public maxDayDollars = 200;
  public loudestDayIndex = 0;

  public sweepRemapTable: number[] = [];
  public sweepDurationSec = 7.5;
  public shatterLayout: ShatterLayoutConfig = {
    x0: 200,
    w: 160,
    gap: 46,
    baseY: 860,
    maxH: 560,
    topDollars: 10000,
    scale: 560 / 10000,
  };
  public shatterSlots: Array<[number, number, number]> = [];
  public titlePoints: Array<[number, number]> = [];
  public titleBox: { left: number; top: number; w: number; step: number } = {
    left: 410,
    top: 220,
    w: 1100,
    step: 9,
  };

  private rng: () => number;

  constructor(
    canvas: HTMLCanvasElement,
    dataset: {
      days: readonly Day[];
      transactions: readonly Transaction[];
      shatterCategories?: readonly Category[];
    }
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('StageCanvasEngine requires a 2D CanvasRenderingContext2D');
    }
    this.ctx = context;
    this.rng = createDeterministicRng(20250101);
    this.nowSec = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;

    this.initData(dataset.days, dataset.transactions, dataset.shatterCategories);
    this.buildSweepTimeRemap();
    this.buildShatterSlots();
    this.computeTitlePoints();
  }

  private initData(
    days: readonly Day[],
    transactions: readonly Transaction[],
    shatterCategoryFilter?: readonly Category[]
  ): void {
    // Outgoing everyday & bills spending transactions for particles & shatter
    const spendTxns = transactions
      .filter(
        (t) =>
          t.direction === 'out' &&
          !t.is_transfer &&
          !t.is_refund &&
          t.category !== 'savings' &&
          t.category !== 'rent' &&
          t.category !== 'fees'
      )
      .slice(0, 1000);

    const dayIndexByIso = new Map<string, number>();
    days.slice(0, 365).forEach((d, idx) => dayIndexByIso.set(d.date, idx));

    const sortedDaySpends = days
      .slice(0, 365)
      .map((d) => d.discretionary_out_minor / 100)
      .sort((a, b) => a - b);

    this.p97DayDollars = Math.max(10, sortedDaySpends[Math.floor(365 * 0.97)] ?? 100);
    this.p95DayDollars = Math.max(10, sortedDaySpends[Math.floor(365 * 0.95)] ?? 80);
    this.maxDayDollars = Math.max(10, sortedDaySpends[sortedDaySpends.length - 1] ?? 200);

    let maxSpend = -1;
    for (let i = 0; i < 365; i++) {
      const day = days[i]!;
      const coords = getDayCalendarCoords(i);
      const spendDollars = day.discretionary_out_minor / 100;
      const bucket = getIntensityBucket(day.discretionary_out_minor, this.p97DayDollars * 100);
      const baseRgb = day.is_payday
        ? ([...RGB_EMBER] as RGBTuple)
        : ([...GRID_INTENSITY_STEPS_RGB[bucket]!] as RGBTuple);

      if (day.is_payday) {
        this.paydayIndices.push(i);
      }
      if (spendDollars > maxSpend) {
        maxSpend = spendDollars;
        this.loudestDayIndex = i;
      }

      const [gx, gy] = getGridCellCenter(i, this.currentGrid);
      this.dayViews.push({
        index: i,
        day,
        col: coords.col,
        row: coords.row,
        month: coords.month,
        dom: coords.dom,
        dow: coords.dow,
        spendDollars,
        spendMinor: day.discretionary_out_minor,
        isPayday: day.is_payday,
        bucket,
        baseRgb,
        txIndices: [],
        x: gx,
        y: gy,
        s: this.currentGrid.c,
        k: 1,
        r: baseRgb[0],
        g: baseRgb[1],
        b: baseRgb[2],
        hov: 1,
        hovT: 1,
        pt: null,
        pa: 0,
        rt: null,
        ra: 0,
        A: null,
        landedDollars: spendDollars,
        nLanded: 0,
      });

      this.cumulativeSpendDollars.push(
        this.cumulativeSpendDollars[this.cumulativeSpendDollars.length - 1]! + spendDollars
      );
    }

    const noisePrefixes = ['', '', 'POS ', 'DBT ', 'CKCD ', 'PURCH '];
    const pad2 = (n: number) => String(n).padStart(2, '0');

    spendTxns.forEach((tx, j) => {
      const dayIdx = dayIndexByIso.get(tx.date) ?? 0;
      const dv = this.dayViews[dayIdx]!;
      dv.txIndices.push(j);
      dv.nLanded++;

      const meta = CATEGORY_META[tx.category] ?? CATEGORY_META.shopping;
      const amtDollars = tx.amount_minor / 100;
      this.totalSpendDollars += amtDollars;

      const prefix = noisePrefixes[Math.floor(this.rng() * noisePrefixes.length)]!;
      const rawLeft = `${pad2(dv.month + 1)}${pad2(dv.dom)} ${prefix}${tx.merchant.toUpperCase()}`
        .slice(0, 19)
        .padEnd(19, ' ');
      const rawRow = rawLeft + ('-' + amtDollars.toFixed(2)).padStart(7, ' ');
      const cleanLeft = `${pad2(dv.dom)} ${tx.merchant}`.slice(0, 19).padEnd(19, ' ');
      const cleanRow = cleanLeft + amtDollars.toFixed(2).padStart(7, ' ');

      this.particleViews.push({
        index: j,
        tx,
        dayIndex: dayIdx,
        category: tx.category,
        catRgb: [...meta.rgb] as RGBTuple,
        shatterRgb: [...meta.rgb] as RGBTuple,
        amtDollars,
        rawRow,
        cleanRow,
        x: dv.x,
        y: dv.y,
        w: 8,
        h: 8,
        sc: 1,
        r: RGB_BONE[0],
        g: RGB_BONE[1],
        b: RGB_BONE[2],
        v: 0,
        pt: null,
        pa: 0,
        A: null,
        F: null,
      });
    });

    // Build top 8 categories for Shatter columns & Personality wheel
    const defaultCats: Category[] = shatterCategoryFilter
      ? [...shatterCategoryFilter]
      : ['groceries', 'eating out', 'coffee', 'transport', 'shopping', 'bills', 'fun', 'travel'];

    const byCat = new Map<Category, number[]>();
    this.particleViews.forEach((pv, j) => {
      const list = byCat.get(pv.category) ?? [];
      list.push(j);
      byCat.set(pv.category, list);
    });

    // Ensure we show 8 active categories sorted or ordered cleanly
    const chosenCats = defaultCats.slice(0, 8);
    const totalAll = Math.max(1, this.totalSpendDollars);

    chosenCats.forEach((cat) => {
      const meta = CATEGORY_META[cat];
      const indices = byCat.get(cat) ?? [];
      const totalDollars = indices.reduce(
        (acc, idx) => acc + this.particleViews[idx]!.amtDollars,
        0
      );
      const totalMinor = indices.reduce(
        (acc, idx) => acc + this.particleViews[idx]!.tx.amount_minor,
        0
      );
      this.categories.push({
        category: cat,
        label: meta.label,
        color: meta.color,
        rgb: [...meta.rgb] as RGBTuple,
        totalDollars,
        totalMinor,
        count: indices.length,
        share: totalDollars / totalAll,
        txIndices: indices,
      });
    });
  }

  /**
   * Build the time-remapping lookup table (`SWT` of length 366) that slows into
   * loud spending days & paydays while snapping every payday onto the 120 BPM beat grid.
   */
  public buildSweepTimeRemap(targetDurationSec = 7.5): void {
    this.sweepDurationSec = targetDurationSec;
    const weights = this.dayViews.map(
      (d) =>
        0.22 +
        1.4 * Math.min(2.2, Math.pow(d.spendDollars / this.p95DayDollars, 1.35)) +
        (d.isPayday ? 1.1 : 0) +
        (d.month === 11 ? 0.45 : 0)
    );

    const t0: number[] = [0];
    for (const w of weights) {
      t0.push(t0[t0.length - 1]! + w);
    }
    const scale = targetDurationSec / (t0[365] || 1);
    for (let i = 0; i <= 365; i++) {
      t0[i]! *= scale;
    }

    const anchors: Array<[number, number]> = [[0, 0]];
    for (const payDayIdx of this.paydayIndices) {
      let snapped = Math.round(t0[payDayIdx]! / MOTION_TOKENS.beat) * MOTION_TOKENS.beat;
      const prevTime = anchors[anchors.length - 1]![1];
      if (snapped <= prevTime) {
        snapped = prevTime + MOTION_TOKENS.beat;
      }
      anchors.push([payDayIdx, snapped]);
    }
    anchors.push([
      365,
      Math.max(targetDurationSec, anchors[anchors.length - 1]![1] + MOTION_TOKENS.beat),
    ]);

    const table = new Array<number>(366).fill(0);
    for (let k = 0; k < anchors.length - 1; k++) {
      const [ia, ta] = anchors[k]!;
      const [ib, tb] = anchors[k + 1]!;
      const spanT0 = t0[ib]! - t0[ia]! || 1;
      for (let i = ia; i <= ib; i++) {
        table[i] = ta + ((t0[i]! - t0[ia]!) / spanT0) * (tb - ta);
      }
    }
    this.sweepRemapTable = table;
  }

  public getSweepTotalDuration(): number {
    return this.sweepRemapTable[365] ?? this.sweepDurationSec;
  }

  /**
   * Map elapsed sweep time `t` (in seconds) to continuous day index `0..365`.
   */
  public getDayAtSweepTime(t: number): number {
    const end = this.getSweepTotalDuration();
    if (t <= 0) return 0;
    if (t >= end) return 365;
    let lo = 0;
    let hi = 365;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.sweepRemapTable[mid]! <= t) lo = mid;
      else hi = mid;
    }
    const tLo = this.sweepRemapTable[lo]!;
    const tHi = this.sweepRemapTable[lo + 1]!;
    return lo + (t - tLo) / (tHi - tLo || 1);
  }

  /**
   * Build category column slots `[cx, cy, size]` for every particle in `particleViews`.
   */
  public buildShatterSlots(): void {
    const maxCatDollars = Math.max(1000, ...this.categories.map((c) => c.totalDollars));
    const topDollars = Math.ceil(maxCatDollars / 2000) * 2000;
    this.shatterLayout.topDollars = topDollars;
    this.shatterLayout.scale = this.shatterLayout.maxH / topDollars;

    this.shatterSlots = new Array<[number, number, number]>(this.particleViews.length);
    const catIndexMap = new Map<Category, number>();
    this.categories.forEach((c, k) => catIndexMap.set(c.category, k));

    const siblingFallback: Partial<Record<Category, Category>> = {
      takeaway: 'eating out',
      subscriptions: 'bills',
      health: 'fun',
      gifts: 'shopping',
    };

    // Group all particles into the 8 displayed columns
    const buckets: number[][] = this.categories.map(() => []);
    this.particleViews.forEach((p, idx) => {
      const mappedCat = siblingFallback[p.category] ?? p.category;
      const colIdx = catIndexMap.get(mappedCat) ?? idx % this.categories.length;
      p.shatterRgb = [...this.categories[colIdx]!.rgb] as RGBTuple;
      buckets[colIdx]!.push(idx);
    });

    this.categories.forEach((cat, k) => {
      const indices = buckets[k]!;
      const W = this.shatterLayout.w;
      const H = Math.max(30, cat.totalDollars * this.shatterLayout.scale);
      const n = Math.max(1, indices.length);
      let s = Math.sqrt((W * H) / n);
      const perRow = Math.max(1, Math.round(W / s));
      s = W / perRow;
      const x0 = this.shatterLayout.x0 + k * (this.shatterLayout.w + this.shatterLayout.gap);
      const gap = s > 8 ? 1.5 : 0.8;

      indices.forEach((pIdx, j) => {
        const cx = x0 + ((j % perRow) + 0.5) * s;
        const cy = this.shatterLayout.baseY - (Math.floor(j / perRow) + 0.5) * s;
        this.shatterSlots[pIdx] = [cx, cy, Math.max(2, s - gap)];
      });
    });
  }

  /**
   * Sample pixel coordinates for the `"2025"` particle title assembly.
   */
  public computeTitlePoints(titleElement?: HTMLElement | null): void {
    const count = Math.max(1, this.particleViews.length);
    const fontSize = 560;
    let left = 310;
    let top = 210;
    let width = 1300;
    let baselineOffset = 430;

    if (titleElement) {
      titleElement.style.left = '0px';
      titleElement.style.top = '0px';
      const textSpan = titleElement.querySelector<HTMLElement>('#ttlt');
      const baseSpan = titleElement.querySelector<HTMLElement>('#ttlb');
      if (textSpan && textSpan.offsetWidth > 100) {
        width = textSpan.offsetWidth;
        baselineOffset = baseSpan?.offsetTop || 430;
        left = Math.round((1920 - width) / 2);
        top = Math.round(640 - baselineOffset);
        titleElement.style.left = `${left}px`;
        titleElement.style.top = `${top}px`;
      }
    }

    if (typeof document !== 'undefined') {
      const oc = document.createElement('canvas');
      oc.width = 1920;
      oc.height = 1080;
      const c = oc.getContext('2d', { willReadFrequently: true });
      if (c) {
        c.font = `400 ${fontSize}px "Inter Tight", sans-serif`;
        c.textBaseline = 'alphabetic';
        c.fillStyle = '#ffffff';
        c.fillText('2025', left, top + baselineOffset);
        const img = c.getImageData(0, 0, 1920, 1080).data;

        let step = 16;
        let pts: Array<[number, number]> = [];
        for (; step >= 4; step -= 0.5) {
          pts = [];
          for (let y = step / 2; y < 1080; y += step) {
            for (let x = step / 2; x < 1920; x += step) {
              if (img[((y | 0) * 1920 + (x | 0)) * 4 + 3]! > 140) {
                pts.push([x, y]);
              }
            }
          }
          if (pts.length >= count) break;
        }

        if (pts.length > 0) {
          const sampled: Array<[number, number]> = [];
          const ratio = pts.length / count;
          for (let i = 0; i < count; i++) {
            sampled.push(pts[Math.min(pts.length - 1, Math.floor(i * ratio))]!);
          }
          sampled.sort((a, b) => a[0] + a[1] * 0.15 - (b[0] + b[1] * 0.15));
          this.titlePoints = sampled;
          this.titleBox = { left, top, w: width, step };
          return;
        }
      }
    }

    // Fallback procedural grid if offscreen canvas has no text rasterizer
    const fallback: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      fallback.push([left + (i % 40) * 28, top + Math.floor(i / 40) * 18]);
    }
    this.titlePoints = fallback;
    this.titleBox = { left, top, w: width, step: 10 };
  }

  /**
   * Property tween helper on a DayView or ParticleView.
   */
  public tweenProp(
    target: { A: Record<string, TweenEntry> | null },
    key: string,
    toValue: number,
    durationSec: number,
    delaySec = 0,
    ease: (q: number) => number = EASING.out3
  ): void {
    if (!target.A) target.A = {};
    target.A[key] = {
      f: null,
      t: toValue,
      t0: this.nowSec + delaySec,
      d: Math.max(0.001, durationSec),
      e: ease,
    };
  }

  public tweenColor(
    target: { r: number; g: number; b: number; A: Record<string, TweenEntry> | null },
    rgb: Readonly<RGBTuple>,
    durationSec: number,
    delaySec = 0,
    ease: (q: number) => number = EASING.out3
  ): void {
    this.tweenProp(target, 'r', rgb[0], durationSec, delaySec, ease);
    this.tweenProp(target, 'g', rgb[1], durationSec, delaySec, ease);
    this.tweenProp(target, 'b', rgb[2], durationSec, delaySec, ease);
  }

  public setColorImmediate(
    target: { r: number; g: number; b: number; A: Record<string, TweenEntry> | null },
    rgb: Readonly<RGBTuple>
  ): void {
    target.r = rgb[0];
    target.g = rgb[1];
    target.b = rgb[2];
    if (target.A) {
      delete target.A.r;
      delete target.A.g;
      delete target.A.b;
    }
  }

  public popTarget(
    target: { pt: number | null; pa: number },
    amplitude: number,
    delaySec = 0
  ): void {
    target.pt = this.nowSec + delaySec;
    target.pa = amplitude;
  }

  public flyParticle(
    p: ParticleView,
    tx: number,
    ty: number,
    durationSec: number,
    delaySec: number,
    arcFactor: number,
    ease: (q: number) => number,
    onComplete?: (p: ParticleView) => void
  ): void {
    p.F = {
      fx: null,
      fy: null,
      cx: 0,
      cy: 0,
      tx,
      ty,
      arc: arcFactor,
      t0: this.nowSec + delaySec,
      d: Math.max(0.001, durationSec),
      e: ease,
      cb: onComplete,
    };
  }

  public addRing(
    x: number,
    y: number,
    options: {
      delay?: number;
      d?: number;
      r0?: number;
      r1?: number;
      c?: string;
      lw?: number;
      sq?: boolean;
    } = {}
  ): void {
    this.rings.push({
      x,
      y,
      t0: this.nowSec + (options.delay ?? 0),
      d: options.d ?? 0.6,
      r0: options.r0 ?? 14,
      r1: options.r1 ?? 90,
      c: options.c ?? CORE_COLORS.ember,
      lw: options.lw ?? 2,
      sq: options.sq !== false,
    });
  }

  /**
   * Move the 53×7 calendar grid to a `GridPreset` (either smoothly with column stagger or immediately).
   */
  public setGrid(
    preset: GridPreset,
    options: { dur?: number; st?: number; delay?: number; instant?: boolean } = {}
  ): void {
    this.currentGrid = preset;
    const dur = options.dur ?? 0.5;
    const st = options.st ?? MOTION_TOKENS.st.col;
    const instant = options.instant || isReducedMotion();

    this.dayViews.forEach((v, i) => {
      const [x, y] = getGridCellCenter(i, preset);
      if (instant) {
        v.x = x;
        v.y = y;
        v.s = preset.c;
        if (v.A) {
          delete v.A.x;
          delete v.A.y;
          delete v.A.s;
        }
      } else {
        const dl = (options.delay ?? 0) + v.col * st;
        this.tweenProp(v, 'x', x, dur, dl, EASING.glide);
        this.tweenProp(v, 'y', y, dur, dl, EASING.glide);
        this.tweenProp(v, 's', preset.c, dur, dl, EASING.glide);
      }
    });
  }

  public colorAllDays(
    colorFn: (dayIndex: number, dv: DayView) => Readonly<RGBTuple> | null,
    options: { dur?: number; delay?: (dayIndex: number) => number; instant?: boolean } = {}
  ): void {
    const instant = options.instant || isReducedMotion();
    this.dayViews.forEach((v, i) => {
      const rgb = colorFn(i, v);
      if (!rgb) return;
      if (instant) {
        this.setColorImmediate(v, rgb);
      } else {
        this.tweenColor(v, rgb, options.dur ?? 0.24, options.delay ? options.delay(i) : 0);
      }
    });
  }

  public hitDay(x: number, y: number, preset = this.currentGrid, loose = true): number {
    return hitTestGridDay(x, y, preset, loose, JAN_1_2025_WEEKDAY);
  }

  /**
   * Compute sub-square position `[x, y, size]` of a transaction inside its parent day square.
   */
  public getParticleSubPosInDay(particleIndex: number): [number, number, number] {
    const p = this.particleViews[particleIndex]!;
    const v = this.dayViews[p.dayIndex]!;
    const n = Math.max(1, v.txIndices.length);
    const g = Math.ceil(Math.sqrt(n));
    const k = Math.max(0, v.txIndices.indexOf(particleIndex));
    const s = v.s / g;
    return [
      v.x - v.s / 2 + ((k % g) + 0.5) * s,
      v.y - v.s / 2 + (Math.floor(k / g) + 0.5) * s,
      s * 0.86,
    ];
  }

  /**
   * Trigger Mode 3 (The Shatter): break every purchase out of its day square into category columns.
   */
  public startShatter(instant = false): void {
    this.activeParticleCount = this.particleViews.length;
    this.particlesAlpha = 1;

    if (instant || isReducedMotion()) {
      this.dayViews.forEach((v) => {
        v.k = 0;
        if (v.A) delete v.A.k;
      });
      this.particleViews.forEach((p, idx) => {
        const slot = this.shatterSlots[idx]!;
        p.v = 1;
        p.x = slot[0];
        p.y = slot[1];
        p.w = slot[2];
        p.h = slot[2];
        p.sc = 1;
        p.A = null;
        p.F = null;
        this.setColorImmediate(p, p.shatterRgb);
      });
      return;
    }

    mlog('shatter.break', this.particleViews.length);
    this.particleViews.forEach((p, idx) => {
      const [sx, sy, ss] = this.getParticleSubPosInDay(idx);
      const v = this.dayViews[p.dayIndex]!;
      p.v = 1;
      p.A = null;
      p.pt = null;
      p.x = sx;
      p.y = sy;
      p.w = ss;
      p.h = ss;
      p.sc = 1;
      this.setColorImmediate(p, [v.r, v.g, v.b]);

      const [tx, ty, ts] = this.shatterSlots[idx]!;
      const dl = v.col * 0.011 + this.rng() * 0.14;
      const d = 0.5 + this.rng() * 0.14;
      const arc = (this.rng() < 0.5 ? -1 : 1) * (0.08 + this.rng() * 0.16);

      this.flyParticle(p, tx, ty, d, dl, arc, EASING.inOut3, (pp) => this.popTarget(pp, 0.3));
      this.tweenProp(p, 'w', ts, d, dl, EASING.inOut3);
      this.tweenProp(p, 'h', ts, d, dl, EASING.inOut3);
      this.tweenColor(p, p.shatterRgb, d * 0.6, dl + 0.08);
    });

    this.dayViews.forEach((v) => {
      v.k = 0;
      if (v.A) delete v.A.k;
    });
  }

  /**
   * Snap Shatter particles back from category columns into their 53×7 calendar squares.
   */
  public snapBackShatter(): void {
    if (isReducedMotion()) {
      this.particleViews.forEach((p) => {
        p.v = 0;
        p.F = null;
      });
      this.activeParticleCount = 0;
      this.dayViews.forEach((v) => {
        v.k = 1;
      });
      return;
    }

    mlog('shatter.snap', this.particleViews.length);
    const remainingPerDay = this.dayViews.map((d) => d.txIndices.length);
    this.dayViews.forEach((v, i) => {
      if (remainingPerDay[i] === 0) {
        this.tweenProp(v, 'k', 1, 0.3, (52 - v.col) * 0.005, SPR);
      }
    });

    this.particleViews.forEach((p, idx) => {
      const [sx, sy, ss] = this.getParticleSubPosInDay(idx);
      const v = this.dayViews[p.dayIndex]!;
      const dl = (52 - v.col) * 0.005 + this.rng() * 0.1;
      const d = 0.46 + this.rng() * 0.1;
      const arc = (this.rng() < 0.5 ? -1 : 1) * (0.06 + this.rng() * 0.1);

      this.flyParticle(p, sx, sy, d, dl, arc, SPR, (pp) => {
        pp.v = 0;
        remainingPerDay[p.dayIndex]!--;
        if (remainingPerDay[p.dayIndex]! <= 0) {
          v.k = 1;
          this.popTarget(v, 0.25);
        }
      });
      this.tweenProp(p, 'w', ss, d * 0.8, dl);
      this.tweenProp(p, 'h', ss, d * 0.8, dl);
      this.tweenColor(p, v.baseRgb, d * 0.6, dl);
    });
  }

  /**
   * Recolor the 53×7 grid in a radial wave expanding from stage point `(ox, oy)`.
   */
  public recolorWaveFromPoint(ox: number, oy: number, category: Category | ''): void {
    const waveSpeed = isReducedMotion() ? 0 : MOTION_TOKENS.st.wave;
    const catMeta = category ? CATEGORY_META[category] : null;
    const catSummary = category ? this.categories.find((c) => c.category === category) : undefined;
    const avgCatSpend =
      catSummary && catSummary.count > 0 ? catSummary.totalDollars / catSummary.count : 25;

    this.dayViews.forEach((v) => {
      const dist = Math.hypot(v.x - ox, v.y - oy);
      let targetRgb: RGBTuple = v.baseRgb;

      if (category && catMeta) {
        const dayCatSpend = v.txIndices
          .map((idx) => this.particleViews[idx]!)
          .filter((p) => p.category === category)
          .reduce((acc, p) => acc + p.amtDollars, 0);

        if (dayCatSpend <= 0) {
          targetRgb = [...RGB_DIM] as RGBTuple;
        } else {
          const q = Math.min(1, Math.sqrt(dayCatSpend / (avgCatSpend * 2.2)));
          targetRgb = mixRgb(hexToRgb('#2A2A28'), catMeta.rgb, 0.35 + 0.65 * q);
        }
      }

      this.tweenColor(v, targetRgb, 0.24, dist * waveSpeed);
      if (!isReducedMotion()) {
        v.rt = this.nowSec + dist * waveSpeed;
        v.ra = 0.3;
      }
    });

    if (!isReducedMotion()) {
      this.addRing(ox, oy, {
        r0: 10,
        r1: 1500,
        d: 1500 * waveSpeed * 1.05,
        c: catMeta ? catMeta.color : CORE_COLORS.bone,
        lw: 2,
        sq: false,
      });
    }
  }

  private stepTweens<T extends { A: Record<string, TweenEntry> | null }>(target: T): void {
    const A = target.A;
    if (!A) return;
    let hasActive = false;
    for (const k of Object.keys(A)) {
      const entry = A[k]!;
      const propKey = k as keyof T;
      const q = (this.nowSec - entry.t0) / entry.d;
      if (q < 0) {
        hasActive = true;
        continue;
      }
      if (entry.f === null) {
        entry.f = Number(target[propKey] ?? 0);
      }
      if (q >= 1) {
        target[propKey] = entry.t as T[keyof T];
        delete A[k];
      } else {
        target[propKey] = (entry.f + (entry.t - entry.f) * entry.e(q)) as T[keyof T];
        hasActive = true;
      }
    }
    if (!hasActive) {
      target.A = null;
    }
  }

  private getDayDrawSize(v: DayView): number {
    let sz = v.s * v.k * v.hov;
    if (v.pt !== null) {
      const p = (this.nowSec - v.pt) / 0.36;
      if (p >= 1) v.pt = null;
      else if (p > 0) sz *= 1 + v.pa * Math.sin(Math.PI * p) * (1 - p);
    }
    if (v.rt !== null) {
      const p = (this.nowSec - v.rt) / 0.32;
      if (p >= 1) v.rt = null;
      else if (p > 0) sz *= 1 + v.ra * Math.sin(Math.PI * p);
    }
    return sz;
  }

  /**
   * Advance animations and render the current frame onto the 2D canvas.
   */
  public renderFrame(dtSec = 1 / 60, explicitTimeSec?: number): void {
    if (explicitTimeSec !== undefined) {
      this.nowSec = explicitTimeSec;
    } else {
      this.nowSec += dtSec;
    }
    this.frameCount++;

    const c = this.ctx;
    c.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
    c.clearRect(0, 0, 1920, 1080);

    const hoverLerp = Math.min(1, dtSec * 16);
    let hoveredList: Array<[DayView, number]> | null = null;

    // 1. Render 365 Day Squares
    if (this.daysVisible) {
      for (const v of this.dayViews) {
        this.stepTweens(v);
        if (v.hov !== v.hovT) {
          v.hov += (v.hovT - v.hov) * hoverLerp;
          if (Math.abs(v.hov - v.hovT) < 0.002) v.hov = v.hovT;
        }
        const sz = this.getDayDrawSize(v);
        if (sz < 0.4) continue;
        if (v.hov > 1.03) {
          if (!hoveredList) hoveredList = [];
          hoveredList.push([v, sz]);
          continue;
        }
        c.fillStyle = `rgb(${v.r | 0},${v.g | 0},${v.b | 0})`;
        c.fillRect(v.x - sz / 2, v.y - sz / 2, sz, sz);
      }

      if (hoveredList) {
        hoveredList.sort((a, b) => a[0].hov - b[0].hov);
        for (const [v, sz] of hoveredList) {
          c.fillStyle = CORE_COLORS.ink;
          c.fillRect(v.x - sz / 2 - 2, v.y - sz / 2 - 2, sz + 4, sz + 4);
          c.fillStyle = `rgb(${v.r | 0},${v.g | 0},${v.b | 0})`;
          c.fillRect(v.x - sz / 2, v.y - sz / 2, sz, sz);
        }
      }
    }

    // 2. Render Particles (Pour, "2025" Title, Dissolve, Shatter)
    if (this.activeParticleCount > 0) {
      c.globalAlpha = this.particlesAlpha;
      let live = 0;
      for (const p of this.particleViews) {
        if (!p.v) continue;
        live++;
        this.stepTweens(p);
        const F = p.F;
        if (F) {
          const q = (this.nowSec - F.t0) / F.d;
          if (q >= 0) {
            if (F.fx === null || F.fy === null) {
              F.fx = p.x;
              F.fy = p.y;
              const dx = F.tx - F.fx;
              const dy = F.ty - F.fy;
              F.cx = (F.fx + F.tx) / 2 - dy * F.arc;
              F.cy = (F.fy + F.ty) / 2 + dx * F.arc;
            }
            if (q >= 1) {
              p.x = F.tx;
              p.y = F.ty;
              p.F = null;
              if (F.cb) F.cb(p);
            } else {
              const u = F.e(q);
              const inv = 1 - u;
              p.x = inv * inv * F.fx + 2 * inv * u * F.cx + u * u * F.tx;
              p.y = inv * inv * F.fy + 2 * inv * u * F.cy + u * u * F.ty;
            }
          }
        }
        if (!p.v) continue;
        let scale = p.sc;
        if (p.pt !== null) {
          const q = (this.nowSec - p.pt) / 0.36;
          if (q >= 1) p.pt = null;
          else if (q > 0) scale *= 1 + p.pa * Math.sin(Math.PI * q) * (1 - q);
        }
        const pw = p.w * scale;
        const ph = p.h * scale;
        c.fillStyle = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`;
        c.fillRect(p.x - pw / 2, p.y - ph / 2, pw, ph);
      }
      c.globalAlpha = 1;
      this.activeParticleCount = live;
    }

    // 3. Render Payday Heartbeat & Wave Rings
    if (this.rings.length > 0) {
      this.rings = this.rings.filter((r) => {
        const p = (this.nowSec - r.t0) / r.d;
        if (p >= 1) return false;
        if (p < 0) return true;
        const e = EASING.out3(p);
        const radius = r.r0 + (r.r1 - r.r0) * e;
        c.globalAlpha = 1 - p;
        c.strokeStyle = r.c;
        c.lineWidth = r.lw;
        if (r.sq) {
          c.strokeRect(r.x - radius, r.y - radius, radius * 2, radius * 2);
        } else {
          c.beginPath();
          c.arc(r.x, r.y, radius, 0, Math.PI * 2);
          c.stroke();
        }
        return true;
      });
      c.globalAlpha = 1;
    }

    // 4. Render Magnifier Lens Bracket during The Pour
    if (this.lensBracketAlpha > 0) {
      c.globalAlpha = this.lensBracketAlpha;
      c.strokeStyle = CORE_COLORS.solar;
      c.lineWidth = 1.5;
      const bx = 2 * 174.5 + 2;
      const by = 30 * 13.5 - 2;
      const bw = 172;
      const bh = 11 * 13.5 + 4;
      c.strokeRect(bx, by, bw, bh);
      c.beginPath();
      c.moveTo(bx + bw, by + bh / 2);
      c.lineTo(1180, by + bh / 2);
      c.stroke();
      c.globalAlpha = 1;
    }

    // 5. Render Marching-Ants Range Selection Outline
    if (this.selection.on && this.selection.a >= 0) {
      this.drawSelectionOutline();
    }
  }

  private drawSelectionOutline(): void {
    const c = this.ctx;
    const a = Math.min(this.selection.a, this.selection.b);
    const b = Math.max(this.selection.a, this.selection.b);
    const selectedSet = new Set<number>();
    for (let i = a; i <= b; i++) selectedSet.add(i);

    const G = this.currentGrid;
    const h = G.p / 2;
    c.beginPath();
    for (let i = a; i <= b; i++) {
      const v = this.dayViews[i]!;
      const x = v.x;
      const y = v.y;
      const hasNeighbor = (dc: number, dr: number): boolean => {
        const col = v.col + dc;
        const row = v.row + dr;
        if (row < 0 || row > 6) return false;
        return selectedSet.has(col * 7 + row - JAN_1_2025_WEEKDAY);
      };
      if (!hasNeighbor(0, -1)) {
        c.moveTo(x - h, y - h);
        c.lineTo(x + h, y - h);
      }
      if (!hasNeighbor(0, 1)) {
        c.moveTo(x - h, y + h);
        c.lineTo(x + h, y + h);
      }
      if (!hasNeighbor(-1, 0)) {
        c.moveTo(x - h, y - h);
        c.lineTo(x - h, y + h);
      }
      if (!hasNeighbor(1, 0)) {
        c.moveTo(x + h, y - h);
        c.lineTo(x + h, y + h);
      }
    }
    c.strokeStyle = CORE_COLORS.bone;
    c.lineWidth = 2.5;
    c.setLineDash([9, 6]);
    c.lineDashOffset = -this.nowSec * 48;
    c.stroke();
    c.setLineDash([]);
  }
}
