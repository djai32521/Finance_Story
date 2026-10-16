import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { formatMoneyMinor } from '../../../contracts/index.js';
import { GRID_PRESETS, RGB_PALETTE, hexToRgb } from '../../grid/interactive-grid.js';
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

export class GetawayChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private tripDates = new Set<string>();

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

    const tripTxns =
      ctx.transactions.length > 0
        ? ctx.transactions
        : ctx.allTransactions.filter(
            (t) => t.category === 'travel' || Boolean(t.fx) || t.raw_description.includes('INTL')
          );

    this.tripDates = new Set(ctx.chapter.params.highlight_dates ?? tripTxns.map((t) => t.date));

    const topTripMerchants = tripTxns
      .slice()
      .sort((a, b) => b.amount_minor - a.amount_minor)
      .slice(0, 6);

    const merchantRowsHtml = topTripMerchants
      .map(
        (t) =>
          `<div class="rc" style="font:500 13.5px/1.1 'JetBrains Mono',monospace;display:flex;gap:8px;padding:7px 0;align-items:baseline;width:100%;overflow:hidden;">
            <span style="white-space:nowrap;flex-shrink:0">${this.escapeHtml(t.date.slice(5))}</span>
            <span style="font-weight:600;white-space:nowrap;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${this.escapeHtml(t.merchant)}</span>
            <span style="white-space:nowrap;flex-shrink:0">${currencySup}${formatMoneyMinor(t.amount_minor, { showCents: true, prefix: '' })}</span>
          </div>`
      )
      .join('');

    const pDigits = primaryFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const sDigits = secondaryFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const pHasDollar = /^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF|\$)/.test(primaryFact.formatted);
    const sHasDollar = /^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF|\$)/.test(secondaryFact.formatted);
    const primaryLabel = ctx.chapter.params.blocks?.[0]?.label || primaryFact.label;
    const secondaryLabel = ctx.chapter.params.blocks?.[1]?.label || secondaryFact.label;

    const gridAnnoHtml = this.ctx.grid
      ? this.ctx.grid.renderAnnotationsHtml(GRID_PRESETS.sweep, { legend: false })
      : '';

    container.innerHTML = `
      <div class="ch-header-stack" style="left:60px;top:84px;max-width:940px;max-height:330px">
        <div class="lab tx">${this.escapeHtml(ctx.chapter.params.kicker ?? 'THE GETAWAY')}</div>
        <div class="split tx" data-testid="chapter-headline" style="font-size:66px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;max-width:940px">${this.escapeHtml(headlineText)}</div>
        <div class="tx" data-testid="chapter-body" style="max-width:940px;font-size:16px;line-height:1.35;color:${isB2B ? '#C9C5BA' : '#F3F0E6'};${isB2B ? '' : 'background:#1C1C1B;border-left:4px solid #F4F03A;padding:12px 18px'}">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="getaway-primary-block" style="position:absolute;left:1040px;top:76px;width:410px;height:360px;background:#6E8BFF;color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center">
          <span>${this.escapeHtml(primaryLabel)}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(primaryFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:22px;bottom:24px;font-size:112px">${pHasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(pDigits)}">${this.escapeHtml(pDigits)}</span></div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="getaway-secondary-block" style="position:absolute;left:1466px;top:76px;width:390px;height:360px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:24px;top:22px;right:20px;display:flex;justify-content:space-between;align-items:center">
          <span>${this.escapeHtml(secondaryLabel)} (${this.escapeHtml(sHasDollar ? (ctx.plan.business_meta?.currency_symbol ?? 'US$') + sDigits : sDigits)})</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(tertiaryFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="tx" style="position:absolute;left:24px;top:64px;right:24px">${merchantRowsHtml}</div>
      </div>

      ${gridAnnoHtml}
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
      const travelRgb = hexToRgb('#6E8BFF');
      grid.days.forEach((v) => {
        if (this.tripDates.has(v.day.date)) {
          grid.tweenColor(v, travelRgb, 0.25, 0.08);
          grid.popVisual(v, 0.45, 0.08);
          grid.addRing(v.x, v.y, { r1: 72, d: 0.55, c: '#6E8BFF' });
        } else {
          grid.tweenColor(v, RGB_PALETTE.dim, 0.25);
        }
      });
    }

    enterStageGroup(this.container, tl, 0, rm);
    timeline.logEvent('getaway.play', this.tripDates.size);
  }

  public explore(): void {
    this.ctx?.openExplore(this.ctx.chapter.params.focus_category ?? 'travel');
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
