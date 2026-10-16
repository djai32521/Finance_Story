import gsap from 'gsap';
import type { Fact, MotionEvent, TimelineController } from '../../contracts/index.js';
import { EASE } from '../grid/interactive-grid.js';

export const MOTION_TOKENS = {
  bpm: 120,
  beat: 0.5,
  dur: { xs: 0.12, s: 0.2, m: 0.4, l: 0.5, flight: 0.56 },
  tr: {
    textOut: 0.18,
    blockOut: 0.26,
    gap: 0.08,
    blockIn: 0.5,
    blockStagger: 0.07,
    textIn: 0.4,
    textStagger: 0.05,
    detailIn: 0.3,
  },
  spring: { overshoot: 0.15, settle: 0.3 },
  soft: { overshoot: 0.05, dur: 0.5 },
  st: { letter: 0.022, col: 0.003, wave: 0.0007, particle: 0.0021 },
  speeds: [0.5, 1, 2] as const,
};

/**
 * Pure deterministic copy template resolver.
 * Replaces `{fact:id}` with `facts.get(id).formatted`.
 * Throws if an unknown fact ID is referenced when `strict` is true.
 */
export function resolveCopyTemplate(
  template: string,
  facts: ReadonlyMap<string, Fact>,
  options: { strict?: boolean; onReferencedFact?: (factId: string) => void } = {}
): string {
  const strict = options.strict ?? false;
  return template.replace(/\{fact:([a-zA-Z0-9_]+)\}/g, (_match, factId: string) => {
    const fact = facts.get(factId);
    if (!fact) {
      if (strict) {
        throw new Error(`Unknown fact referenced in copy template: {fact:${factId}}`);
      }
      return '';
    }
    options.onReferencedFact?.(factId);
    return fact.formatted;
  });
}

const DIG30 = Array.from({ length: 30 }, (_, i) => `<i>${i % 10}</i>`).join('');

/**
 * Deterministic rolling digit odometer matching blocks_v2.html.
 * Formats any display string (e.g. "$2,184", "72", "2.8") by rolling each digit slot
 * and preserving non-digit separators (',', '.', '$', '×', '%').
 */
export class Odometer {
  public readonly el: HTMLElement;
  private digits: Array<{ w: HTMLElement; s: HTMLElement; pos: number; targetDigit: number }> = [];
  private targetString = '';

  constructor(el: HTMLElement, targetValueStr?: string) {
    this.el = el;
    el.classList.add('odo');
    this.build(targetValueStr ?? el.dataset.v ?? el.textContent ?? '0');
  }

  public build(rawStr: string): void {
    this.targetString = rawStr;
    this.el.innerHTML = '';
    this.digits = [];

    for (const ch of rawStr) {
      if (/\d/.test(ch)) {
        const w = document.createElement('span');
        w.className = 'dg';
        const s = document.createElement('span');
        s.className = 'st';
        s.innerHTML = DIG30;
        w.appendChild(s);
        this.el.appendChild(w);
        const digitVal = Number(ch);
        this.digits.push({ w, s, pos: digitVal, targetDigit: digitVal });
      } else {
        const c = document.createElement('span');
        c.className = 'sp';
        c.textContent = ch;
        this.el.appendChild(c);
      }
    }
    this.digits.forEach((_, idx) => this.applyTransform(idx));
  }

  private applyTransform(idx: number): void {
    const d = this.digits[idx];
    if (!d) return;
    d.s.style.transform = `translate3d(0,${(-d.pos).toFixed(4)}em,0)`;
  }

  public setImmediate(valueStr?: string): void {
    if (valueStr !== undefined && valueStr !== this.targetString) {
      this.build(valueStr);
    }
    this.digits.forEach((d, idx) => {
      gsap.killTweensOf(d);
      d.pos = d.targetDigit;
      this.applyTransform(idx);
    });
  }

  public roll(
    opts: {
      valueStr?: string;
      dur?: number;
      delay?: number;
      stagger?: number;
      laps?: number;
      reducedMotion?: boolean;
      tl?: gsap.core.Timeline;
      at?: number;
    } = {}
  ): void {
    if (opts.valueStr !== undefined && opts.valueStr !== this.targetString) {
      this.build(opts.valueStr);
    }
    if (opts.reducedMotion) {
      this.setImmediate();
      return;
    }
    const laps = opts.laps ?? 1;
    const dur = opts.dur ?? 0.62;
    const baseDelay = opts.delay ?? 0;
    const stagger = opts.stagger ?? 0.045;

    if (opts.tl) {
      const startAt = opts.at ?? 0;
      this.digits.forEach((d, k) => {
        gsap.killTweensOf(d);
        const to = d.targetDigit;
        opts.tl!.fromTo(
          d,
          { pos: 0 },
          {
            pos: to + 10 * laps,
            duration: dur,
            ease: 'power4.out',
            immediateRender: false,
            onUpdate: () => this.applyTransform(k),
            onComplete: () => {
              d.pos = to;
              this.applyTransform(k);
            },
          },
          startAt + baseDelay + k * stagger
        );
      });
      return;
    }

    this.digits.forEach((d, k) => {
      gsap.killTweensOf(d);
      d.pos = 0;
      this.applyTransform(k);
      const to = d.targetDigit;
      gsap.to(d, {
        pos: to + 10 * laps,
        duration: dur,
        delay: baseDelay + k * stagger,
        ease: 'power4.out',
        onUpdate: () => this.applyTransform(k),
        onComplete: () => {
          d.pos = to;
          this.applyTransform(k);
        },
      });
    });
  }
}

export interface OdometerHostElement extends HTMLElement {
  _odo?: Odometer;
}

export interface SplitHostElement extends HTMLElement {
  _ls?: HTMLElement[];
}

export function initOdometers(root: HTMLElement): Odometer[] {
  const els = Array.from(root.querySelectorAll<OdometerHostElement>('.od'));
  return els.map((el) => {
    if (el._odo) return el._odo;
    const odo = new Odometer(el, el.dataset.v ?? el.textContent ?? '0');
    el._odo = odo;
    return odo;
  });
}

export function splitHeadlineLetters(el: HTMLElement): HTMLElement[] {
  const host = el as SplitHostElement;
  if (host._ls) return host._ls;
  const lines = el.innerHTML.split(/<br\s*\/?>/i);
  el.innerHTML = lines
    .map((line) => {
      const text = line
        .replace(/&amp;/g, '&')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!text) return '<span class="ln"></span>';
      const words = text.split(/\s+/);
      const wordSpans = words
        .map((word) => {
          const chars = Array.from(word)
            .map((ch) => `<span class="l">${ch === '&' ? '&amp;' : ch}</span>`)
            .join('');
          return `<span class="w">${chars}</span>`;
        })
        .join(' ');
      return `<span class="ln">${wordSpans}</span>`;
    })
    .join('');
  const letters = Array.from(el.querySelectorAll<HTMLElement>('.l'));
  host._ls = letters;
  return letters;
}

function getBlockAxisProp(blockEl: HTMLElement): 'scaleX' | 'scaleY' {
  const ax = blockEl.dataset.ax ?? 'b';
  return ax === 'l' || ax === 'r' ? 'scaleX' : 'scaleY';
}

function isInsideLater(el: Element): boolean {
  return Boolean(el.closest('.later'));
}

/**
 * Staged entrance following Section 4 Motion Guide:
 * 1. Blocks grow along one axis only (500ms, 70ms stagger, soft 5% spring)
 * 2. Text & Odometers enter once blocks settle (400ms, 50ms stagger; letters on 15% spring)
 * 3. Details & annotations last (300ms)
 */
export function enterStageGroup(
  roots: HTMLElement | HTMLElement[],
  tl: gsap.core.Timeline,
  at = 0,
  reducedMotion = false,
  opts: { skip?: HTMLElement[]; textDelay?: number } = {}
): number {
  const rootArr = Array.isArray(roots) ? roots : [roots];
  const queryAll = (sel: string): HTMLElement[] =>
    rootArr.flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>(sel)));

  const blks = queryAll('.blk').filter(
    (b) =>
      !b.dataset.anchor &&
      !b.classList.contains('later') &&
      !(b.parentElement && isInsideLater(b.parentElement)) &&
      !opts.skip?.includes(b)
  );
  const txs = queryAll('.tx').filter(
    (e) => !isInsideLater(e) && !e.classList.contains('split') && !e.closest('.split')
  );
  const spl = queryAll('.split').filter((e) => !isInsideLater(e));
  const dts = queryAll('.dt').filter((e) => !isInsideLater(e));
  const odos = queryAll('.od')
    .filter((e) => !isInsideLater(e))
    .map((e) => (e as OdometerHostElement)._odo ?? new Odometer(e));

  if (reducedMotion) {
    if (blks.length) {
      tl.fromTo(blks, { autoAlpha: 0, scaleX: 1, scaleY: 1 }, { autoAlpha: 1, duration: 0.28 }, at);
    }
    if (txs.length || spl.length) {
      tl.fromTo(
        [...txs, ...spl],
        { autoAlpha: 0, y: 0 },
        { autoAlpha: 1, duration: 0.28 },
        at + 0.12
      );
      spl.forEach((s) => tl.set(splitHeadlineLetters(s), { yPercent: 0 }, at));
    }
    if (dts.length) {
      tl.fromTo(dts, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.28 }, at + 0.22);
    }
    tl.call(() => odos.forEach((o) => o.setImmediate()), [], at + 0.12);
    return at + 0.5;
  }

  blks.forEach((b, k) => {
    const p = getBlockAxisProp(b);
    tl.fromTo(
      b,
      {
        [p]: 0,
        autoAlpha: 1,
        scaleX: p === 'scaleY' ? 1 : 0,
        scaleY: p === 'scaleX' ? 1 : 0,
      },
      {
        [p]: 1,
        duration: MOTION_TOKENS.tr.blockIn,
        ease: EASE.soft,
      },
      at + k * MOTION_TOKENS.tr.blockStagger
    );
  });

  const tAt =
    at +
    (blks.length
      ? MOTION_TOKENS.tr.blockIn * 0.85 + (blks.length - 1) * MOTION_TOKENS.tr.blockStagger
      : 0) +
    (opts.textDelay ?? 0);

  if (txs.length) {
    tl.fromTo(
      txs,
      { autoAlpha: 0, y: 18 },
      {
        autoAlpha: 1,
        y: 0,
        duration: MOTION_TOKENS.tr.textIn,
        ease: 'power3.out',
        stagger: MOTION_TOKENS.tr.textStagger,
      },
      tAt
    );
  }

  spl.forEach((s, k) => {
    tl.set(s, { autoAlpha: 1, y: 0 }, tAt);
    tl.fromTo(
      splitHeadlineLetters(s),
      { yPercent: 115 },
      {
        yPercent: 0,
        duration: MOTION_TOKENS.spring.settle + 0.06,
        ease: EASE.spring,
        stagger: MOTION_TOKENS.st.letter,
      },
      tAt + k * 0.08
    );
  });

  if (odos.length) {
    odos.forEach((o, k) => o.roll({ tl, at: tAt, delay: k * 0.05, reducedMotion }));
  }

  if (dts.length) {
    const sx = dts.filter((e) => e.classList.contains('sx'));
    const ot = dts.filter((e) => !e.classList.contains('sx'));
    if (sx.length) {
      tl.fromTo(
        sx,
        { scaleX: 0, autoAlpha: 1 },
        { scaleX: 1, duration: MOTION_TOKENS.tr.detailIn + 0.1, ease: 'power3.out', stagger: 0.03 },
        tAt + 0.25
      );
    }
    if (ot.length) {
      tl.fromTo(
        ot,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          duration: MOTION_TOKENS.tr.detailIn,
          ease: 'power1.out',
          stagger: Math.min(0.02, 0.6 / ot.length),
        },
        tAt + 0.3
      );
    }
  }

  return tAt + 0.75;
}

/**
 * Staged exit following Section 4 Motion Guide:
 * Out fully, then in: text leaves first (180ms), then blocks collapse on one axis (260ms).
 */
export function exitStageGroup(
  roots: HTMLElement | HTMLElement[],
  tl: gsap.core.Timeline,
  at = 0,
  reducedMotion = false,
  opts: { keep?: HTMLElement[] } = {}
): number {
  const rootArr = Array.isArray(roots) ? roots : [roots];
  const queryAll = (sel: string): HTMLElement[] =>
    rootArr.flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>(sel)));

  const txt = queryAll('.tx,.split,.dt,.gh,.later').filter(
    (e) => Number(gsap.getProperty(e, 'autoAlpha')) > 0
  );
  const blks = queryAll('.blk').filter(
    (b) =>
      !b.dataset.anchor && !opts.keep?.includes(b) && Number(gsap.getProperty(b, 'autoAlpha')) > 0
  );

  if (reducedMotion) {
    if (txt.length || blks.length) {
      tl.to([...txt, ...blks], { autoAlpha: 0, duration: 0.22 }, at);
    }
    return at + 0.25;
  }

  if (txt.length) {
    tl.to(
      txt,
      {
        autoAlpha: 0,
        y: '-=8',
        duration: MOTION_TOKENS.tr.textOut,
        ease: 'power2.in',
        stagger: Math.min(0.01, 0.12 / txt.length),
      },
      at
    );
  }

  blks
    .slice()
    .reverse()
    .forEach((b, k) => {
      const p = getBlockAxisProp(b);
      tl.to(
        b,
        {
          [p]: 0,
          duration: MOTION_TOKENS.tr.blockOut,
          ease: 'power3.in',
        },
        at + 0.16 + k * 0.035
      );
    });

  if (txt.length) {
    tl.set(txt, { y: 0 }, at + 0.5);
  }
  return at + 0.16 + MOTION_TOKENS.tr.blockOut + blks.length * 0.035;
}

export class PlayerTimelineController implements TimelineController {
  public gsapTimeline: gsap.core.Timeline;
  private readonly events: MotionEvent[] = [];
  private currentTimeSec = 0;
  private playbackRate = 1;
  private playingState = false;
  private reducedMotionState = false;
  public activeChapterId = 'pour';
  private onSeekHook?: (seconds: number, deltaSec: number) => void;

  constructor(
    options: {
      reducedMotion?: boolean;
      chapterId?: string;
      onSeek?: (seconds: number, deltaSec: number) => void;
    } = {}
  ) {
    this.reducedMotionState = options.reducedMotion ?? false;
    this.activeChapterId = options.chapterId ?? 'pour';
    this.onSeekHook = options.onSeek;
    this.gsapTimeline = gsap.timeline({ paused: true });
  }

  public resetTimeline(chapterId?: string): gsap.core.Timeline {
    this.gsapTimeline.kill();
    this.gsapTimeline = gsap.timeline({ paused: !this.playingState });
    this.gsapTimeline.timeScale(this.playbackRate);
    this.currentTimeSec = 0;
    if (chapterId) {
      this.activeChapterId = chapterId;
    }
    return this.gsapTimeline;
  }

  public seek(seconds: number): void {
    const clamped = Math.max(0, seconds);
    const delta = clamped - this.currentTimeSec;
    if (delta > 0.55) {
      const stepSize = 0.2;
      let cur = this.currentTimeSec;
      while (cur + stepSize < clamped) {
        cur += stepSize;
        this.currentTimeSec = cur;
        this.gsapTimeline.seek(cur, false);
        this.onSeekHook?.(cur, stepSize);
      }
      const rem = clamped - cur;
      this.currentTimeSec = clamped;
      this.gsapTimeline.seek(clamped, false);
      this.onSeekHook?.(clamped, rem);
      return;
    }
    this.currentTimeSec = clamped;
    this.gsapTimeline.seek(clamped, false);
    this.onSeekHook?.(clamped, delta);
  }

  public play(rate = 1): void {
    this.playbackRate = rate;
    this.playingState = true;
    this.gsapTimeline.timeScale(rate);
    this.gsapTimeline.play();
  }

  public pause(): void {
    this.playingState = false;
    this.gsapTimeline.pause();
  }

  public isPlaying(): boolean {
    return this.playingState;
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  public currentTime(): number {
    return this.gsapTimeline.isActive() ? this.gsapTimeline.time() : this.currentTimeSec;
  }

  public duration(): number {
    const d = this.gsapTimeline.duration();
    return d > 0 ? d : 6;
  }

  public progress(): number {
    const dur = this.duration();
    return dur > 0 ? Math.max(0, Math.min(1, this.currentTime() / dur)) : 0;
  }

  public logEvent(type: string, value: MotionEvent['value'] = null): void {
    const elapsedMs = Math.round(this.currentTime() * 1000);
    const beat = Math.floor(elapsedMs / (MOTION_TOKENS.beat * 1000));
    this.events.push({
      type,
      timestamp: elapsedMs,
      beat,
      chapter_id: this.activeChapterId,
      value,
    });
  }

  public getEvents(): readonly MotionEvent[] {
    return this.events;
  }

  public clearEvents(): void {
    this.events.length = 0;
  }

  public isReducedMotion(): boolean {
    return this.reducedMotionState;
  }

  public setReducedMotion(enabled: boolean): void {
    this.reducedMotionState = enabled;
    this.logEvent('reduced-motion', enabled ? 'on' : 'off');
  }
}
