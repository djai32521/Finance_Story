import type { Category, Day } from '../../contracts/index.js';
import {
  CATEGORY_COLORS,
  EASE,
  GRID_PRESETS,
  RGB_PALETTE,
  hexToRgb,
  mixRgb,
  type GridGeometry,
  type InteractiveGrid,
  type RGB,
} from './interactive-grid.js';

export interface SweepTimeRemap {
  times: number[]; // length 366 (0..365)
  totalDuration: number;
  dayAtTime: (tSec: number) => number;
}

/**
 * Builds the non-linear 120 BPM beat-aligned time remap so the year sweep
 * slows into big spending moments and paydays, and accelerates through quiet weeks.
 */
export function buildSweepTimeRemap(
  days: readonly Day[],
  p95Minor: number,
  targetDurationSec = 7.5,
  beatSec = 0.5
): SweepTimeRemap {
  const weights = days.map((d) => {
    const m = parseInt(d.date.slice(5, 7), 10) - 1;
    const spendFactor = Math.min(
      2.2,
      Math.pow(Math.max(0, d.discretionary_out_minor) / Math.max(100, p95Minor), 1.35)
    );
    return 0.22 + 1.4 * spendFactor + (d.is_payday ? 1.1 : 0) + (m === 11 ? 0.45 : 0);
  });

  const t0: number[] = [0];
  for (const w of weights) {
    t0.push((t0[t0.length - 1] ?? 0) + w);
  }
  const rawTotal = t0[days.length] || 1;
  const scale = targetDurationSec / rawTotal;
  for (let i = 0; i < t0.length; i++) {
    t0[i] = (t0[i] ?? 0) * scale;
  }

  const anchors: Array<[number, number]> = [[0, 0]];
  days.forEach((d, idx) => {
    if (d.is_payday) {
      let beatTime = Math.round((t0[idx] ?? 0) / beatSec) * beatSec;
      const prevTime = anchors[anchors.length - 1]![1];
      if (beatTime <= prevTime) {
        beatTime = prevTime + beatSec;
      }
      anchors.push([idx, beatTime]);
    }
  });
  const lastAnchorTime = anchors[anchors.length - 1]![1];
  anchors.push([days.length, Math.max(targetDurationSec, lastAnchorTime + 0.5)]);

  const times = new Array<number>(days.length + 1).fill(0);
  for (let k = 0; k < anchors.length - 1; k++) {
    const [ia, ta] = anchors[k]!;
    const [ib, tb] = anchors[k + 1]!;
    const spanT0 = (t0[ib] ?? 0) - (t0[ia] ?? 0) || 1;
    for (let i = ia; i <= ib; i++) {
      times[i] = ta + (((t0[i] ?? 0) - (t0[ia] ?? 0)) / spanT0) * (tb - ta);
    }
  }

  const totalDuration = times[days.length] ?? targetDurationSec;

  const dayAtTime = (tSec: number): number => {
    if (tSec <= 0) return 0;
    if (tSec >= totalDuration) return days.length;
    let lo = 0;
    let hi = days.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((times[mid] ?? 0) <= tSec) lo = mid;
      else hi = mid;
    }
    const tLo = times[lo] ?? 0;
    const tHi = times[lo + 1] ?? tLo + 0.01;
    return lo + (tSec - tLo) / (tHi - tLo || 1);
  };

  return { times, totalDuration, dayAtTime };
}

export interface ScrubBarCallbacks {
  onLogEvent?: (type: string, value?: Record<string, unknown> | string | number) => void;
}

export class ScrubBar {
  private readonly grid: InteractiveGrid;
  private readonly remap: SweepTimeRemap;
  private readonly callbacks: ScrubBarCallbacks;
  public pos = 364;
  public playing = false;
  public scrubbing = false;
  public speed: 0.5 | 1 | 2 = 1;
  public activeLens: Category | '' = '';
  private replayTimeSec = 0;

  private scrubFillEl: HTMLElement | null = null;
  private scrubLineEl: HTMLElement | null = null;
  private replayBtnEl: HTMLButtonElement | null = null;
  private speedBtns: HTMLButtonElement[] = [];

  constructor(grid: InteractiveGrid, callbacks: ScrubBarCallbacks = {}) {
    this.grid = grid;
    this.callbacks = callbacks;
    this.remap = buildSweepTimeRemap(
      grid.days.map((d) => d.day),
      grid.p95Minor,
      7.5,
      0.5
    );
  }

  public getRemap(): SweepTimeRemap {
    return this.remap;
  }

  public renderControlsHtml(geom: GridGeometry = GRID_PRESETS.explore): string {
    const firstWeekday = this.grid.days[0]?.day.weekday ?? 2;
    const seenMonths = new Set<number>();
    let monthTicks = '';
    this.grid.days.forEach((v, i) => {
      if (!seenMonths.has(v.month)) {
        seenMonths.add(v.month);
        const col = Math.floor((i + firstWeekday) / 7);
        monthTicks += `<div style="position:absolute;left:${col * geom.p}px;top:12px;width:1px;height:16px;background:#77746C"></div>`;
      }
    });

    const speeds: Array<0.5 | 1 | 2> = [0.5, 1, 2];
    const speedBtnsHtml = speeds
      .map(
        (s) =>
          `<button type="button" class="btn" data-speed="${s}" aria-pressed="${s === 1 ? 'true' : 'false'}" style="border:0;padding:11px 16px;background:${s === 1 ? 'var(--bone)' : 'transparent'};color:${s === 1 ? 'var(--ink)' : 'var(--bone)'}">${s}×</button>`
      )
      .join('');

    return `
      <div class="dt" id="scrub" data-testid="scrub-track" style="position:absolute;left:${geom.x}px;top:600px;width:${53 * geom.p}px;height:40px;cursor:ew-resize;pointer-events:auto;">
        <div style="position:absolute;left:0;right:0;top:19px;height:2px;background:#4A4A47"></div>
        ${monthTicks}
        <div id="scrubfill" style="position:absolute;left:0;top:18px;height:4px;background:var(--bone);width:100%;transform-origin:0 50%"></div>
      </div>
      <div class="dt" id="scrubline" style="position:absolute;left:0;top:${geom.y - 14}px;width:2px;height:${600 - geom.y + 34}px;background:var(--c4);pointer-events:none;">
        <div style="position:absolute;left:-10px;bottom:-2px;width:22px;height:22px;background:var(--c4)"></div>
      </div>
      <div class="tx ia" style="position:absolute;left:${geom.x}px;top:668px;display:flex;gap:14px;align-items:center;pointer-events:auto;">
        <button type="button" class="btn mag" id="replay-btn" data-testid="replay-btn" style="border-color:var(--bone);color:var(--bone);min-width:120px">▶ Replay</button>
        <div style="display:flex;border:1.5px solid var(--bone)" id="speed-btns" data-testid="speed-btns">${speedBtnsHtml}</div>
        <span class="lab" style="position:static;font-size:12px">Replay speed · drag the orange handle to scrub</span>
      </div>
    `;
  }

  public bindElements(root: HTMLElement): void {
    this.scrubFillEl = root.querySelector('#scrubfill');
    this.scrubLineEl = root.querySelector('#scrubline');
    this.replayBtnEl = root.querySelector('#replay-btn');
    this.speedBtns = Array.from(
      root.querySelectorAll<HTMLButtonElement>('#speed-btns [data-speed]')
    );

    this.replayBtnEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.playing) {
        this.pauseReplay();
      } else {
        this.startReplay();
      }
    });

    for (const btn of this.speedBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sp = Number(btn.dataset.speed) as 0.5 | 1 | 2;
        this.setSpeed(sp);
        if (!this.playing) {
          this.startReplay();
        }
      });
    }

    this.drawScrubPlayhead();
  }

  public setSpeed(speed: 0.5 | 1 | 2): void {
    this.speed = speed;
    for (const btn of this.speedBtns) {
      const on = Number(btn.dataset.speed) === speed;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.style.background = on ? 'var(--bone, #F3F0E6)' : 'transparent';
      btn.style.color = on ? 'var(--ink, #111111)' : 'var(--bone, #F3F0E6)';
    }
    this.callbacks.onLogEvent?.('explore.speed', speed);
  }

  public startReplay(): void {
    if (this.pos >= 364) {
      this.setPosition(-1);
    }
    this.replayTimeSec = this.remap.times[Math.max(0, this.pos + 1)] ?? 0;
    this.playing = true;
    if (this.replayBtnEl) {
      this.replayBtnEl.textContent = '❚❚ Pause';
    }
    this.callbacks.onLogEvent?.('explore.replay', { from: this.pos, speed: this.speed });
  }

  public pauseReplay(): void {
    this.playing = false;
    if (this.replayBtnEl) {
      this.replayBtnEl.textContent = '▶ Replay';
    }
  }

  public updateReplay(dtSec: number): void {
    if (!this.playing) return;
    if (this.pos >= 364) {
      this.playing = false;
      if (this.replayBtnEl) {
        this.replayBtnEl.textContent = '▶ Replay';
      }
      this.callbacks.onLogEvent?.('explore.replay.end', this.speed);
      return;
    }
    this.replayTimeSec += dtSec * this.speed;
    const dayFloat = this.remap.dayAtTime(this.replayTimeSec);
    this.setPosition(Math.floor(dayFloat));
  }

  public isHitScrubTrack(
    stageX: number,
    stageY: number,
    geom: GridGeometry = GRID_PRESETS.explore
  ): boolean {
    return (
      stageY > geom.y + 7 * geom.p + 10 &&
      stageY < 660 &&
      stageX > geom.x - 20 &&
      stageX < geom.x + 53 * geom.p + 20
    );
  }

  public scrubToStageX(stageX: number, geom: GridGeometry = GRID_PRESETS.explore): void {
    const firstWeekday = this.grid.days[0]?.day.weekday ?? 2;
    const colFloat = (stageX - geom.x) / geom.p;
    const targetDay = Math.floor(colFloat * 7 - firstWeekday);
    this.setPosition(targetDay);
  }

  public setPosition(newPos: number): void {
    const oldPos = this.pos;
    const clamped = Math.max(-1, Math.min(364, newPos));
    if (clamped === oldPos) return;
    this.pos = clamped;

    if (clamped < oldPos) {
      for (let i = clamped + 1; i <= oldPos; i++) {
        const v = this.grid.days[i];
        if (!v) continue;
        this.grid.tweenColor(v, RGB_PALETTE.empty, 0.1);
        this.grid.tweenProp(v, 'k', 0.45, 0.12);
      }
    } else {
      for (let i = oldPos + 1; i <= clamped; i++) {
        const v = this.grid.days[i];
        if (!v) continue;
        this.grid.setColorImmediate(v, RGB_PALETTE.bone);
        this.grid.tweenColor(v, this.getDayExploreColor(i), 0.22, 0.03);
        v.k = 0.45;
        this.grid.tweenProp(v, 'k', 1, 0.3, 0, EASE.spring);
        if (v.day.is_payday && this.playing) {
          this.grid.addRing(v.x, v.y, { r1: 80, d: 0.5 });
        }
      }
    }

    this.drawScrubPlayhead();
  }

  public getDayExploreColor(dayIndex: number): RGB {
    if (dayIndex > this.pos) return RGB_PALETTE.empty;
    if (!this.activeLens) return this.grid.getBaseColor(dayIndex);
    const v = this.grid.days[dayIndex];
    if (!v) return RGB_PALETTE.dim;
    const matching = v.txns.filter((t) => t.category === this.activeLens);
    const sumMinor = matching.reduce((acc, t) => acc + t.amount_minor, 0);
    if (sumMinor <= 0) return RGB_PALETTE.dim;
    const catRgb = hexToRgb(CATEGORY_COLORS[this.activeLens] ?? '#F4F03A');
    const q = Math.min(1, Math.sqrt(sumMinor / 6000));
    return mixRgb(hexToRgb('#2A2A28'), catRgb, 0.35 + 0.65 * q);
  }

  public drawScrubPlayhead(geom: GridGeometry = GRID_PRESETS.explore): void {
    const firstWeekday = this.grid.days[0]?.day.weekday ?? 2;
    const x = geom.x + ((this.pos + 1 + firstWeekday) / 7) * geom.p;
    if (this.scrubLineEl) {
      this.scrubLineEl.style.transform = `translateX(${x.toFixed(1)}px)`;
    }
    if (this.scrubFillEl) {
      const ratio = Math.max(0, Math.min(1, (x - geom.x) / (53 * geom.p)));
      this.scrubFillEl.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }
  }
}
