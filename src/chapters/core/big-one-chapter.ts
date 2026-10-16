import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { formatMoneyMinor, getCategoryDisplayLabel } from '../../../contracts/index.js';
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
  const all = Array.from(ctx.facts.values());
  const f0 = fromIds[0] ?? all[0]!;
  const f1 = fromIds[1] ?? fromIds[0] ?? all[1] ?? f0;
  return [f0, f1];
}

export class BigOneChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const [primaryFact, secondaryFact] = getOrderedFacts(ctx);
    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const isB2B = Boolean(ctx.plan.business_meta);
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');

    const topTxn =
      ctx.transactions.slice().sort((a, b) => b.amount_minor - a.amount_minor)[0] ??
      ctx.allTransactions
        .filter((t) => t.direction === 'out' && !t.is_transfer)
        .sort((a, b) => b.amount_minor - a.amount_minor)[0];

    const pDigits = primaryFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const sDigits = secondaryFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const pHasDollar = /^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF|\$)/.test(primaryFact.formatted);
    const sHasDollar = /^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF|\$)/.test(secondaryFact.formatted);
    const primaryLabel = ctx.chapter.params.blocks?.[0]?.label || primaryFact.label;
    const secondaryLabel = ctx.chapter.params.blocks?.[1]?.label || secondaryFact.label;
    const scaleBlockLabel = isB2B
      ? 'PROPORTIONAL SCALE VS ROUTINE DISBURSEMENTS'
      : 'PROPORTIONAL SCALE VS EVERYDAY PURCHASES';

    // Proportional comparison bars: monolith vs 14 everyday purchases
    const everydayTxns = ctx.allTransactions
      .filter((t) => t.direction === 'out' && !t.is_transfer && t.id !== topTxn?.id)
      .slice(0, 14);
    const bigMinor = topTxn?.amount_minor ?? 100000;

    const comparisonBarsSvg = everydayTxns
      .map((t, k) => {
        const h = Math.max(8, Math.min(340, (t.amount_minor / Math.max(100, bigMinor)) * 340));
        return `<rect x="${k * 38}" y="${(360 - h).toFixed(1)}" width="28" height="${h.toFixed(1)}" fill="#111111"/>`;
      })
      .join('');

    const topCatLabel = topTxn
      ? getCategoryDisplayLabel(topTxn.category, ctx.plan.category_labels, isB2B).toUpperCase()
      : '';

    container.innerHTML = `
      <div class="ch-header-stack" style="left:60px;top:84px;max-width:1480px;max-height:290px">
        <div class="lab tx">${this.escapeHtml(ctx.chapter.params.kicker ?? 'THE BIG ONE')}</div>
        <div class="split tx" data-testid="chapter-headline" style="font-size:68px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;max-width:1480px">${this.escapeHtml(headlineText)}</div>
        <div class="tx" data-testid="chapter-body" style="max-width:1480px;font-size:16px;line-height:1.35;color:${isB2B ? '#C9C5BA' : '#F3F0E6'};${isB2B ? '' : 'background:#1C1C1B;border-left:4px solid #F4F03A;padding:12px 18px'}">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="big-one-monolith-block" style="position:absolute;left:64px;top:410px;width:680px;height:440px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:30px;top:24px;right:24px;display:flex;justify-content:space-between;align-items:center">
          <span>${this.escapeHtml(primaryLabel)}${topTxn ? ' · ' + this.escapeHtml(topTxn.merchant) : ''}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(primaryFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:24px;bottom:28px;font-size:156px">${pHasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(pDigits)}">${this.escapeHtml(pDigits)}</span></div>
        ${topTxn ? `<div class="lab dt" style="position:absolute;left:30px;top:64px;font-size:12px">${this.escapeHtml(topTxn.date)} · ${this.escapeHtml(topCatLabel)} · ${currencySup}${formatMoneyMinor(topTxn.amount_minor, { showCents: true, prefix: '' })}</div>` : ''}
      </div>

      <div class="blk ia" data-ax="b" data-testid="big-one-scale-block" style="position:absolute;left:764px;top:410px;width:620px;height:440px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:28px;top:24px">${scaleBlockLabel}</div>
        <svg class="dt" style="position:absolute;left:32px;bottom:28px" width="550" height="360">${comparisonBarsSvg}</svg>
      </div>

      <div class="blk ia" data-ax="b" style="position:absolute;left:1404px;top:410px;width:452px;height:440px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:28px;top:24px">${this.escapeHtml(secondaryLabel)}</div>
        <div class="num tx" style="position:absolute;left:24px;bottom:28px;font-size:120px">${sHasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(sDigits)}">${this.escapeHtml(sDigits)}</span></div>
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
      grid.days.forEach((v, i) => {
        if (i === grid.topDayIndex) {
          grid.tweenColor(v, RGB_PALETTE.c4, 0.25);
          grid.popVisual(v, 0.6);
        } else {
          grid.tweenColor(v, RGB_PALETTE.dim, 0.25);
        }
      });
    }

    enterStageGroup(this.container, tl, 0, rm);
    timeline.logEvent('big_one.play');
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
