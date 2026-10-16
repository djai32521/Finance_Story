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

function getOrderedFacts(ctx: ChapterContext): [Fact, Fact, Fact] {
  const fromIds = ctx.chapter.fact_ids
    .map((id) => ctx.facts.get(id))
    .filter((f): f is Fact => f !== undefined);
  const all = Array.from(ctx.facts.values());
  const f0 = fromIds[0] ?? all[0]!;
  const f1 = fromIds[1] ?? fromIds[0] ?? all[1] ?? f0;
  const f2 = fromIds[2] ?? fromIds[1] ?? all[2] ?? f0;
  return [f0, f1, f2];
}

export class StreakChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private streakDayIndices: number[] = [];

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const [primaryFact, secondaryFact, tertiaryFact] = getOrderedFacts(ctx);
    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const isB2B = Boolean(ctx.plan.business_meta);
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');

    const highlightDates = new Set<string>(
      ctx.chapter.params.highlight_dates ?? ctx.transactions.map((t) => t.date)
    );
    this.streakDayIndices = [];
    ctx.days.forEach((d, idx) => {
      if (highlightDates.has(d.date)) {
        this.streakDayIndices.push(idx);
      }
    });
    if (this.streakDayIndices.length === 0) {
      this.streakDayIndices = [60, 61, 62, 63, 64, 65, 66];
    }

    const geom = GRID_PRESETS.sweep;
    const pts = this.streakDayIndices.map((idx) => {
      const d = ctx.days[idx] ?? ctx.days[0]!;
      return [
        geom.x + d.week_index * geom.p + geom.c / 2,
        geom.y + d.weekday * geom.p + geom.c / 2,
      ] as [number, number];
    });

    const pathD =
      pts.length > 1
        ? pts.map(([x, y], k) => `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
        : '';

    const nodesSvg = pts
      .map(
        ([x, y]) =>
          `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="#F4F03A" stroke="#111111" stroke-width="2.5"/>`
      )
      .join('');

    const gridAnnoHtml = this.ctx.grid
      ? this.ctx.grid.renderAnnotationsHtml(geom, { legend: false })
      : '';

    const pDigits = primaryFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const sDigits = secondaryFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const pHasDollar = /^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF|\$)/.test(primaryFact.formatted);
    const sHasDollar = /^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF|\$)/.test(secondaryFact.formatted);
    const primaryLabel = ctx.chapter.params.blocks?.[0]?.label || primaryFact.label;
    const secondaryLabel = ctx.chapter.params.blocks?.[1]?.label || secondaryFact.label;
    const tertiaryLabel = ctx.chapter.params.blocks?.[2]?.label || tertiaryFact.label;

    container.innerHTML = `
      <div class="ch-header-stack" style="left:60px;top:84px;max-width:1040px;max-height:330px">
        <div class="lab tx">${this.escapeHtml(ctx.chapter.params.kicker ?? 'THE STREAK')}</div>
        <div class="split tx" data-testid="chapter-headline" style="font-size:68px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;max-width:1040px">${this.escapeHtml(headlineText)}</div>
        <div class="tx" data-testid="chapter-body" style="max-width:1020px;font-size:16px;line-height:1.35;color:${isB2B ? '#C9C5BA' : '#F3F0E6'};${isB2B ? '' : 'background:#1C1C1B;border-left:4px solid #F4F03A;padding:12px 18px'}">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="streak-primary-block" style="position:absolute;left:1140px;top:84px;width:360px;height:340px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:26px;top:24px;right:22px;display:flex;justify-content:space-between;align-items:center">
          <span>${this.escapeHtml(primaryLabel)}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(primaryFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:22px;bottom:22px;font-size:132px">${pHasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(pDigits)}">${this.escapeHtml(pDigits)}</span></div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="streak-secondary-block" style="position:absolute;left:1516px;top:84px;width:340px;height:340px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:26px;top:24px;right:22px;display:flex;justify-content:space-between;align-items:center">
          <span>${this.escapeHtml(secondaryLabel)}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(secondaryFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:22px;bottom:22px;font-size:108px">${sHasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(sDigits)}">${this.escapeHtml(sDigits)}</span></div>
        <div class="lab dt" style="position:absolute;left:26px;bottom:148px;font-size:11px">${this.escapeHtml(tertiaryLabel)}: ${this.escapeHtml(tertiaryFact.formatted)}</div>
      </div>

      ${gridAnnoHtml}
      <svg class="dt" id="streak-svg" style="position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none">
        ${pathD ? `<path id="streak-chain" d="${pathD}" fill="none" stroke="#F4F03A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        ${nodesSvg}
      </svg>
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
      grid.setGridGeometry(GRID_PRESETS.sweep, { dur: 0.45 });
      const streakSet = new Set(this.streakDayIndices);
      grid.days.forEach((v, i) => {
        if (streakSet.has(i)) {
          grid.tweenColor(v, RGB_PALETTE.c1, 0.25, 0.1);
          grid.popVisual(v, 0.38, 0.1);
        } else {
          grid.tweenColor(v, RGB_PALETTE.dim, 0.25);
        }
      });
    }

    enterStageGroup(this.container, tl, 0, rm);

    const chainPath = this.container.querySelector<SVGPathElement>('#streak-chain');
    if (chainPath && !rm) {
      const len = 1800;
      tl.fromTo(
        chainPath,
        { strokeDasharray: len, strokeDashoffset: len },
        { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' },
        0.4
      );
    }
    timeline.logEvent('streak.play', this.streakDayIndices.length);
  }

  public explore(): void {
    this.ctx?.openExplore(this.ctx.chapter.params.focus_category);
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
