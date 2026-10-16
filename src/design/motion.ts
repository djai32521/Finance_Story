/**
 * Motion System & Choreography Engine (`src/design/motion.ts`)
 *
 * Single source of truth for all durations, damped springs, stagger steps,
 * easing curves, 120 BPM beat alignment helpers, calm staged chapter transitions,
 * and deterministic audio-sync motion event logging.
 */

import gsap from 'gsap';
import type { MotionEvent } from '../../contracts/story.js';

export interface DampedSpringFn {
  (t: number): number;
  readonly overshoot: number;
  readonly zeta: number;
  readonly phi: number;
  readonly wd: number;
  readonly w0: number;
  readonly peakTime: number;
}

/**
 * Analytical under-damped spring curve that starts at f(0) = 0, reaches a peak
 * of exactly `1 + overshoot` at `peakTime = Math.PI / wd`, and settles to f(1) = 1.
 */
export function makeDampedSpring(overshoot: number): DampedSpringFn {
  const safeOs = Math.max(0.0001, Math.min(0.95, overshoot));
  const L = Math.log(safeOs);
  const zeta = -L / Math.sqrt(Math.PI * Math.PI + L * L);
  const root = Math.sqrt(1 - zeta * zeta);
  const phi = Math.atan(zeta / root);
  const wd = 1.5 * Math.PI + phi;
  const w0 = wd / root;
  const cosPhi = Math.cos(phi);
  const peakTime = Math.PI / wd;

  const fn = ((t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - (Math.exp(-zeta * w0 * t) * Math.cos(wd * t - phi)) / cosPhi;
  }) as DampedSpringFn;

  Object.defineProperties(fn, {
    overshoot: { value: safeOs, enumerable: true },
    zeta: { value: zeta, enumerable: true },
    phi: { value: phi, enumerable: true },
    wd: { value: wd, enumerable: true },
    w0: { value: w0, enumerable: true },
    peakTime: { value: peakTime, enumerable: true },
  });

  return fn;
}

/**
 * Canonical Motion Tokens (120 BPM beat grid = 500 ms per beat).
 */
export const MOTION_TOKENS = {
  bpm: 120,
  beatSec: 0.5,
  beat: 0.5,
  dur: {
    xs: 0.12,
    s: 0.2,
    m: 0.4,
    l: 0.5,
    flight: 0.56,
  },
  tr: {
    textOut: 0.18,
    blockOut: 0.26,
    gap: 0.1,
    blockIn: 0.5,
    blockStagger: 0.07,
    textIn: 0.4,
    textStagger: 0.05,
    detailIn: 0.3,
  },
  spring: {
    overshoot: 0.15,
    settle: 0.3,
    settleSec: 0.3,
  },
  soft: {
    overshoot: 0.05,
    dur: 0.5,
    settleSec: 0.5,
  },
  st: {
    letter: 0.022,
    col: 0.003,
    wave: 0.0007,
    particle: 0.0021,
  },
  speeds: [0.5, 1, 2] as const,
} as const;

/** Alias matching prototype shorthand */
export const T = MOTION_TOKENS;

/** 15% overshoot spring settling in 300ms (small items, letters, day pops, flip card) */
export const SPR: DampedSpringFn = makeDampedSpring(MOTION_TOKENS.spring.overshoot);

/** 5% overshoot soft spring settling in 500ms (flat block & histogram bar growth) */
export const SOFT: DampedSpringFn = makeDampedSpring(MOTION_TOKENS.soft.overshoot);

/**
 * Standard Easing Curves used across Canvas and DOM timelines.
 */
export const EASING = {
  out3: (t: number): number => 1 - Math.pow(1 - t, 3),
  in2: (t: number): number => t * t,
  inOut3: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  glide: (t: number): number => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  lin: (t: number): number => t,
  linear: (t: number): number => t,
  spr: SPR,
  spring: SPR,
  soft: SOFT,
  softSpring: SOFT,
} as const;

export const EZ = EASING;

/**
 * 120 BPM Beat Grid Helpers
 */
export function beatAtTime(seconds: number, bpm = MOTION_TOKENS.bpm): number {
  const beatDuration = 60 / bpm;
  return Math.floor(Math.max(0, seconds) / beatDuration);
}

export function timeForBeat(beatIndex: number, bpm = MOTION_TOKENS.bpm): number {
  const beatDuration = 60 / bpm;
  return beatIndex * beatDuration;
}

/**
 * Given an exit completion timestamp in seconds, add the near-empty `gap`
 * and snap forward to the next beat on the 120 BPM grid.
 */
export function snapToNextBeat(
  exitEndSeconds: number,
  gapSeconds = MOTION_TOKENS.tr.gap,
  bpm = MOTION_TOKENS.bpm
): number {
  const beatDuration = 60 / bpm;
  return Math.ceil((exitEndSeconds + gapSeconds) / beatDuration) * beatDuration;
}

/**
 * Reduced Motion State Management
 */
let reducedMotionOverride: boolean | null = null;

export function setReducedMotionOverride(value: boolean | null): void {
  reducedMotionOverride = value;
}

export function isReducedMotion(): boolean {
  if (reducedMotionOverride !== null) {
    return reducedMotionOverride;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

/**
 * Determine the one-axis scaling property (`scaleX` or `scaleY`) from a block's
 * `data-ax` or `data-axis` attribute (`b` | `t` -> `scaleY`, `l` | `r` -> `scaleX`).
 * Rule 2: Blocks enter and exit by scaling along ONE axis only.
 */
export function getBlockAxisProp(blockEl: HTMLElement): 'scaleX' | 'scaleY' {
  const axis = blockEl.dataset.ax ?? blockEl.dataset.axis ?? 'b';
  return axis === 'l' || axis === 'r' ? 'scaleX' : 'scaleY';
}

export interface StagedEnterOptions {
  skipBlocks?: HTMLElement[];
  textDelay?: number;
  reducedMotion?: boolean;
  onRollOdometers?: (odoElements: HTMLElement[], atTime: number) => void;
  splitTextFn?: (el: HTMLElement) => HTMLElement[];
}

export interface StagedExitOptions {
  keepBlocks?: HTMLElement[];
  reducedMotion?: boolean;
}

function queryElements(roots: HTMLElement[], selector: string): HTMLElement[] {
  return roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(selector)));
}

function isInsideLaterGroup(el: HTMLElement): boolean {
  return Boolean(el.closest('.later'));
}

/**
 * Calm Chapter Transition — Enter Stage (Rules 1, 2, 3, 5):
 * 1. Flat blocks scale in along one axis (`scaleY` or `scaleX`) with 5% soft spring & 70ms stagger.
 * 2. Headlines, kinetic split lines, and odometers enter once blocks settle (~85% through `blockIn`).
 * 3. Small details, ticks, and annotations enter last (`detailIn`).
 *
 * Returns the timeline timestamp (in seconds) when the entry sequence finishes.
 */
export function enterChapterGroup(
  rootsInput: HTMLElement | HTMLElement[],
  tl: gsap.core.Timeline,
  at = 0,
  options: StagedEnterOptions = {}
): number {
  const roots = Array.isArray(rootsInput) ? rootsInput : [rootsInput];
  const rm = options.reducedMotion ?? isReducedMotion();

  const blocks = queryElements(roots, '.blk').filter(
    (b) =>
      !b.dataset.anchor &&
      !b.classList.contains('later') &&
      !(b.parentElement && isInsideLaterGroup(b.parentElement)) &&
      !options.skipBlocks?.includes(b)
  );
  const texts = queryElements(roots, '.tx').filter(
    (e) => !isInsideLaterGroup(e) && !e.classList.contains('split') && !e.closest('.split')
  );
  const splits = queryElements(roots, '.split').filter((e) => !isInsideLaterGroup(e));
  const details = queryElements(roots, '.dt').filter((e) => !isInsideLaterGroup(e));
  const odos = queryElements(roots, '.od').filter((e) => !isInsideLaterGroup(e));

  if (rm) {
    if (blocks.length > 0) {
      tl.fromTo(
        blocks,
        { autoAlpha: 0, scaleX: 1, scaleY: 1 },
        { autoAlpha: 1, duration: 0.28 },
        at
      );
    }
    if (texts.length > 0 || splits.length > 0) {
      tl.fromTo(
        [...texts, ...splits],
        { autoAlpha: 0, y: 0 },
        { autoAlpha: 1, duration: 0.28 },
        at + 0.14
      );
    }
    if (options.splitTextFn) {
      splits.forEach((s) => {
        const chars = options.splitTextFn!(s);
        if (chars.length > 0) tl.set(chars, { yPercent: 0 }, at);
      });
    }
    if (details.length > 0) {
      tl.fromTo(details, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.28 }, at + 0.26);
    }
    if (options.onRollOdometers && odos.length > 0) {
      options.onRollOdometers(odos, at + 0.14);
    }
    return at + 0.55;
  }

  // Stage 1: Blocks grow along one axis only (scaleY or scaleX)
  blocks.forEach((block, k) => {
    const prop = getBlockAxisProp(block);
    tl.fromTo(
      block,
      {
        [prop]: 0,
        autoAlpha: 1,
        scaleX: prop === 'scaleY' ? 1 : 0,
        scaleY: prop === 'scaleX' ? 1 : 0,
      },
      {
        [prop]: 1,
        duration: MOTION_TOKENS.tr.blockIn,
        ease: SOFT,
      },
      at + k * MOTION_TOKENS.tr.blockStagger
    );
  });

  // Stage 2: Text, kinetic split headlines, and odometers enter once blocks settle
  const textStartAt =
    at +
    (blocks.length > 0
      ? MOTION_TOKENS.tr.blockIn * 0.85 + (blocks.length - 1) * MOTION_TOKENS.tr.blockStagger
      : 0) +
    (options.textDelay ?? 0);

  if (texts.length > 0) {
    tl.fromTo(
      texts,
      { autoAlpha: 0, y: 18 },
      {
        autoAlpha: 1,
        y: 0,
        duration: MOTION_TOKENS.tr.textIn,
        ease: 'power3.out',
        stagger: MOTION_TOKENS.tr.textStagger,
      },
      textStartAt
    );
  }

  if (splits.length > 0 && options.splitTextFn) {
    splits.forEach((s, k) => {
      const chars = options.splitTextFn!(s);
      tl.set(s, { autoAlpha: 1, y: 0 }, textStartAt);
      if (chars.length > 0) {
        tl.fromTo(
          chars,
          { yPercent: 115 },
          {
            yPercent: 0,
            duration: MOTION_TOKENS.spring.settle + 0.06,
            ease: SPR,
            stagger: MOTION_TOKENS.st.letter,
          },
          textStartAt + k * 0.08
        );
      }
    });
  } else if (splits.length > 0) {
    tl.fromTo(
      splits,
      { autoAlpha: 0, y: 18 },
      {
        autoAlpha: 1,
        y: 0,
        duration: MOTION_TOKENS.tr.textIn,
        ease: 'power3.out',
      },
      textStartAt
    );
  }

  if (options.onRollOdometers && odos.length > 0) {
    options.onRollOdometers(odos, textStartAt);
  }

  // Stage 3: Details, rule lines (.sx), and annotations enter last
  if (details.length > 0) {
    const scaleXDetails = details.filter((e) => e.classList.contains('sx'));
    const otherDetails = details.filter((e) => !e.classList.contains('sx'));

    if (scaleXDetails.length > 0) {
      tl.fromTo(
        scaleXDetails,
        { scaleX: 0, autoAlpha: 1 },
        {
          scaleX: 1,
          duration: MOTION_TOKENS.tr.detailIn + 0.1,
          ease: 'power3.out',
          stagger: 0.03,
        },
        textStartAt + 0.25
      );
    }

    if (otherDetails.length > 0) {
      tl.fromTo(
        otherDetails,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          duration: MOTION_TOKENS.tr.detailIn,
          ease: 'power1.out',
          stagger: Math.min(0.02, 0.6 / otherDetails.length),
        },
        textStartAt + 0.3
      );
    }
  }

  return textStartAt + 0.75;
}

/**
 * Calm Chapter Transition — Exit Stage (Rules 1, 2, 3):
 * 1. Text, details, and watermarks leave first (`textOut: 0.18s`).
 * 2. Blocks collapse in reverse order along one axis (`blockOut: 0.26s`).
 * 3. Outgoing chapter is completely gone before incoming chapter starts on the next beat.
 */
export function exitChapterGroup(
  rootsInput: HTMLElement | HTMLElement[],
  tl: gsap.core.Timeline,
  at = 0,
  options: StagedExitOptions = {}
): number {
  const roots = Array.isArray(rootsInput) ? rootsInput : [rootsInput];
  const rm = options.reducedMotion ?? isReducedMotion();

  const textEls = queryElements(roots, '.tx, .split, .dt, .gh, .later').filter(
    (e) => Number(gsap.getProperty(e, 'autoAlpha')) > 0
  );
  const blocks = queryElements(roots, '.blk').filter(
    (b) =>
      !b.dataset.anchor &&
      !options.keepBlocks?.includes(b) &&
      Number(gsap.getProperty(b, 'autoAlpha')) > 0
  );

  if (rm) {
    const all = [...textEls, ...blocks];
    if (all.length > 0) {
      tl.to(all, { autoAlpha: 0, duration: 0.25 }, at);
    }
    return at + 0.3;
  }

  if (textEls.length > 0) {
    tl.to(
      textEls,
      {
        autoAlpha: 0,
        y: '-=8',
        duration: MOTION_TOKENS.tr.textOut,
        ease: 'power2.in',
        stagger: Math.min(0.01, 0.12 / textEls.length),
      },
      at
    );
  }

  blocks
    .slice()
    .reverse()
    .forEach((block, k) => {
      const prop = getBlockAxisProp(block);
      tl.to(
        block,
        {
          [prop]: 0,
          duration: MOTION_TOKENS.tr.blockOut,
          ease: 'power3.in',
        },
        at + 0.16 + k * 0.035
      );
    });

  if (textEls.length > 0) {
    tl.set(textEls, { y: 0 }, at + 0.5);
  }

  return at + 0.16 + MOTION_TOKENS.tr.blockOut + blocks.length * 0.035;
}

/**
 * Build a complete calm chapter-to-chapter transition following all 5 rules:
 * Outgoing exits -> near-empty beat gap -> snap to 120 BPM beat -> Incoming enters.
 */
export function buildCalmTransition(params: {
  outgoingRoots?: HTMLElement | HTMLElement[];
  incomingRoots: HTMLElement | HTMLElement[];
  timeline?: gsap.core.Timeline;
  startAt?: number;
  enterOptions?: StagedEnterOptions;
  exitOptions?: StagedExitOptions;
}): { timeline: gsap.core.Timeline; incomingStartAt: number; totalEndAt: number } {
  const tl = params.timeline ?? gsap.timeline();
  const startAt = params.startAt ?? 0;
  let incomingStartAt = startAt;

  if (params.outgoingRoots) {
    const exitEnd = exitChapterGroup(params.outgoingRoots, tl, startAt, params.exitOptions);
    const outArr = Array.isArray(params.outgoingRoots)
      ? params.outgoingRoots
      : [params.outgoingRoots];
    tl.set(outArr, { autoAlpha: 0 }, exitEnd);
    incomingStartAt = snapToNextBeat(exitEnd, MOTION_TOKENS.tr.gap, MOTION_TOKENS.bpm);
  }

  const inArr = Array.isArray(params.incomingRoots) ? params.incomingRoots : [params.incomingRoots];
  tl.set(inArr, { autoAlpha: 1 }, Math.max(0, incomingStartAt - 0.001));
  const totalEndAt = enterChapterGroup(
    params.incomingRoots,
    tl,
    incomingStartAt,
    params.enterOptions
  );

  return { timeline: tl, incomingStartAt, totalEndAt };
}

/**
 * Deterministic Motion Event Logger for Audio Sync (`capture/motion_events.json`).
 * Note: Console output is off by default per Brief §9 and sits behind `enableConsoleLog`.
 */
export class MotionEventLogger {
  private events: MotionEvent[] = [];
  private originMs: number;
  private currentChapterId?: string;
  private consoleEnabled: boolean;
  private deterministicTimeMs: number | null = null;
  private listeners: Array<(event: MotionEvent) => void> = [];

  constructor(options: { enableConsoleLog?: boolean } = {}) {
    this.originMs = typeof performance !== 'undefined' ? performance.now() : 0;
    this.consoleEnabled = options.enableConsoleLog ?? false;
  }

  public setConsoleEnabled(enabled: boolean): void {
    this.consoleEnabled = enabled;
  }

  public setCurrentChapter(chapterId?: string): void {
    this.currentChapterId = chapterId;
  }

  /**
   * Set explicit deterministic timestamp (in milliseconds) for frame-stepped capture mode.
   * Pass `null` to resume wall-clock `performance.now()` timing.
   */
  public setDeterministicTimeMs(timeMs: number | null): void {
    this.deterministicTimeMs = timeMs;
  }

  public reset(originMs?: number): void {
    this.events = [];
    this.originMs = originMs ?? (typeof performance !== 'undefined' ? performance.now() : 0);
  }

  public log(
    type: string,
    value?: MotionEvent['value'],
    options?: { timestampMs?: number; chapterId?: string }
  ): MotionEvent {
    const rawNow =
      options?.timestampMs ??
      this.deterministicTimeMs ??
      (typeof performance !== 'undefined' ? performance.now() - this.originMs : 0);
    const timestamp = Math.max(0, Math.round(rawNow));
    const beat = beatAtTime(timestamp / 1000, MOTION_TOKENS.bpm);
    const event: MotionEvent = {
      type,
      timestamp,
      beat,
      ...((options?.chapterId ?? this.currentChapterId)
        ? { chapter_id: options?.chapterId ?? this.currentChapterId }
        : {}),
      value: value === undefined ? null : value,
    };

    this.events.push(event);
    if (this.consoleEnabled) {
      console.log(event);
    }
    for (const listener of this.listeners) {
      listener(event);
    }
    return event;
  }

  public subscribe(listener: (event: MotionEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public getEvents(): readonly MotionEvent[] {
    return this.events;
  }

  public clear(): void {
    this.events = [];
  }

  public toJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }
}

export const motionLogger = new MotionEventLogger({ enableConsoleLog: false });

export function mlog(type: string, value?: MotionEvent['value'], chapterId?: string): MotionEvent {
  return motionLogger.log(type, value, { chapterId });
}
