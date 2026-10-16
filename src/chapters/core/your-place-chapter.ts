import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { EASE, GRID_PRESETS, RGB_PALETTE } from '../../grid/interactive-grid.js';
import {
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from './pour-chapter.js';

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const DOW_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DOW_NAMES = [
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
  'Sundays',
];

function pickFact(ctx: ChapterContext, ids: string[], fallbackIdx = 0): Fact {
  for (const id of ids) {
    const f = ctx.facts.get(id);
    if (f) return f;
  }
  const fb = ctx.chapter.fact_ids[fallbackIdx] ?? ctx.chapter.fact_ids[0];
  if (fb && ctx.facts.has(fb)) return ctx.facts.get(fb)!;
  return (
    ctx.facts.values().next().value ?? {
      id: 'fallback',
      label: 'Value',
      value: 0,
      unit: 'count',
      formatted: '0',
      txn_ids: [],
      computation: '',
    }
  );
}

export class YourPlaceChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private anchorDayIdx = 0;

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const merchantFact = pickFact(ctx, ['top_merchant_name', 'merchant_top_name'], 0);
    const visitsFact = pickFact(ctx, ['visits_top_merchant', 'top_merchant_visits'], 1);
    const spendFact = pickFact(ctx, ['spend_top_merchant', 'top_merchant_spend_usd'], 2);

    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const isB2B = Boolean(ctx.plan.business_meta);
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');

    const merchantName = ctx.chapter.params.focus_merchant ?? merchantFact.formatted;
    const placeTxns =
      ctx.transactions.length > 0
        ? ctx.transactions
        : ctx.allTransactions.filter((t) => t.merchant === merchantName);

    const visitDates = new Set(placeTxns.map((t) => t.date));
    const monthlyCounts = new Array<number>(12).fill(0);
    const weekdayCounts = new Array<number>(7).fill(0);

    placeTxns.forEach((t) => {
      const m = Math.max(0, Math.min(11, parseInt(t.date.slice(5, 7), 10) - 1));
      monthlyCounts[m] = (monthlyCounts[m] ?? 0) + 1;
      const dObj = new Date(`${t.date}T00:00:00Z`);
      const wd = (dObj.getUTCDay() + 6) % 7;
      weekdayCounts[wd] = (weekdayCounts[wd] ?? 0) + 1;
    });

    const maxMonth = Math.max(1, ...monthlyCounts);
    const maxWeekday = Math.max(1, ...weekdayCounts);
    const topWeekdayIdx = weekdayCounts.indexOf(maxWeekday);

    let dotsSvg = '';
    ctx.days.forEach((d, idx) => {
      if (visitDates.has(d.date) && this.anchorDayIdx === 0) {
        this.anchorDayIdx = idx;
      }
      const fill = visitDates.has(d.date) ? '#F4F03A' : '#3A3A38';
      dotsSvg += `<rect class="pd" x="${d.week_index * 10.2}" y="${d.weekday * 10.2}" width="7.8" height="7.8" fill="${fill}"/>`;
    });

    let moSvg = '';
    monthlyCounts.forEach((v, m) => {
      const h = (v / maxMonth) * 62;
      moSvg += `<rect class="pb" x="${m * 26}" y="${(70 - h).toFixed(1)}" width="18" height="${h.toFixed(1)}" fill="#F4F03A"/><text x="${m * 26 + 9}" y="86" fill="#F3F0E6" font-family="JetBrains Mono" font-size="9" text-anchor="middle">${MONTH_INITIALS[m]}</text>`;
    });

    let wdSvg = '';
    weekdayCounts.forEach((v, k) => {
      const h = (v / maxWeekday) * 185;
      wdSvg += `<rect class="pb" x="${k * 40}" y="${(200 - h).toFixed(1)}" width="30" height="${h.toFixed(1)}" fill="#111111"/><text x="${k * 40 + 15}" y="222" font-family="JetBrains Mono" font-size="13" text-anchor="middle" fill="#111111">${DOW_INITIALS[k]}</text>`;
    });

    const headlineFormatted =
      headlineText.length > 22
        ? this.escapeHtml(headlineText)
        : headlineText.includes(', ')
          ? this.escapeHtml(headlineText).replace(/,\s+/, ',<br>')
          : headlineText.includes(' ')
            ? this.escapeHtml(headlineText).replace(/\s+/, '<br>')
            : this.escapeHtml(headlineText);
    const headlineFontSize =
      headlineText.length <= 18
        ? 116
        : headlineText.length <= 32
          ? 82
          : headlineText.length <= 48
            ? 64
            : 52;
    const spendRawDigits = spendFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const visitsLabel = ctx.chapter.params.blocks?.[0]?.label || visitsFact.label;
    const spendLabel = ctx.chapter.params.blocks?.[1]?.label || spendFact.label;
    const calTitle = isB2B
      ? `Settlement calendar (${this.escapeHtml(visitsFact.formatted)} entries)`
      : `Ritual calendar (${this.escapeHtml(visitsFact.formatted)} visits)`;
    const moTitle = isB2B ? 'Activity by month' : 'Visits by month';
    const peakTitle = isB2B ? 'Peak day' : 'Peak ritual';

    container.innerHTML = `
      <div class="blk" data-anchor="1" id="pY" data-testid="your-place-hero-block" style="position:absolute;left:64px;top:68px;width:1068px;height:944px;background:var(--c1);color:var(--ink)">
        <div class="ch-header-stack" style="position:absolute;left:48px;right:48px;top:32px;bottom:208px;display:flex;flex-direction:column;justify-content:flex-start;gap:16px;overflow:hidden">
          <div class="lab tx">${this.escapeHtml(ctx.chapter.params.kicker ?? '03 · YOUR PLACE')}</div>
          <div class="split tx" data-testid="chapter-headline" style="font-size:${headlineFontSize}px;font-weight:300;letter-spacing:-0.045em;line-height:1.04">${headlineFormatted}</div>
          <div class="tx" data-testid="chapter-body" style="font-size:17px;line-height:1.35;background:#111111;color:#F3F0E6;border-left:4px solid #FF5A14;padding:12px 18px">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
        </div>
        <div class="blk" data-ax="b" id="pK" style="position:absolute;left:48px;right:48px;bottom:28px;height:170px;background:var(--ink);color:var(--bone);transform-origin:50% 100%">
          <div class="lab tx" style="position:absolute;left:22px;top:18px;font-size:12px">${calTitle}</div>
          <div class="lab tx" style="position:absolute;left:580px;top:18px;font-size:12px">${moTitle}</div>
          <svg class="dt" style="position:absolute;left:22px;top:54px" width="545" height="78">${dotsSvg}</svg>
          <svg class="dt" style="position:absolute;left:580px;top:48px" width="312" height="92">${moSvg}</svg>
          <button type="button" class="receipt-trigger dt ia" data-fact-id="${this.escapeHtml(visitsFact.id)}" style="position:absolute;right:22px;top:18px;font-family:'JetBrains Mono',monospace;font-size:11px;padding:8px 12px;border:1.5px solid #F3F0E6;background:#111;color:#F3F0E6;cursor:pointer;pointer-events:auto;">Receipts (${visitsFact.txn_ids.length})</button>
        </div>
      </div>
      <div class="blk ia" data-ax="b" id="pO" data-testid="your-place-visits-block" style="position:absolute;left:1148px;top:68px;width:708px;height:492px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:40px;top:28px">${this.escapeHtml(visitsLabel)}</div>
        <div class="num tx" style="position:absolute;left:36px;top:64px;font-size:380px;letter-spacing:-0.07em"><span class="od" data-v="${this.escapeHtml(visitsFact.formatted)}">${this.escapeHtml(visitsFact.formatted)}</span></div>
        <div class="lab dt" style="position:absolute;right:40px;top:28px;text-align:right">${peakTitle}<br>${DOW_NAMES[topWeekdayIdx] ?? 'Saturdays'}</div>
      </div>
      <div class="blk ia" data-ax="b" id="pP" data-testid="your-place-spend-block" style="position:absolute;left:1148px;top:576px;width:346px;height:436px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:32px;top:32px;right:24px;display:flex;justify-content:space-between;align-items:center">
          <span>${this.escapeHtml(spendLabel)}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(spendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:28px;bottom:92px;font-size:88px"><sup>${currencySup}</sup><span class="od" data-v="${this.escapeHtml(spendRawDigits)}">${this.escapeHtml(spendRawDigits)}</span></div>
        <div class="lab dt" style="position:absolute;left:32px;bottom:32px;font-size:12px">${this.escapeHtml(merchantName)} · ${isB2B ? 'ledger receipts' : 'verified receipts'}</div>
      </div>
      <div class="blk" data-ax="b" id="pL" style="position:absolute;left:1510px;top:576px;width:346px;height:436px;background:var(--lav);color:var(--ink);transform-origin:50% 100%">
        <div class="lab tx" style="position:absolute;left:34px;top:32px">By weekday</div>
        <svg class="dt" style="position:absolute;left:34px;top:154px" width="280" height="230">${wdSvg}</svg>
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

    const yb = this.container.querySelector<HTMLElement>('#pY');
    const otherBlks = Array.from(this.container.querySelectorAll<HTMLElement>('.blk:not(#pY)'));

    if (rm) {
      if (yb) gsap.set(yb, { autoAlpha: 1, clipPath: 'none' });
      enterStageGroup(this.container, tl, 0, true);
      return;
    }

    const merchantName =
      this.ctx.chapter.params.focus_merchant ??
      pickFact(this.ctx, ['top_merchant_name'], 0).formatted;
    const visitDates = new Set(
      (this.ctx.transactions.length > 0
        ? this.ctx.transactions
        : this.ctx.allTransactions.filter((t) => t.merchant === merchantName)
      ).map((t) => t.date)
    );

    if (yb) gsap.set(yb, { autoAlpha: 0 });
    gsap.set(this.container.querySelectorAll('.tx,.dt,.split'), { autoAlpha: 0 });
    gsap.set(otherBlks, { scaleY: 0 });

    if (grid) {
      grid.setGridGeometry(GRID_PRESETS.sweep, { dur: 0.4 });
      // 1) Highlight visit days on the 53x7 grid
      tl.call(
        () => {
          timeline.logEvent('place.highlight', visitDates.size);
          let k = 0;
          grid.days.forEach((v) => {
            if (visitDates.has(v.day.date)) {
              const dl = k++ * 0.006;
              grid.tweenColor(v, RGB_PALETTE.c1, 0.2, dl);
              grid.popVisual(v, 0.42, dl);
            } else {
              grid.tweenColor(v, RGB_PALETTE.dim, 0.28, v.day.week_index * 0.002);
            }
          });
        },
        [],
        0
      );

      // 2) Collapse non-anchor squares; morph anchor square into yellow hero block #pY
      tl.call(
        () => {
          grid.days.forEach((v, i) => {
            if (i !== this.anchorDayIdx) {
              grid.tweenProp(v, 'k', 0, 0.24, 0.015 * v.day.weekday, EASE.in2);
            }
          });
        },
        [],
        0.55
      );

      if (yb) {
        const v = grid.days[this.anchorDayIdx] ?? grid.days[0]!;
        const [ax, ay] = grid.getDayCoords(this.anchorDayIdx, v.day, GRID_PRESETS.sweep);
        const s = GRID_PRESETS.sweep.c;
        const relX = ax - 64;
        const relY = ay - 68;
        const ins = `inset(${Math.max(0, relY - s / 2)}px ${Math.max(0, 1068 - (relX + s / 2))}px ${Math.max(0, 944 - (relY + s / 2))}px ${Math.max(0, relX - s / 2)}px)`;
        tl.call(
          () => {
            v.k = 0;
            timeline.logEvent('place.morph', 'anchor-square');
          },
          [],
          0.85
        );
        tl.fromTo(
          yb,
          { autoAlpha: 1, clipPath: ins },
          {
            autoAlpha: 1,
            clipPath: 'inset(0px 0px 0px 0px)',
            duration: 0.56,
            ease: 'expo.inOut',
            immediateRender: false,
          },
          0.85
        );
      }
      enterStageGroup(this.container, tl, 1.35, false);
    } else {
      if (yb) gsap.set(yb, { autoAlpha: 1 });
      enterStageGroup(this.container, tl, 0, false);
    }
  }

  public explore(): void {
    const fallbackCat = this.ctx?.plan.business_meta ? undefined : 'coffee';
    this.ctx?.openExplore(this.ctx.chapter.params.focus_category ?? fallbackCat);
  }

  public unmount(): void {
    const grid = this.ctx?.grid;
    if (grid) {
      grid.resetToBaseColors(true);
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
