import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { GRID_PRESETS, RGB_PALETTE } from '../../grid/interactive-grid.js';
import {
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from './pour-chapter.js';

function getOrderedFacts(ctx: ChapterContext): [Fact, Fact] {
  const fromIds = ctx.chapter.fact_ids
    .map((id) => ctx.facts.get(id))
    .filter((f): f is Fact => f !== undefined);
  const ratioFact =
    ctx.facts.get('payday_spike_ratio') ?? fromIds[0] ?? ctx.facts.values().next().value!;
  const countFact = ctx.facts.get('payday_count') ?? fromIds[1] ?? ratioFact;
  return [ratioFact, countFact];
}

export class HeartbeatChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const [ratioFact, countFact] = getOrderedFacts(ctx);
    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const isB2B = Boolean(ctx.plan.business_meta);
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const pulseLabel = isB2B
      ? 'OPERATING SETTLEMENT & CASHFLOW PULSE · DAY +0 TO DAY +27'
      : 'POST-PAYDAY PULSE · DAY +0 TO DAY +27 (SURGE DAYS IN ORANGE)';

    // Compute average post-payday curve (Day 0 payday .. Day +27)
    const paydayIndices: number[] = [];
    ctx.days.forEach((d, idx) => {
      if (d.is_payday) paydayIndices.push(idx);
    });

    const cycleBuckets = new Array<number>(28).fill(0);
    const cycleCounts = new Array<number>(28).fill(0);
    ctx.days.forEach((d, idx) => {
      let lastPay = -100;
      for (const pIdx of paydayIndices) {
        if (pIdx <= idx) lastPay = pIdx;
      }
      const offset = idx - lastPay;
      if (offset >= 0 && offset < 28) {
        const dayOut =
          isB2B && d.discretionary_out_minor === 0 ? d.all_out_minor : d.discretionary_out_minor;
        cycleBuckets[offset] = (cycleBuckets[offset] ?? 0) + dayOut;
        cycleCounts[offset] = (cycleCounts[offset] ?? 0) + 1;
      }
    });

    const avgByOffset = cycleBuckets.map((sum, k) => (cycleCounts[k] ? sum / cycleCounts[k]! : 0));
    const maxAvg = Math.max(100, ...avgByOffset);

    const barsSvg = avgByOffset
      .map((val, k) => {
        const h = Math.max(8, (val / maxAvg) * 260);
        const fill = k < 5 ? '#FF5A14' : '#111111';
        return `<rect class="pb" x="${k * 34}" y="${(280 - h).toFixed(1)}" width="26" height="${h.toFixed(1)}" fill="${fill}"/>`;
      })
      .join('');

    const ratioDigits = ratioFact.formatted.replace(/×$/, '');
    const ratioLabel = ctx.chapter.params.blocks?.[0]?.label || ratioFact.label;
    const countLabel = ctx.chapter.params.blocks?.[1]?.label || countFact.label;

    container.innerHTML = `
      <div class="ch-header-stack" style="left:60px;top:84px;max-width:1400px;max-height:290px">
        <div class="lab tx">${this.escapeHtml(ctx.chapter.params.kicker ?? 'THE HEARTBEAT')}</div>
        <div class="split tx" data-testid="chapter-headline" style="font-size:68px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;max-width:1400px">${this.escapeHtml(headlineText)}</div>
        <div class="tx" data-testid="chapter-body" style="max-width:1400px;font-size:16px;line-height:1.35;color:${isB2B ? '#C9C5BA' : '#F3F0E6'};${isB2B ? '' : 'background:#1C1C1B;border-left:4px solid #F4F03A;padding:12px 18px'}">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="heartbeat-waveform-block" style="position:absolute;left:64px;top:410px;width:1040px;height:400px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:28px;top:22px;right:24px;display:flex;justify-content:space-between;align-items:center">
          <span>${pulseLabel}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(ratioFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <svg class="dt" style="position:absolute;left:36px;top:84px" width="968" height="290">${barsSvg}</svg>
      </div>

      <div class="blk ia" data-ax="b" data-testid="heartbeat-ratio-block" style="position:absolute;left:1124px;top:410px;width:380px;height:400px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:28px;top:22px">${this.escapeHtml(ratioLabel)}</div>
        <div class="num tx" style="position:absolute;left:22px;bottom:28px;font-size:150px"><span class="od" data-v="${this.escapeHtml(ratioDigits)}">${this.escapeHtml(ratioDigits)}</span><sup class="aft">×</sup></div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="heartbeat-count-block" style="position:absolute;left:1520px;top:410px;width:336px;height:400px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:28px;top:22px">${this.escapeHtml(countLabel)}</div>
        <div class="num tx" style="position:absolute;left:22px;bottom:28px;font-size:150px"><span class="od" data-v="${this.escapeHtml(countFact.formatted)}">${this.escapeHtml(countFact.formatted)}</span></div>
      </div>
    `;

    initOdometers(container);

    container.querySelectorAll<HTMLButtonElement>('.receipt-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = btn.dataset.factId;
        if (fid && ctx.facts.has(fid)) {
          const f = ctx.facts.get(fid)!;
          ctx.openReceipts(`${f.label} (${f.formatted})`, f.txn_ids);
        } else {
          ctx.openReceipts(headlineText, ctx.chapter.txn_ids);
        }
      });
    });
  }

  public play(timeline: TimelineController): void {
    if (!this.container || !this.ctx) return;
    const tl = (timeline as PlayerTimelineController).gsapTimeline ?? gsap.timeline();
    const rm = timeline.isReducedMotion();
    const grid = this.ctx.grid;

    if (grid) {
      grid.hideAllParticles();
      grid.setGridGeometry(GRID_PRESETS.mini, { dur: 0.45 });
      grid.days.forEach((v) => {
        if (v.day.is_payday) {
          grid.tweenColor(v, RGB_PALETTE.c4, 0.25);
          grid.popVisual(v, 0.5);
        } else {
          grid.tweenColor(v, RGB_PALETTE.dim, 0.25);
        }
      });
    }

    enterStageGroup(this.container, tl, 0, rm);
    timeline.logEvent('heartbeat.play');
  }

  public explore(): void {
    this.ctx?.openExplore();
  }

  public unmount(): void {
    if (this.ctx?.grid) {
      this.ctx.grid.resetToBaseColors(true);
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
