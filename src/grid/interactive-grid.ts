import type { Category, Day, Transaction } from '../../contracts/index.js';
import { formatMoneyMinor, getCategoryDisplayLabel } from '../../contracts/index.js';

export type RGB = [number, number, number];

export interface GridGeometry {
  x: number;
  y: number;
  p: number; // pitch (cell + gap)
  c: number; // cell size
  vertical?: boolean; // true on phone 7x53 orientation
}

export const GRID_PRESETS: Record<
  'open' | 'sweep' | 'explore' | 'ask' | 'mini' | 'phone',
  GridGeometry
> = {
  open: { x: 165, y: 700, p: 30, c: 26 },
  sweep: { x: 112, y: 520, p: 32, c: 28 },
  explore: { x: 160, y: 330, p: 30, c: 26 },
  ask: { x: 112, y: 810, p: 24, c: 20 },
  mini: { x: 64, y: 880, p: 10, c: 8.4 },
  phone: { x: 24, y: 310, p: 6.4, c: 5.2 },
};

export const CATEGORY_COLORS: Record<Category, string> = {
  groceries: '#B9B744',
  'eating out': '#FF6B57',
  takeaway: '#FF8552',
  coffee: '#E3A83C',
  transport: '#A9A2E0',
  travel: '#6E8BFF',
  shopping: '#FFA8E4',
  bills: '#B9F0C6',
  subscriptions: '#7CE0C3',
  health: '#8FD6FF',
  fun: '#F4F03A',
  gifts: '#FFB8D1',
  rent: '#8E8A7F',
  fees: '#9E6B6B',
  savings: '#A3D977',
  transfers: '#555552',
  income: '#FF5A14',
};

export const DISPLAY_CATEGORIES: readonly { key: Category; label: string; color: string }[] = [
  { key: 'groceries', label: 'Groceries', color: CATEGORY_COLORS.groceries },
  { key: 'eating out', label: 'Eating out', color: CATEGORY_COLORS['eating out'] },
  { key: 'takeaway', label: 'Takeaway', color: CATEGORY_COLORS.takeaway },
  { key: 'coffee', label: 'Coffee', color: CATEGORY_COLORS.coffee },
  { key: 'transport', label: 'Transport', color: CATEGORY_COLORS.transport },
  { key: 'travel', label: 'Travel', color: CATEGORY_COLORS.travel },
  { key: 'shopping', label: 'Shopping', color: CATEGORY_COLORS.shopping },
  { key: 'bills', label: 'Bills', color: CATEGORY_COLORS.bills },
  { key: 'health', label: 'Health', color: CATEGORY_COLORS.health },
  { key: 'fun', label: 'Fun', color: CATEGORY_COLORS.fun },
  { key: 'subscriptions', label: 'Subscriptions', color: CATEGORY_COLORS.subscriptions },
];

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function makeSpring(overshoot: number): (t: number) => number {
  const L = Math.log(overshoot);
  const z = -L / Math.sqrt(Math.PI * Math.PI + L * L);
  const phi = Math.atan(z / Math.sqrt(1 - z * z));
  const wd = 1.5 * Math.PI + phi;
  const w0 = wd / Math.sqrt(1 - z * z);
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - (Math.exp(-z * w0 * t) * Math.cos(wd * t - phi)) / Math.cos(phi);
  };
}

export const EASE = {
  out3: (t: number) => 1 - Math.pow(1 - t, 3),
  in2: (t: number) => t * t,
  inOut3: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  glide: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  lin: (t: number) => t,
  spring: makeSpring(0.15),
  soft: makeSpring(0.05),
};

interface ActiveTween {
  f: number | null;
  t: number;
  t0: number;
  d: number;
  e: (q: number) => number;
}

interface FlightArc {
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
  cb?: (p: ParticleVisual) => void;
}

export interface DayVisual {
  day: Day;
  index: number;
  month: number; // 0..11
  dom: number; // 1..31
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
  A: Record<string, ActiveTween> | null;
  landedMinor: number;
  nland: number;
  stepBucket: number; // 0..4
  txns: Transaction[];
}

export interface ParticleVisual {
  txn: Transaction;
  dayIndex: number;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  sc: number;
  r: number;
  g: number;
  b: number;
  v: number; // 0 = hidden, 1 = visible
  A: Record<string, ActiveTween> | null;
  F: FlightArc | null;
  pt: number | null;
  pa: number;
}

export interface RingVisual {
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

export const RGB_PALETTE = {
  ink: hexToRgb('#111111'),
  bone: hexToRgb('#F3F0E6'),
  c1: hexToRgb('#F4F03A'),
  c2: hexToRgb('#FFA8E4'),
  c3: hexToRgb('#B9B744'),
  c4: hexToRgb('#FF5A14'),
  lav: hexToRgb('#A9A2E0'),
  empty: hexToRgb('#232322'),
  dim: hexToRgb('#1B1B1A'),
};

export const SPEND_STEPS_RGB: readonly RGB[] = [
  hexToRgb('#2C2C2A'),
  mixRgb(hexToRgb('#262626'), RGB_PALETTE.c1, 0.3),
  mixRgb(hexToRgb('#262626'), RGB_PALETTE.c1, 0.62),
  RGB_PALETTE.c1,
  RGB_PALETTE.bone,
];

const MONTH_NAMES = [
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
];
const MONTH_UPPER = MONTH_NAMES.map((m) => m.toUpperCase());
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function formatDayLabel(day: Day): string {
  const [, mStr, dStr] = day.date.split('-');
  const m = Math.max(0, Math.min(11, parseInt(mStr ?? '1', 10) - 1));
  const dom = parseInt(dStr ?? '1', 10);
  const dowName = DAY_NAMES[day.weekday] ?? 'Mon';
  return `${dowName} ${dom} ${MONTH_NAMES[m]}`;
}

export class InteractiveGrid {
  public readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  public readonly days: DayVisual[] = [];
  public readonly particles: ParticleVisual[] = [];
  public rings: RingVisual[] = [];
  public currentGeometry: GridGeometry = GRID_PRESETS.open;
  public clockSec = 0;
  public backingScale = 1;
  public reducedMotion = false;
  public daysVisible = true;
  public particleAlpha = 1;
  public lensBracketAlpha = 0;
  public selection: { start: number; end: number; active: boolean } = {
    start: -1,
    end: -1,
    active: false,
  };

  public categoryLabels: Record<string, string> = {};
  public isB2B = false;
  public milestoneLabel = 'Payday';
  public currencySymbol = 'US$';
  public rawDays: readonly Day[] = [];
  public transactions: readonly Transaction[] = [];
  public dayMap = new Map<string, Day>();
  public txnsByDate = new Map<string, Transaction[]>();
  public monthStartCols: number[] = [];

  public p97Minor = 10000;
  public p95Minor = 8000;
  public maxDayMinor = 50000;
  public topDayIndex = 0;
  public cumulativeSpendMinor: number[] = [0];

  private baseColors: RGB[] = [];
  private activeParticleCount = 0;
  private customOverlayDrawer: ((ctx: CanvasRenderingContext2D, nowSec: number) => void) | null =
    null;

  public get squares(): DayVisual[] {
    return this.days;
  }

  constructor(
    canvas: HTMLCanvasElement,
    daysData: readonly Day[],
    transactions: readonly Transaction[],
    options?: {
      categoryLabels?: Record<string, string>;
      isB2B?: boolean;
      milestoneLabel?: string;
      currencySymbol?: string;
    }
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get 2D context for InteractiveGrid');
    }
    this.ctx = context;
    if (options?.categoryLabels) {
      this.categoryLabels = { ...options.categoryLabels };
    }
    if (options?.isB2B !== undefined) {
      this.isB2B = options.isB2B;
    }
    if (options?.milestoneLabel) {
      this.milestoneLabel = options.milestoneLabel;
    }
    if (options?.currencySymbol) {
      this.currencySymbol = options.currencySymbol;
    }
    this.initData(daysData, transactions);
  }

  public setDataset(
    days: readonly Day[],
    transactions: readonly Transaction[],
    options?: {
      categoryLabels?: Record<string, string>;
      isB2B?: boolean;
      milestoneLabel?: string;
      currencySymbol?: string;
    }
  ): void {
    this.categoryLabels = options?.categoryLabels ? { ...options.categoryLabels } : {};
    this.isB2B = Boolean(options?.isB2B);
    this.milestoneLabel = options?.milestoneLabel ?? 'Payday';
    this.currencySymbol = options?.currencySymbol ?? 'US$';
    this.initData(days, transactions);
    this.stepAndDraw(0);
  }

  private initData(daysData: readonly Day[], transactions: readonly Transaction[]): void {
    this.rawDays = daysData;
    this.transactions = transactions;
    this.days.length = 0;
    this.particles.length = 0;
    this.rings = [];
    this.baseColors = [];
    this.topDayIndex = 0;
    this.activeParticleCount = 0;
    this.particleAlpha = 1;
    this.lensBracketAlpha = 0;
    this.selection = { start: -1, end: -1, active: false };
    this.dayMap.clear();
    this.txnsByDate.clear();
    this.monthStartCols = [];

    for (const d of daysData) {
      this.dayMap.set(d.date, d);
    }

    const txnById = new Map<string, Transaction>();
    for (const t of transactions) {
      txnById.set(t.id, t);
      const list = this.txnsByDate.get(t.date);
      if (list) {
        list.push(t);
      } else {
        this.txnsByDate.set(t.date, [t]);
      }
    }

    const spends = daysData
      .map((d) => d.discretionary_out_minor)
      .slice()
      .sort((a, b) => a - b);
    this.p97Minor = Math.max(100, spends[Math.floor(spends.length * 0.97)] ?? 10000);
    this.p95Minor = Math.max(100, spends[Math.floor(spends.length * 0.95)] ?? 8000);
    this.maxDayMinor = Math.max(100, spends[spends.length - 1] ?? 50000);

    const dateToIndex = new Map<string, number>();
    this.cumulativeSpendMinor = [0];
    const firstWeekday = daysData[0]?.weekday ?? 2;
    const seenMonthCols = new Map<number, number>();

    daysData.forEach((d, idx) => {
      dateToIndex.set(d.date, idx);
      const [, mStr, dStr] = d.date.split('-');
      const month = Math.max(0, Math.min(11, parseInt(mStr ?? '1', 10) - 1));
      const dom = parseInt(dStr ?? '1', 10);
      if (!seenMonthCols.has(month)) {
        const col = d.week_index ?? Math.floor((idx + firstWeekday) / 7);
        seenMonthCols.set(month, col);
      }

      const rawDayTxns =
        d.txn_ids.length > 0
          ? d.txn_ids.map((id) => txnById.get(id))
          : (this.txnsByDate.get(d.date) ?? []);
      const dayTxns = rawDayTxns.filter(
        (t): t is Transaction => t !== undefined && !t.is_transfer && t.direction === 'out'
      );

      const stepBucket = this.stepOfMinor(d.discretionary_out_minor);
      const baseColor = d.is_payday
        ? RGB_PALETTE.c4
        : (SPEND_STEPS_RGB[stepBucket] ?? SPEND_STEPS_RGB[0]!);
      this.baseColors.push(baseColor);

      if (d.discretionary_out_minor > (daysData[this.topDayIndex]?.discretionary_out_minor ?? -1)) {
        this.topDayIndex = idx;
      }

      const prevCum = this.cumulativeSpendMinor[this.cumulativeSpendMinor.length - 1] ?? 0;
      this.cumulativeSpendMinor.push(prevCum + d.discretionary_out_minor);

      const [gx, gy] = this.getDayCoords(idx, d, this.currentGeometry);
      this.days.push({
        day: d,
        index: idx,
        month,
        dom,
        x: gx,
        y: gy,
        s: this.currentGeometry.c,
        k: 1,
        r: baseColor[0],
        g: baseColor[1],
        b: baseColor[2],
        hov: 1,
        hovT: 1,
        pt: null,
        pa: 0,
        rt: null,
        ra: 0,
        A: null,
        landedMinor: d.discretionary_out_minor,
        nland: dayTxns.length,
        stepBucket,
        txns: dayTxns,
      });
    });

    for (let m = 0; m < 12; m++) {
      this.monthStartCols.push(seenMonthCols.get(m) ?? Math.floor((m * 30.4 + firstWeekday) / 7));
    }

    // Build particles for outgoing non-transfer transactions (up to 1000)
    const particleSource = transactions.filter((t) => !t.is_transfer);
    particleSource.forEach((t, idx) => {
      const dayIdx = dateToIndex.get(t.date) ?? 0;
      const catRgb = hexToRgb(CATEGORY_COLORS[t.category] ?? '#F3F0E6');
      this.particles.push({
        txn: t,
        dayIndex: dayIdx,
        index: idx,
        x: 0,
        y: 0,
        w: 8,
        h: 8,
        sc: 1,
        r: catRgb[0],
        g: catRgb[1],
        b: catRgb[2],
        v: 0,
        A: null,
        F: null,
        pt: null,
        pa: 0,
      });
    });
  }

  public stepOfMinor(spendMinor: number): number {
    const x = Math.min(1, Math.sqrt(Math.max(0, spendMinor) / this.p97Minor));
    if (x < 0.14) return 0;
    if (x < 0.36) return 1;
    if (x < 0.6) return 2;
    if (x < 0.82) return 3;
    return 4;
  }

  public getBaseColor(dayIndex: number): RGB {
    return this.baseColors[dayIndex] ?? SPEND_STEPS_RGB[0]!;
  }

  public getDayCoords(
    dayIndex: number,
    day: Day = this.days[dayIndex]!.day,
    geom: GridGeometry = this.currentGeometry
  ): [number, number] {
    if (geom.vertical) {
      return [
        geom.x + day.weekday * geom.p + geom.c / 2,
        geom.y + day.week_index * geom.p + geom.c / 2,
      ];
    }
    return [
      geom.x + day.week_index * geom.p + geom.c / 2,
      geom.y + day.weekday * geom.p + geom.c / 2,
    ];
  }

  public setCustomOverlayDrawer(
    drawer: ((ctx: CanvasRenderingContext2D, nowSec: number) => void) | null
  ): void {
    this.customOverlayDrawer = drawer;
  }

  public tweenProp(
    target: { A: Record<string, ActiveTween> | null },
    key: string,
    to: number,
    duration: number,
    delay = 0,
    ease: (q: number) => number = EASE.out3
  ): void {
    if (!target.A) target.A = {};
    target.A[key] = {
      f: null,
      t: to,
      t0: this.clockSec + delay,
      d: Math.max(duration, 0.001),
      e: ease,
    };
  }

  public tweenColor(
    target: { A: Record<string, ActiveTween> | null; r: number; g: number; b: number },
    rgb: RGB,
    duration: number,
    delay = 0,
    ease: (q: number) => number = EASE.out3
  ): void {
    if (this.reducedMotion || duration <= 0) {
      this.setColorImmediate(target, rgb);
      return;
    }
    this.tweenProp(target, 'r', rgb[0], duration, delay, ease);
    this.tweenProp(target, 'g', rgb[1], duration, delay, ease);
    this.tweenProp(target, 'b', rgb[2], duration, delay, ease);
  }

  public setColorImmediate(
    target: { A: Record<string, ActiveTween> | null; r: number; g: number; b: number },
    rgb: RGB
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

  public popVisual(target: { pt: number | null; pa: number }, amplitude: number, delay = 0): void {
    if (this.reducedMotion) return;
    target.pt = this.clockSec + delay;
    target.pa = amplitude;
  }

  public flyParticle(
    p: ParticleVisual,
    tx: number,
    ty: number,
    duration: number,
    delay: number,
    arc: number,
    ease: (q: number) => number = EASE.inOut3,
    cb?: (p: ParticleVisual) => void
  ): void {
    this.activeParticleCount = Math.max(1, this.activeParticleCount);
    p.F = {
      fx: null,
      fy: null,
      cx: 0,
      cy: 0,
      tx,
      ty,
      arc,
      t0: this.clockSec + delay,
      d: Math.max(0.001, duration),
      e: ease,
      cb,
    };
  }

  public addRing(
    x: number,
    y: number,
    opts: {
      delay?: number;
      d?: number;
      r0?: number;
      r1?: number;
      c?: string;
      lw?: number;
      sq?: boolean;
    } = {}
  ): void {
    if (this.reducedMotion) return;
    this.rings.push({
      x,
      y,
      t0: this.clockSec + (opts.delay ?? 0),
      d: opts.d ?? 0.6,
      r0: opts.r0 ?? 14,
      r1: opts.r1 ?? 90,
      c: opts.c ?? '#FF5A14',
      lw: opts.lw ?? 2,
      sq: opts.sq !== false,
    });
  }

  public setGridGeometry(
    geom: GridGeometry,
    opts: { instant?: boolean; dur?: number; st?: number; delay?: number } = {}
  ): void {
    this.currentGeometry = geom;
    const dur = opts.dur ?? 0.5;
    const st = opts.st ?? 0.003;
    this.days.forEach((v, i) => {
      const [x, y] = this.getDayCoords(i, v.day, geom);
      if (opts.instant || this.reducedMotion) {
        v.x = x;
        v.y = y;
        v.s = geom.c;
        if (v.A) {
          delete v.A.x;
          delete v.A.y;
          delete v.A.s;
        }
      } else {
        const dl = (opts.delay ?? 0) + v.day.week_index * st;
        this.tweenProp(v, 'x', x, dur, dl, EASE.glide);
        this.tweenProp(v, 'y', y, dur, dl, EASE.glide);
        this.tweenProp(v, 's', geom.c, dur, dl, EASE.glide);
      }
    });
  }

  public colorAllDays(
    colorFn: (dayIndex: number, dayVisual: DayVisual) => RGB | null,
    opts: { instant?: boolean; dur?: number; delay?: (dayIndex: number) => number } = {}
  ): void {
    this.days.forEach((v, i) => {
      const c = colorFn(i, v);
      if (!c) return;
      if (opts.instant || this.reducedMotion) {
        this.setColorImmediate(v, c);
      } else {
        this.tweenColor(v, c, opts.dur ?? 0.24, opts.delay ? opts.delay(i) : 0);
      }
    });
  }

  public resetToBaseColors(instant = false): void {
    this.colorAllDays((i) => this.getBaseColor(i), { instant, dur: 0.24 });
    this.days.forEach((v) => {
      if (instant || this.reducedMotion) {
        v.k = 1;
        if (v.A) delete v.A.k;
      } else if (v.k < 1) {
        this.tweenProp(v, 'k', 1, 0.25, 0, EASE.out3);
      }
    });
  }

  public hideAllParticles(): void {
    this.particles.forEach((p) => {
      p.v = 0;
      p.F = null;
      p.A = null;
    });
    this.activeParticleCount = 0;
    this.particleAlpha = 1;
  }

  public activateParticles(): void {
    this.activeParticleCount = Math.max(1, this.particles.length);
  }

  public hitTestDay(stageX: number, stageY: number, geom = this.currentGeometry): number {
    if (geom.vertical) {
      const r = Math.floor((stageX - geom.x) / geom.p);
      const c = Math.floor((stageY - geom.y) / geom.p);
      if (c < 0 || c > 52 || r < 0 || r > 6) return -1;
      const firstWeekday = this.days[0]?.day.weekday ?? 2;
      const idx = c * 7 + r - firstWeekday;
      return idx >= 0 && idx < this.days.length ? idx : -1;
    }
    const c = Math.floor((stageX - geom.x) / geom.p);
    const r = Math.floor((stageY - geom.y) / geom.p);
    if (c < 0 || c > 52 || r < 0 || r > 6) return -1;
    const firstWeekday = this.days[0]?.day.weekday ?? 2;
    const idx = c * 7 + r - firstWeekday;
    return idx >= 0 && idx < this.days.length ? idx : -1;
  }

  public applyHoverMagnification(stageX: number, stageY: number): number {
    const geom = this.currentGeometry;
    const hitIdx = this.hitTestDay(stageX, stageY, geom);
    const radius = geom.p * 2.3;
    for (const v of this.days) {
      const dx = v.x - stageX;
      const dy = v.y - stageY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      v.hovT = dist < radius ? 1 + 0.75 * Math.pow(1 - dist / radius, 2) : 1;
    }
    if (hitIdx >= 0 && !this.reducedMotion) {
      const hovDay = this.days[hitIdx]!;
      for (const v of this.days) {
        const dc = Math.abs(v.day.week_index - hovDay.day.week_index);
        const dr = Math.abs(v.day.weekday - hovDay.day.weekday);
        const dd = Math.sqrt(dc * dc + dr * dr);
        if (dd > 0 && dd < 6 && v.rt === null) {
          v.rt = this.clockSec + dd * 0.035;
          v.ra = 0.18 * (1 - dd / 6);
        }
      }
    }
    return hitIdx;
  }

  public clearHover(): void {
    for (const v of this.days) {
      v.hovT = 1;
    }
  }

  public applyCategoryLensWave(
    category: Category | '',
    originX: number,
    originY: number,
    maxDayCutoff = Math.max(0, this.days.length - 1)
  ): { totalMinor: number; count: number; matchingTxnIds: string[] } {
    const waveSpeed = this.reducedMotion ? 0 : 0.0007;
    let totalMinor = 0;
    let count = 0;
    const matchingTxnIds: string[] = [];

    const catTxns = this.days.flatMap((d) =>
      category ? d.txns.filter((t) => t.category === category) : d.txns
    );
    const avgCatTxnMinor =
      catTxns.length > 0
        ? catTxns.reduce((acc, t) => acc + t.amount_minor, 0) / catTxns.length
        : 2500;
    const catRgb = category ? hexToRgb(CATEGORY_COLORS[category] ?? '#F4F03A') : RGB_PALETTE.c1;

    this.days.forEach((v, i) => {
      const dist = Math.hypot(v.x - originX, v.y - originY);
      const delay = dist * waveSpeed;
      if (i > maxDayCutoff) {
        this.tweenColor(v, RGB_PALETTE.empty, 0.2, delay);
        return;
      }
      if (!category) {
        for (const t of v.txns) {
          totalMinor += t.amount_minor;
          count++;
          matchingTxnIds.push(t.id);
        }
        this.tweenColor(v, this.getBaseColor(i), 0.24, delay);
      } else {
        const matching = v.txns.filter((t) => t.category === category);
        const dayCatMinor = matching.reduce((acc, t) => acc + t.amount_minor, 0);
        if (dayCatMinor > 0) {
          totalMinor += dayCatMinor;
          count += matching.length;
          for (const t of matching) matchingTxnIds.push(t.id);
          const q = Math.min(1, Math.sqrt(dayCatMinor / (avgCatTxnMinor * 2.2)));
          const col = mixRgb(hexToRgb('#2A2A28'), catRgb, 0.35 + 0.65 * q);
          this.tweenColor(v, col, 0.24, delay);
        } else {
          this.tweenColor(v, RGB_PALETTE.dim, 0.24, delay);
        }
      }
      if (!this.reducedMotion) {
        v.rt = this.clockSec + delay;
        v.ra = 0.28;
      }
    });

    if (!this.reducedMotion) {
      this.addRing(originX, originY, {
        r0: 10,
        r1: 1500,
        d: 1500 * waveSpeed * 1.05,
        c: category ? (CATEGORY_COLORS[category] ?? '#F3F0E6') : '#F3F0E6',
        lw: 2,
        sq: false,
      });
    }

    return { totalMinor, count, matchingTxnIds };
  }

  public applyHighlightDatesWave(
    matchingDates: ReadonlySet<string>,
    highlightRgb: RGB = RGB_PALETTE.c1,
    originX = 960,
    originY = 240
  ): void {
    const waveSpeed = this.reducedMotion ? 0 : 0.00055;
    this.days.forEach((v) => {
      const dist = Math.hypot(v.x - originX, v.y - originY);
      const dl = dist * waveSpeed;
      if (matchingDates.has(v.day.date)) {
        this.tweenColor(v, highlightRgb, 0.24, dl);
        if (!this.reducedMotion) {
          v.pt = this.clockSec + dl;
          v.pa = 0.48;
        }
      } else {
        this.tweenColor(v, RGB_PALETTE.dim, 0.3, dl);
      }
    });
  }

  public getActiveDisplayCategories(
    limit = 8
  ): Array<{ key: Category; label: string; color: string }> {
    const outTxns = this.transactions.filter((t) => t.direction === 'out' && !t.is_transfer);
    if (outTxns.length > 0) {
      const totals = new Map<Category, number>();
      for (const t of outTxns) {
        totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount_minor);
      }
      const active = Array.from(totals.entries())
        .filter(([, amt]) => amt > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([cat]) => {
          const defaultLabel = DISPLAY_CATEGORIES.find((d) => d.key === cat)?.label ?? cat;
          const resolved = getCategoryDisplayLabel(cat, this.categoryLabels, this.isB2B);
          const label = resolved === cat ? defaultLabel : resolved;
          return {
            key: cat,
            label,
            color: CATEGORY_COLORS[cat] ?? '#F4F03A',
          };
        });
      if (active.length > 0) {
        return active;
      }
    }
    return DISPLAY_CATEGORIES.slice(0, limit).map((dc) => {
      const resolved = getCategoryDisplayLabel(dc.key, this.categoryLabels, this.isB2B);
      return {
        key: dc.key,
        label: resolved === dc.key ? dc.label : resolved,
        color: dc.color,
      };
    });
  }

  public renderAnnotationsHtml(
    geom: GridGeometry = this.currentGeometry,
    opts: {
      dows?: boolean;
      ribbon?: boolean;
      legend?: boolean;
      note?: string;
    } = {}
  ): string {
    if (geom.vertical) {
      return '';
    }
    const W = 53 * geom.p;
    const H = 6 * geom.p + geom.c;
    const firstWeekday = this.days[0]?.day.weekday ?? 2;
    const totalDays = Math.max(1, this.days.length);
    let html = '';

    // Month labels at top of grid computed dynamically from this.days
    const seenMonths = new Set<number>();
    this.days.forEach((v, i) => {
      if (!seenMonths.has(v.month)) {
        seenMonths.add(v.month);
        const col = v.day.week_index ?? Math.floor((i + firstWeekday) / 7);
        const x = geom.x + col * geom.p;
        html += `<div class="lab dt" style="position:absolute;left:${x}px;top:${geom.y - 25}px;font-size:${geom.p < 26 ? 11 : 12}px">${MONTH_UPPER[v.month]}</div>`;
      }
    });

    if (opts.dows !== false) {
      'MTWTFSS'.split('').forEach((ch, r) => {
        html += `<div class="lab dt" style="position:absolute;left:${geom.x - 24}px;top:${geom.y + r * geom.p + geom.c / 2 - 9}px;font-size:11px;color:#C9C5BA">${ch}</div>`;
      });
    }

    if (opts.ribbon) {
      let rects = '';
      this.days.forEach((v, i) => {
        const x = (((i + 0.5) / totalDays) * W).toFixed(1);
        const isMonthStart = v.dom === 1;
        const isPay = v.day.is_payday;
        const w = isPay ? 2 : 1;
        const h = isPay ? 22 : isMonthStart ? 14 : 6;
        const fill = isPay ? '#FF5A14' : '#F3F0E6';
        const op = isPay || isMonthStart ? '' : 'opacity="0.55"';
        rects += `<rect x="${x}" y="0" width="${w}" height="${h}" fill="${fill}" ${op}/>`;
      });
      html += `<svg class="dt" style="position:absolute;left:${geom.x}px;top:${geom.y + H + 16}px" width="${W}" height="24">${rects}</svg>`;
    }

    if (opts.legend) {
      const y = geom.y + H + (opts.ribbon ? 56 : 22);
      const stepSwatches = SPEND_STEPS_RGB.map(
        (c) =>
          `<i style="display:inline-block;width:13px;height:13px;background:rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})"></i>`
      ).join('');
      const milestoneDisplay = (this.milestoneLabel || 'Payday').toUpperCase();
      const activeCats = this.getActiveDisplayCategories(8);
      const catLegendItems = activeCats
        .map(
          (c) =>
            `<span style="display:inline-flex;gap:4px;align-items:center"><i style="display:inline-block;width:9px;height:9px;background:${c.color}"></i>${c.label}</span>`
        )
        .join('');
      html += `<div class="lab dt" style="position:absolute;left:${geom.x}px;top:${y}px;font-size:12px;display:flex;gap:18px;align-items:center;white-space:nowrap">
        <span style="display:flex;gap:4px;align-items:center">QUIET&nbsp;${stepSwatches}&nbsp;LOUD</span>
        <span data-milestone-label="${this.milestoneLabel}" style="display:flex;gap:7px;align-items:center"><i style="display:inline-block;width:13px;height:13px;background:#FF5A14"></i>${milestoneDisplay}</span>
        <span>1 SQUARE = 1 DAY · MONDAY ON TOP${opts.note ? ' · ' + opts.note.toUpperCase() : ''}</span>
      </div>
      <div class="lab dt" data-testid="grid-category-legend" style="position:absolute;left:${geom.x}px;top:${y + 22}px;font-size:10px;display:flex;gap:14px;align-items:center;white-space:nowrap;opacity:0.82">
        ${catLegendItems}
      </div>`;
    }

    return html;
  }

  public renderTopDayCalloutHtml(geom: GridGeometry = this.currentGeometry): string {
    const topV = this.days[this.topDayIndex];
    if (!topV) return '';
    const [x, y] = this.getDayCoords(this.topDayIndex, topV.day, geom);
    const formatted = formatMoneyMinor(topV.day.discretionary_out_minor, {
      showCents: false,
      prefix: '',
    });
    const labelPrefix = this.isB2B ? 'Peak day' : 'Loudest day';
    const alignRight = x < 420;
    const calloutPosStyle = alignRight
      ? `left:${x + geom.c + 12}px;top:${geom.y - 92}px;transform:none;`
      : `left:${x - 8}px;top:${geom.y - 92}px;transform:translateX(-100%);`;
    return `<div style="position:absolute;left:${x}px;top:${geom.y - 70}px;width:1px;height:${Math.max(12, y - geom.y + 70 - 14)}px;background:var(--bone)"></div>
      <div class="lab" style="position:absolute;${calloutPosStyle}font-size:12px;white-space:nowrap">${labelPrefix} · ${formatDayLabel(topV.day)} · ${this.currencySymbol}${formatted}</div>`;
  }

  private stepTweenObject<T extends { A: Record<string, ActiveTween> | null }>(obj: T): void {
    const A = obj.A;
    if (!A) return;
    let any = false;
    for (const k of Object.keys(A)) {
      const a = A[k]!;
      const propKey = k as keyof T;
      const q = (this.clockSec - a.t0) / a.d;
      if (q < 0) {
        any = true;
        continue;
      }
      if (a.f === null) {
        a.f = Number(obj[propKey] ?? 0);
      }
      if (q >= 1) {
        obj[propKey] = a.t as T[keyof T];
        delete A[k];
      } else {
        obj[propKey] = (a.f + (a.t - a.f) * a.e(q)) as T[keyof T];
        any = true;
      }
    }
    if (!any) obj.A = null;
  }

  private computeDayDrawSize(v: DayVisual): number {
    let f = v.s * v.k * v.hov;
    if (v.pt !== null) {
      const p = (this.clockSec - v.pt) / 0.36;
      if (p >= 1) v.pt = null;
      else if (p > 0) f *= 1 + v.pa * Math.sin(Math.PI * p) * (1 - p);
    }
    if (v.rt !== null) {
      const p = (this.clockSec - v.rt) / 0.32;
      if (p >= 1) v.rt = null;
      else if (p > 0) f *= 1 + v.ra * Math.sin(Math.PI * p);
    }
    return f;
  }

  public stepAndDraw(dtSec: number): void {
    const clampedDt = Math.max(0, Math.min(0.5, dtSec));
    this.clockSec += clampedDt;
    const ctx = this.ctx;
    const bs = this.backingScale;
    ctx.setTransform(bs, 0, 0, bs, 0, 0);
    ctx.clearRect(0, 0, 1920, 1080);

    const hk = Math.min(1, clampedDt * 16 || 0.25);
    let highlighted: Array<[DayVisual, number]> | null = null;

    if (this.daysVisible) {
      for (const v of this.days) {
        this.stepTweenObject(v);
        if (v.hov !== v.hovT) {
          v.hov += (v.hovT - v.hov) * hk;
          if (Math.abs(v.hov - v.hovT) < 0.002) v.hov = v.hovT;
        }
        const z = this.computeDayDrawSize(v);
        if (z < 0.4) continue;
        if (v.hov > 1.03) {
          if (!highlighted) highlighted = [];
          highlighted.push([v, z]);
          continue;
        }
        ctx.fillStyle = `rgb(${v.r | 0},${v.g | 0},${v.b | 0})`;
        ctx.fillRect(v.x - z / 2, v.y - z / 2, z, z);
      }

      if (highlighted) {
        highlighted.sort((a, b) => a[0].hov - b[0].hov);
        for (const [v, z] of highlighted) {
          ctx.fillStyle = '#111111';
          ctx.fillRect(v.x - z / 2 - 2, v.y - z / 2 - 2, z + 4, z + 4);
          ctx.fillStyle = `rgb(${v.r | 0},${v.g | 0},${v.b | 0})`;
          ctx.fillRect(v.x - z / 2, v.y - z / 2, z, z);
        }
      }
    }

    if (this.activeParticleCount > 0) {
      ctx.globalAlpha = this.particleAlpha;
      let live = 0;
      for (const p of this.particles) {
        if (!p.v) continue;
        live++;
        this.stepTweenObject(p);
        const F = p.F;
        if (F) {
          const q = (this.clockSec - F.t0) / F.d;
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
              const a = 1 - u;
              p.x = a * a * F.fx + 2 * a * u * F.cx + u * u * F.tx;
              p.y = a * a * F.fy + 2 * a * u * F.cy + u * u * F.ty;
            }
          }
        }
        if (!p.v) continue;
        let f = p.sc;
        if (p.pt !== null) {
          const q = (this.clockSec - p.pt) / 0.36;
          if (q >= 1) p.pt = null;
          else if (q > 0) f *= 1 + p.pa * Math.sin(Math.PI * q) * (1 - q);
        }
        const w = p.w * f;
        const h = p.h * f;
        ctx.fillStyle = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`;
        ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
      this.activeParticleCount = live;
    }

    if (this.rings.length > 0) {
      this.rings = this.rings.filter((r) => {
        const p = (this.clockSec - r.t0) / r.d;
        if (p >= 1) return false;
        if (p < 0) return true;
        const e = EASE.out3(p);
        const rr = r.r0 + (r.r1 - r.r0) * e;
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = r.c;
        ctx.lineWidth = r.lw;
        if (r.sq) {
          ctx.strokeRect(r.x - rr, r.y - rr, rr * 2, rr * 2);
        } else {
          ctx.beginPath();
          ctx.arc(r.x, r.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        return true;
      });
      ctx.globalAlpha = 1;
    }

    if (this.lensBracketAlpha > 0) {
      this.drawLensBracket();
    }

    if (this.selection.active && this.selection.start >= 0 && this.selection.end >= 0) {
      this.drawSelectionOutline();
    }

    if (this.customOverlayDrawer) {
      this.customOverlayDrawer(ctx, this.clockSec);
    }
  }

  private drawLensBracket(): void {
    const ctx = this.ctx;
    ctx.globalAlpha = this.lensBracketAlpha;
    ctx.strokeStyle = '#F4F03A';
    ctx.lineWidth = 1.5;
    const x = 2 * 174.5 + 2;
    const y = 30 * 13.5 - 2;
    const w = 172;
    const h = 11 * 13.5 + 4;
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x + w, y + h / 2);
    ctx.lineTo(1180, y + h / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawSelectionOutline(): void {
    const ctx = this.ctx;
    const a = Math.min(this.selection.start, this.selection.end);
    const b = Math.max(this.selection.start, this.selection.end);
    const set = new Set<number>();
    for (let i = a; i <= b; i++) set.add(i);

    const G = this.currentGeometry;
    const h = G.p / 2;
    const firstWeekday = this.days[0]?.day.weekday ?? 2;

    ctx.beginPath();
    for (let i = a; i <= b; i++) {
      const v = this.days[i];
      if (!v) continue;
      const x = v.x;
      const y = v.y;
      const nb = (dc: number, dr: number): boolean => {
        const col = v.day.week_index + dc;
        const row = v.day.weekday + dr;
        if (row < 0 || row > 6) return false;
        return set.has(col * 7 + row - firstWeekday);
      };
      if (!nb(0, -1)) {
        ctx.moveTo(x - h, y - h);
        ctx.lineTo(x + h, y - h);
      }
      if (!nb(0, 1)) {
        ctx.moveTo(x - h, y + h);
        ctx.lineTo(x + h, y + h);
      }
      if (!nb(-1, 0)) {
        ctx.moveTo(x - h, y - h);
        ctx.lineTo(x - h, y + h);
      }
      if (!nb(1, 0)) {
        ctx.moveTo(x + h, y - h);
        ctx.lineTo(x + h, y + h);
      }
    }
    ctx.strokeStyle = '#F3F0E6';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 6]);
    ctx.lineDashOffset = -this.clockSec * 48;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
