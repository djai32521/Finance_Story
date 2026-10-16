import gsap from 'gsap';
import type { Day } from '../../contracts/index.js';
import { formatMoneyMinor } from '../../contracts/index.js';
import { formatDayLabel, type InteractiveGrid } from './interactive-grid.js';

export interface RangeAggregationResult {
  startDayIndex: number;
  endDayIndex: number;
  dayCount: number;
  discretionaryOutMinor: number;
  allOutMinor: number;
  inMinor: number;
  formattedDiscretionary: string;
  formattedAllOut: string;
  formattedDailyAvg: string;
  txnIds: string[];
  startDate: string;
  endDate: string;
  startLabel: string;
  endLabel: string;
}

/**
 * Pure deterministic range aggregator over Day[] (integer cents -> formatted money).
 */
export function aggregateDayRange(
  days: readonly Day[],
  indexA: number,
  indexB: number
): RangeAggregationResult {
  if (days.length === 0) {
    return {
      startDayIndex: 0,
      endDayIndex: 0,
      dayCount: 0,
      discretionaryOutMinor: 0,
      allOutMinor: 0,
      inMinor: 0,
      formattedDiscretionary: '$0',
      formattedAllOut: '$0',
      formattedDailyAvg: '$0',
      txnIds: [],
      startDate: '',
      endDate: '',
      startLabel: '',
      endLabel: '',
    };
  }
  const clampedA = Math.max(0, Math.min(days.length - 1, indexA));
  const clampedB = Math.max(0, Math.min(days.length - 1, indexB));
  const startDayIndex = Math.min(clampedA, clampedB);
  const endDayIndex = Math.max(clampedA, clampedB);
  const dayCount = endDayIndex - startDayIndex + 1;

  let discretionaryOutMinor = 0;
  let allOutMinor = 0;
  let inMinor = 0;
  const txnIds: string[] = [];

  for (let i = startDayIndex; i <= endDayIndex; i++) {
    const d = days[i]!;
    discretionaryOutMinor += d.discretionary_out_minor;
    allOutMinor += d.all_out_minor;
    inMinor += d.in_minor;
    for (const id of d.txn_ids) {
      txnIds.push(id);
    }
  }

  const avgMinor = dayCount > 0 ? Math.round(discretionaryOutMinor / dayCount) : 0;
  const startDay = days[startDayIndex]!;
  const endDay = days[endDayIndex]!;

  return {
    startDayIndex,
    endDayIndex,
    dayCount,
    discretionaryOutMinor,
    allOutMinor,
    inMinor,
    formattedDiscretionary: formatMoneyMinor(discretionaryOutMinor, { showCents: false }),
    formattedAllOut: formatMoneyMinor(allOutMinor, { showCents: false }),
    formattedDailyAvg: formatMoneyMinor(avgMinor, { showCents: false }),
    txnIds,
    startDate: startDay.date,
    endDate: endDay.date,
    startLabel: formatDayLabel(startDay),
    endLabel: formatDayLabel(endDay),
  };
}

export interface DragSelectorCallbacks {
  onSingleClickDay: (dayIndex: number) => void;
  onRangeSelected: (summary: RangeAggregationResult) => void;
  onLogEvent?: (type: string, value?: Record<string, unknown> | string | number) => void;
}

export class DragSelector {
  private readonly grid: InteractiveGrid;
  private readonly pillEl: HTMLElement;
  private readonly pillValEl: HTMLElement;
  private readonly pillLabEl: HTMLElement;
  private readonly callbacks: DragSelectorCallbacks;
  private dragState: { start: number; cur: number; moved: boolean } | null = null;
  private readonly pillX: gsap.QuickToFunc;
  private readonly pillY: gsap.QuickToFunc;
  private readonly animatedValue = { minor: 0 };

  constructor(
    grid: InteractiveGrid,
    pillEl: HTMLElement,
    pillValEl: HTMLElement,
    pillLabEl: HTMLElement,
    callbacks: DragSelectorCallbacks
  ) {
    this.grid = grid;
    this.pillEl = pillEl;
    this.pillValEl = pillValEl;
    this.pillLabEl = pillLabEl;
    this.callbacks = callbacks;
    this.pillX = gsap.quickTo(this.pillEl, 'x', { duration: 0.16, ease: 'power3.out' });
    this.pillY = gsap.quickTo(this.pillEl, 'y', { duration: 0.16, ease: 'power3.out' });
  }

  public isDragging(): boolean {
    return this.dragState !== null;
  }

  public hasMoved(): boolean {
    return this.dragState?.moved ?? false;
  }

  public onPointerDown(dayIndex: number): void {
    if (dayIndex < 0 || dayIndex >= this.grid.days.length) return;
    this.dragState = { start: dayIndex, cur: dayIndex, moved: false };
    this.grid.selection.active = false;
    const dv = this.grid.days[dayIndex];
    if (dv) {
      this.grid.popVisual(dv, 0.25);
    }
  }

  public onPointerMove(stageX: number, stageY: number, hoveredDayIndex: number): boolean {
    if (!this.dragState) return false;
    if (hoveredDayIndex >= 0 && hoveredDayIndex !== this.dragState.cur) {
      this.dragState.cur = hoveredDayIndex;
      this.dragState.moved = true;
      this.grid.selection.active = true;
      this.grid.selection.start = this.dragState.start;
      this.grid.selection.end = hoveredDayIndex;
      this.updatePill(stageX, stageY);
      return true;
    }
    if (this.dragState.moved) {
      this.updatePill(stageX, stageY);
      return true;
    }
    return false;
  }

  public onPointerUp(): void {
    if (!this.dragState) return;
    const state = this.dragState;
    this.dragState = null;

    if (!state.moved) {
      this.callbacks.onSingleClickDay(state.start);
      return;
    }

    gsap.to(this.pillEl, { autoAlpha: 0, duration: 0.2 });
    const summary = aggregateDayRange(
      this.grid.days.map((d) => d.day),
      state.start,
      state.cur
    );
    this.callbacks.onLogEvent?.('explore.select', {
      days: summary.dayCount,
      total: +(summary.discretionaryOutMinor / 100).toFixed(2),
    });
    this.callbacks.onRangeSelected(summary);
  }

  public selectRangeProgrammatically(
    startDayIndex: number,
    endDayIndex: number
  ): RangeAggregationResult {
    this.grid.selection.active = true;
    this.grid.selection.start = startDayIndex;
    this.grid.selection.end = endDayIndex;
    const summary = aggregateDayRange(
      this.grid.days.map((d) => d.day),
      startDayIndex,
      endDayIndex
    );
    this.callbacks.onRangeSelected(summary);
    return summary;
  }

  public clearSelection(): void {
    this.dragState = null;
    this.grid.selection.active = false;
    gsap.to(this.pillEl, { autoAlpha: 0, duration: 0.15 });
  }

  private updatePill(stageX: number, stageY: number): void {
    if (!this.dragState) return;
    const summary = aggregateDayRange(
      this.grid.days.map((d) => d.day),
      this.dragState.start,
      this.dragState.cur
    );

    if (this.grid.reducedMotion) {
      this.animatedValue.minor = summary.discretionaryOutMinor;
      this.pillValEl.textContent = formatMoneyMinor(summary.discretionaryOutMinor, {
        showCents: false,
        prefix: '',
      });
    } else {
      gsap.to(this.animatedValue, {
        minor: summary.discretionaryOutMinor,
        duration: 0.2,
        ease: 'power2.out',
        overwrite: true,
        onUpdate: () => {
          this.pillValEl.textContent = formatMoneyMinor(this.animatedValue.minor, {
            showCents: false,
            prefix: '',
          });
        },
      });
    }

    this.pillLabEl.textContent = `${summary.dayCount} DAYS · ${summary.txnIds.length} ITEMS · ${summary.startLabel.toUpperCase()} → ${summary.endLabel.toUpperCase()}`;
    gsap.to(this.pillEl, { autoAlpha: 1, duration: 0.12 });
    const clampedX = Math.min(1620, Math.max(40, stageX + 24));
    const clampedY = Math.max(40, stageY - 90);
    this.pillX(clampedX);
    this.pillY(clampedY);
  }
}
