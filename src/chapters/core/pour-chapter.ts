import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
  Transaction,
} from '../../../contracts/index.js';
import { formatMoneyMinor } from '../../../contracts/index.js';
import {
  CATEGORY_COLORS,
  EASE,
  GRID_PRESETS,
  RGB_PALETTE,
  hexToRgb,
  type InteractiveGrid,
} from '../../grid/interactive-grid.js';
import {
  MOTION_TOKENS,
  enterStageGroup,
  exitStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';

export interface ExtendedChapterContext extends ChapterContext {
  grid?: InteractiveGrid;
  onReplayStory?: () => void;
}

const SCRAMBLE_GLYPHS = '#%$&@*/\\<>?+=0123456789ABCDEFGHJKLMNPRSTXZ';

function scrambleTail(str: string, startIdx: number, seedOffset: number): string {
  let out = '';
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === ' ') {
      out += ' ';
    } else {
      const idx = (i * 17 + seedOffset * 31) % SCRAMBLE_GLYPHS.length;
      out += SCRAMBLE_GLYPHS[idx] ?? '#';
    }
  }
  return out;
}

function formatWallRow(txn: Transaction, clean: boolean): string {
  const monthDay = txn.date.slice(5).replace('-', '');
  const dom = txn.date.slice(8, 10);
  const amtStr = formatMoneyMinor(txn.amount_minor, { showCents: true, prefix: '' });
  if (!clean) {
    const prefixNoise = ['POS ', 'DBT ', 'CARD ', 'PURCH ', ''][txn.amount_minor % 5] ?? '';
    const merchantUpper = txn.merchant.toUpperCase().replace(/[AEIOU]/g, '');
    const rawLabel = `${monthDay} ${prefixNoise}${merchantUpper}`.slice(0, 18).padEnd(18, ' ');
    return `${rawLabel}${('-' + amtStr).padStart(8, ' ')}`;
  }
  const cleanLabel = `${dom} ${txn.merchant}`.slice(0, 18).padEnd(18, ' ');
  return `${cleanLabel}${amtStr.padStart(8, ' ')}`;
}

function pickFact(ctx: ChapterContext, preferredIds: string[], fallbackIndex = 0): Fact {
  for (const id of preferredIds) {
    const f = ctx.facts.get(id);
    if (f) return f;
  }
  const fallbackId = ctx.chapter.fact_ids[fallbackIndex] ?? ctx.chapter.fact_ids[0];
  if (fallbackId && ctx.facts.has(fallbackId)) {
    return ctx.facts.get(fallbackId)!;
  }
  const first = ctx.facts.values().next().value;
  if (first) return first;
  return {
    id: 'fallback',
    label: 'Metric',
    value: 0,
    unit: 'count',
    formatted: '0',
    txn_ids: [],
    computation: 'Fallback metric',
  };
}

export class PourChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private pourState = { t: 0, active: false, done: false };
  private wallRows: Array<{
    j: number;
    col: number;
    row: number;
    txn: Transaction;
    rawRow: string;
    cleanRow: string;
    color: string;
    scrStart: number;
    colTime: number;
    st: number;
    cur: string;
    n: number;
    el: HTMLElement | null;
    aEl: HTMLElement | null;
    bEl: HTMLElement | null;
    lens?: {
      a: HTMLElement;
      b: HTMLElement;
      k: HTMLElement;
      last: string;
    };
  }> = [];
  private titlePts: Array<[number, number]> = [];
  private titleBox = { left: 420, top: 180, w: 1080, step: 9, tileSize: 8.5 };
  private currentYearText = '2025';

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const spendFact = pickFact(
      ctx,
      ['total_spend_usd', 'total_discretionary_spend', 'total_out_usd'],
      1
    );
    const countFact = pickFact(
      ctx,
      ['total_transactions_count', 'discretionary_transactions_count'],
      2
    );
    const paydayFact = pickFact(ctx, ['payday_count', 'salary_payments_count'], 0);

    const periodText = this.resolveDisplayPeriod(ctx);
    this.currentYearText = periodText;
    const isB2B = Boolean(ctx.plan.business_meta);

    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const spendBlockLabel =
      ctx.chapter.params.blocks?.[0]?.label ??
      ctx.plan.business_meta?.outflow_label ??
      (spendFact.label && spendFact.label !== 'Metric' ? spendFact.label : 'Total Outflow');
    const countBlockLabel =
      ctx.chapter.params.blocks?.[1]?.label ??
      (isB2B
        ? 'Ledger Movements'
        : countFact.label && countFact.label !== 'Metric'
          ? countFact.label
          : 'Transactions');
    const paydayBlockLabel =
      ctx.chapter.params.blocks?.[2]?.label ??
      ctx.plan.business_meta?.milestone_label ??
      (paydayFact.label && paydayFact.label !== 'Metric' ? paydayFact.label : 'Paydays');

    const sourceTxns =
      ctx.allTransactions.length > 0
        ? ctx.allTransactions.filter((t) => !t.is_transfer)
        : ctx.transactions;

    const rowCount = 880;
    this.wallRows = [];
    for (let j = 0; j < rowCount; j++) {
      const t = sourceTxns[j % Math.max(1, sourceTxns.length)]!;
      const col = Math.floor(j / 80);
      const row = j % 80;
      const rawRow = t ? formatWallRow(t, false) : '0101 POS COFFEE      -4.50';
      const cleanRow = t ? formatWallRow(t, true) : '01 Blue Bottle        4.50';
      const color = t ? (CATEGORY_COLORS[t.category] ?? '#F4F03A') : '#F4F03A';
      this.wallRows.push({
        j,
        col,
        row,
        txn: t,
        rawRow,
        cleanRow,
        color,
        scrStart: 1.05 + col * 0.09 + row * 0.004,
        colTime: 2.8 + (j / rowCount) * 1.65,
        st: 1,
        cur: rawRow,
        n: 0,
        el: null,
        aEl: null,
        bEl: null,
      });
    }

    let wallHtml = '<div id="wall" data-testid="pour-wall">';
    for (let c = 0; c < 11; c++) {
      wallHtml += `<div class="wcol" style="position:absolute;top:0;height:1080px;width:174.5px;left:${c * 174.5}px">`;
      for (let r = 0; r < 80; r++) {
        const j = c * 80 + r;
        const wr = this.wallRows[j]!;
        wallHtml += `<div class="wr" style="position:absolute;left:6px;top:${r * 13.5}px;width:168px;height:13.5px;font:500 10.5px/13.5px 'JetBrains Mono',monospace;white-space:pre;color:#8E8A7F;"><span class="a"></span><span class="b">${this.escapeHtml(wr.rawRow)}</span></div>`;
      }
      wallHtml += '</div>';
    }
    wallHtml += '</div>';

    const lensIndices = Array.from({ length: 11 }, (_, k) => 190 + k);
    const lensRowsHtml = lensIndices
      .map((j) => {
        const wr = this.wallRows[j]!;
        return `<div class="lr" style="font:500 22px/35px 'JetBrains Mono',monospace;white-space:pre;color:var(--ink)"><span class="a"></span><span class="b">${this.escapeHtml(wr.rawRow)}</span><i class="k" style="display:inline-block;width:12px;height:12px;margin-left:14px;vertical-align:1px"></i></div>`;
      })
      .join('');

    const grid = this.ctx.grid;
    const gridAnnoHtml = grid
      ? grid.renderAnnotationsHtml(GRID_PRESETS.open, { ribbon: true, legend: true })
      : '';
    const calloutHtml = grid ? grid.renderTopDayCalloutHtml(GRID_PRESETS.open) : '';

    const spendRawDigits = spendFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
    const lensRightTitle = isB2B ? 'COUNTERPARTY DECODING' : 'MERCHANT UNSCRAMBLE';
    const lensFooterText = isB2B
      ? 'Raw descriptor → normalized entity'
      : 'Merchant gibberish, unscrambled letter by letter';
    const ttlBPeriod = ctx.plan.business_meta?.fiscal_period_label ?? periodText;

    container.innerHTML = `
      ${wallHtml}
      <div class="blk" data-ax="l" id="lens" data-testid="pour-lens" style="position:absolute;left:1180px;top:150px;width:680px;height:560px;background:var(--c1);color:var(--ink);transform-origin:0 50%">
        <div class="lab tx" style="position:absolute;left:28px;top:24px">RAW → CLEAN</div>
        <div class="lab tx" style="position:absolute;right:28px;top:24px">${lensRightTitle}</div>
        <div class="tx" style="position:absolute;left:28px;top:84px">${lensRowsHtml}</div>
        <div class="lab tx" style="position:absolute;left:28px;bottom:22px;font-size:12px">${lensFooterText}</div>
      </div>
      <div id="ttl" data-testid="pour-year-title" class="abs" style="position:absolute;left:0;top:0;width:1920px;height:1080px;opacity:0;color:var(--bone);pointer-events:none">
        <canvas id="ttlt-canvas" width="1920" height="1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none"></canvas>
        <span id="ttlt" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">${this.escapeHtml(periodText)}</span>
      </div>
      <div id="ttlann" style="position:absolute;inset:0;pointer-events:none">
        <div class="lab tx" id="ttlA" style="position:absolute;left:0;right:0;top:130px;text-align:center;font-size:13px">${this.escapeHtml(ctx.plan.person_name)} · ${this.escapeHtml(ctx.plan.business_meta?.archetype_label ?? 'a year in money')}</div>
        <div class="lab tx" id="ttlB" style="position:absolute;left:0;right:0;top:675px;text-align:center;font-size:13px">${this.escapeHtml(ctx.allTransactions.length.toLocaleString())} movements → ${this.escapeHtml(ttlBPeriod)} operating grid</div>
      </div>
      <div id="opener" data-testid="pour-opener" style="position:absolute;inset:0;pointer-events:none">
        <div class="ch-header-stack" style="left:60px;top:58px;max-width:1180px;max-height:240px">
          ${ctx.chapter.params.kicker ? `<div class="lab tx" data-testid="chapter-kicker">${this.escapeHtml(ctx.chapter.params.kicker)}</div>` : ''}
          <div class="split tx" data-testid="chapter-headline" style="max-width:1180px;font-size:78px;font-weight:300;letter-spacing:-0.04em;line-height:1.04">${this.escapeHtml(headlineText)}</div>
          <div class="tx" data-testid="chapter-body" style="max-width:960px;font-size:16px;line-height:1.35;color:${isB2B ? '#C9C5BA' : 'var(--bone)'};${isB2B ? '' : 'background:rgba(243,240,230,0.06);border-left:3px solid var(--c1);padding:10px 14px'}">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--c1);margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
        </div>
        <div class="blk ia" data-ax="b" data-testid="metric-block-spend" style="position:absolute;left:1300px;top:64px;width:556px;height:284px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
          <div class="lab tx" style="position:absolute;left:30px;top:26px;right:24px;display:flex;justify-content:space-between;align-items:center">
            <span>${this.escapeHtml(spendBlockLabel)}</span>
            <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(spendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts (${spendFact.txn_ids.length})</button>
          </div>
          <div class="num tx" style="position:absolute;left:26px;bottom:24px;font-size:138px"><sup>${currencySup}</sup><span class="od" data-v="${this.escapeHtml(spendRawDigits)}">${this.escapeHtml(spendRawDigits)}</span></div>
        </div>
        <div class="blk ia" data-ax="b" data-testid="metric-block-count" style="position:absolute;left:1300px;top:360px;width:348px;height:168px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
          <div class="lab tx" style="position:absolute;left:24px;top:18px;right:18px;display:flex;justify-content:space-between;align-items:center">
            <span>${this.escapeHtml(countBlockLabel)}</span>
            <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(countFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 6px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
          </div>
          <div class="num tx" style="position:absolute;left:20px;bottom:14px;font-size:96px"><span class="od" data-v="${this.escapeHtml(countFact.formatted)}">${this.escapeHtml(countFact.formatted)}</span></div>
        </div>
        <div class="blk ia" data-ax="b" data-testid="metric-block-paydays" style="position:absolute;left:1660px;top:360px;width:196px;height:168px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
          <div class="lab tx" style="position:absolute;left:20px;top:18px">${this.escapeHtml(paydayBlockLabel)}</div>
          <div class="num tx" style="position:absolute;left:16px;bottom:14px;font-size:92px"><span class="od" data-v="${this.escapeHtml(paydayFact.formatted)}">${this.escapeHtml(paydayFact.formatted)}</span></div>
        </div>
        ${gridAnnoHtml}
        <div class="dt" id="callout" style="position:absolute">${calloutHtml}</div>
      </div>
    `;

    initOdometers(container);

    // Bind wall DOM references
    const wallEl = container.querySelector('#wall');
    if (wallEl) {
      this.wallRows.forEach((wr) => {
        const colEl = wallEl.children[wr.col];
        const rowEl = colEl?.children[wr.row] as HTMLElement | undefined;
        if (rowEl) {
          wr.el = rowEl;
          wr.aEl = rowEl.firstElementChild as HTMLElement;
          wr.bEl = rowEl.lastElementChild as HTMLElement;
        }
      });
    }

    const lensRowEls = Array.from(container.querySelectorAll<HTMLElement>('#lens .lr'));
    lensIndices.forEach((j, k) => {
      const e = lensRowEls[k];
      const wr = this.wallRows[j];
      if (e && wr) {
        wr.lens = {
          a: e.children[0] as HTMLElement,
          b: e.children[1] as HTMLElement,
          k: e.children[2] as HTMLElement,
          last: '',
        };
      }
    });

    // Bind receipt buttons
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

    this.computeTitlePoints(periodText);
  }

  private resolveDisplayPeriod(ctx: ChapterContext): string {
    const yearFact = pickFact(ctx, [ctx.plan.year_fact_id, 'year_number'], 0);
    const yearFactFormatted = yearFact.formatted?.trim();
    if (yearFactFormatted && /[–-]/.test(yearFactFormatted)) {
      return yearFactFormatted.replace(/^FY\s+/i, '');
    }
    const fiscalLabel = ctx.plan.business_meta?.fiscal_period_label?.trim();
    if (fiscalLabel) {
      const stripped = fiscalLabel.replace(/^FY\s+/i, '');
      if (stripped) return stripped;
    }
    if (ctx.allTransactions.length > 0) {
      let minY = 9999;
      let maxY = 0;
      for (const t of ctx.allTransactions) {
        const y = parseInt(t.date.slice(0, 4), 10);
        if (!Number.isNaN(y)) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (minY < maxY && minY !== 9999) {
        return `${minY}–${String(maxY).slice(-2)}`;
      }
    }
    if (yearFactFormatted) return yearFactFormatted;
    return String(ctx.plan.year || '2025');
  }

  private drawYearTitleCanvas(
    c: CanvasRenderingContext2D,
    yearText: string,
    fillStyle: string
  ): void {
    c.clearRect(0, 0, 1920, 1080);
    let fontSize = 460;
    c.font = `500 ${fontSize}px "Inter Tight", sans-serif`;
    const measured = c.measureText(yearText).width;
    if (measured > 1480) {
      fontSize = Math.max(220, Math.floor(fontSize * (1480 / measured)));
      c.font = `500 ${fontSize}px "Inter Tight", sans-serif`;
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = fillStyle;
    c.fillText(yearText, 960, 410);
  }

  private renderTitleCanvas(fillStyle: string): void {
    const canvas = this.container?.querySelector<HTMLCanvasElement>('#ttlt-canvas');
    if (!canvas) return;
    try {
      const c = canvas.getContext('2d');
      if (c) {
        this.drawYearTitleCanvas(c, this.currentYearText, fillStyle);
      }
    } catch {
      // Non-canvas test environment (jsdom)
    }
  }

  private computeTitlePoints(yearText: string): void {
    this.currentYearText = yearText;
    this.titlePts = [];
    this.renderTitleCanvas('#F3F0E6');
    const count = 880;
    const step = 9;
    this.titleBox.step = step;
    this.titleBox.tileSize = 8.5;

    try {
      const oc = document.createElement('canvas');
      oc.width = 1920;
      oc.height = 1080;
      const c = oc.getContext('2d');
      if (c) {
        this.drawYearTitleCanvas(c, yearText, '#ffffff');
        const img = c.getImageData(0, 0, 1920, 1080).data;
        const pts: Array<[number, number]> = [];
        let minX = 1920;
        let maxX = 0;
        for (let y = 140; y < 680; y += step) {
          for (let x = 160; x < 1760; x += step) {
            if ((img[(y * 1920 + x) * 4 + 3] ?? 0) > 140) {
              pts.push([x, y]);
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
            }
          }
        }
        if (pts.length >= 100) {
          this.titleBox.left = minX;
          this.titleBox.w = Math.max(200, maxX - minX);
          pts.sort((a, b) => a[0] + a[1] * 0.15 - (b[0] + b[1] * 0.15));
          for (let i = 0; i < count; i++) {
            const idx = Math.min(pts.length - 1, Math.floor(((i + 0.5) * pts.length) / count));
            this.titlePts.push(pts[idx]!);
          }
          return;
        }
      }
    } catch {
      // Fallback in non-canvas unit test environments (jsdom)
    }

    const startX = Math.round(960 - (43 * 22) / 2);
    const startY = Math.round(410 - (19 * 16) / 2);
    this.titleBox.left = startX;
    this.titleBox.w = 43 * 22;
    for (let i = 0; i < count; i++) {
      const col = i % 44;
      const row = Math.floor(i / 44);
      this.titlePts.push([startX + col * 22, startY + row * 16]);
    }
  }

  public play(timeline: TimelineController): void {
    if (!this.container || !this.ctx) return;
    const tl = (timeline as PlayerTimelineController).gsapTimeline ?? gsap.timeline();
    const rm = timeline.isReducedMotion();
    const grid = this.ctx.grid;

    this.pourState.t = 0;
    this.pourState.active = false;
    this.pourState.done = false;

    const wallEl = this.container.querySelector<HTMLElement>('#wall');
    const lensEl = this.container.querySelector<HTMLElement>('#lens');
    const ttlEl = this.container.querySelector<HTMLElement>('#ttl');
    const ttlAnnEl = this.container.querySelector<HTMLElement>('#ttlann');
    const openerEl = this.container.querySelector<HTMLElement>('#opener');

    if (grid) {
      grid.setGridGeometry(GRID_PRESETS.open, { instant: true });
      grid.hideAllParticles();
      if (rm) {
        grid.resetToBaseColors(true);
      } else {
        grid.days.forEach((v) => {
          v.k = 0;
          v.landedMinor = 0;
          v.nland = 0;
          v.A = null;
          v.pt = null;
        });
      }
    }

    if (rm) {
      if (wallEl) gsap.set(wallEl, { autoAlpha: 0 });
      if (lensEl) gsap.set(lensEl, { autoAlpha: 0 });
      this.renderTitleCanvas('#1C1C1B');
      if (ttlEl) gsap.set(ttlEl, { opacity: 1, color: '#1C1C1B' });
      if (openerEl) {
        enterStageGroup(openerEl, tl, 0, true);
      }
      timeline.logEvent('pour.reduced_motion', 880);
      return;
    }

    if (wallEl) wallEl.style.visibility = 'visible';
    this.wallRows.forEach((wr) => {
      wr.st = 1;
      wr.cur = wr.rawRow;
      wr.n = 0;
      if (wr.el) wr.el.style.visibility = '';
      if (wr.aEl) {
        wr.aEl.textContent = '';
        wr.aEl.style.color = '';
      }
      if (wr.bEl) {
        wr.bEl.textContent = wr.rawRow;
        wr.bEl.style.color = '';
      }
    });

    this.renderTitleCanvas('#F3F0E6');
    if (ttlEl) gsap.set(ttlEl, { opacity: 0, color: '#F3F0E6' });
    if (openerEl) {
      gsap.set(openerEl.querySelectorAll('.blk'), { scaleY: 0 });
      gsap.set(openerEl.querySelectorAll('.tx,.dt,.split'), { autoAlpha: 0 });
    }
    if (ttlAnnEl) {
      gsap.set(ttlAnnEl.querySelectorAll('.tx'), { autoAlpha: 0 });
    }
    if (lensEl) {
      gsap.set(lensEl, { scaleX: 0 });
      gsap.set(lensEl.querySelectorAll('.tx'), { autoAlpha: 0 });
    }

    const wcols = Array.from(this.container.querySelectorAll<HTMLElement>('.wcol'));
    if (wcols.length) {
      tl.fromTo(
        wcols,
        { clipPath: 'inset(0px 0px 1080px 0px)' },
        {
          clipPath: 'inset(0px 0px 0px 0px)',
          duration: 0.85,
          ease: 'power2.inOut',
          stagger: 0.045,
        },
        0
      );
    }

    tl.call(
      () => {
        this.pourState.active = true;
        timeline.logEvent('pour.wall', this.wallRows.length);
      },
      [],
      0
    );

    tl.to(
      this.pourState,
      {
        t: 11.5,
        duration: 11.5,
        ease: 'none',
        onUpdate: () => this.stepPourAnimation(),
      },
      0
    );

    if (lensEl) {
      enterStageGroup(lensEl, tl, 0.5, false);
      if (grid) {
        tl.to(grid, { lensBracketAlpha: 1, duration: 0.25 }, 0.95);
      }
      tl.call(() => timeline.logEvent('pour.scramble', this.wallRows.length), [], 1.05);
      tl.to(
        lensEl.querySelectorAll('.tx'),
        { autoAlpha: 0, duration: MOTION_TOKENS.tr.textOut },
        2.55
      );
      if (grid) {
        tl.to(grid, { lensBracketAlpha: 0, duration: 0.2 }, 2.55);
      }
      tl.to(lensEl, { scaleX: 0, duration: MOTION_TOKENS.tr.blockOut, ease: 'power3.in' }, 2.72);
    }

    tl.call(() => timeline.logEvent('pour.collapse', this.wallRows.length), [], 2.85);
    tl.call(() => timeline.logEvent('title.assemble', this.wallRows.length), [], 3.7);

    // Handoff particles -> crisp canvas title "2025" at exact same coordinates
    if (ttlEl) {
      tl.to(ttlEl, { opacity: 1, duration: 0.24, ease: 'power1.out' }, 5.2);
    }
    if (grid) {
      tl.to(grid, { particleAlpha: 0, duration: 0.24 }, 5.2);
      tl.call(
        () => {
          grid.hideAllParticles();
          timeline.logEvent('title.handoff', 'dom');
        },
        [],
        5.45
      );
    }

    if (ttlAnnEl) {
      tl.fromTo(
        ttlAnnEl.querySelectorAll('.tx'),
        { autoAlpha: 0, y: 14 },
        {
          autoAlpha: 1,
          y: 0,
          duration: MOTION_TOKENS.tr.textIn,
          ease: 'power3.out',
          stagger: 0.08,
        },
        5.5
      );
      tl.to(
        ttlAnnEl.querySelectorAll('.tx'),
        { autoAlpha: 0, duration: MOTION_TOKENS.tr.textOut },
        6.5
      );
    }

    // Dissolve "2025" into the 53x7 calendar grid
    tl.call(
      () => {
        if (wallEl) wallEl.style.visibility = 'hidden';
        this.renderTitleCanvas('#1C1C1B');
        this.dissolveTitleIntoGrid();
        timeline.logEvent('title.dissolve', 365);
      },
      [],
      6.7
    );

    if (ttlEl) {
      tl.to(ttlEl, { color: '#1C1C1B', duration: 0.3 }, 6.7);
    }

    if (openerEl) {
      tl.call(() => timeline.logEvent('opener.in'), [], 8.4);
      enterStageGroup(openerEl, tl, 8.4, false);
    }

    tl.call(
      () => {
        this.finishPourImmediately();
      },
      [],
      9.8
    );
  }

  private stepPourAnimation(): void {
    const t = this.pourState.t;
    for (const r of this.wallRows) {
      if (r.st === 1) {
        if (t >= r.scrStart) r.st = 2;
        else continue;
      }
      if (r.st === 2) {
        const q = (t - r.scrStart) / 0.4;
        if (q >= 1) {
          r.st = 3;
          this.updateWallRowText(r, r.cleanRow, 26, r.color, '');
        } else {
          const n = Math.floor(q * 26);
          const str = r.cleanRow.slice(0, n) + scrambleTail(r.cleanRow, n, Math.floor(t * 30));
          this.updateWallRowText(r, str, n, r.color, '#F3F0E6');
        }
      }
      if (r.st === 3 && t >= r.colTime) {
        r.st = 4;
        if (r.el) r.el.style.visibility = 'hidden';
        this.collapseRowToParticle(r);
      }
      if (r.lens && r.lens.last !== r.cur) {
        r.lens.last = r.cur;
        r.lens.a.textContent = r.cur.slice(0, r.n);
        r.lens.b.textContent = r.cur.slice(r.n);
        r.lens.a.style.color = '#111111';
        r.lens.k.style.background = r.st >= 3 ? r.color : 'transparent';
      }
    }
  }

  private updateWallRowText(
    r: (typeof this.wallRows)[number],
    str: string,
    n: number,
    colA: string,
    colB: string
  ): void {
    r.cur = str;
    r.n = n;
    if (r.aEl) {
      r.aEl.textContent = str.slice(0, n);
      r.aEl.style.color = colA;
    }
    if (r.bEl) {
      r.bEl.textContent = str.slice(n);
      r.bEl.style.color = colB;
    }
  }

  private collapseRowToParticle(r: (typeof this.wallRows)[number]): void {
    const grid = this.ctx?.grid;
    if (!grid) return;
    const p = grid.particles[r.j % Math.max(1, grid.particles.length)];
    if (!p) return;
    p.v = 1;
    p.F = null;
    p.A = null;
    p.pt = null;
    p.x = r.col * 174.5 + 88;
    p.y = r.row * 13.5 + 6.75;
    p.w = 160;
    p.h = 9;
    p.sc = 1;
    grid.setColorImmediate(p, hexToRgb(r.color));
    grid.tweenProp(p, 'w', 8, 0.14, 0, EASE.out3);
    grid.tweenProp(p, 'h', 8, 0.14, 0, EASE.out3);

    const [qx, qy] = this.titlePts[r.j % this.titlePts.length] ?? [960, 410];
    const d = 0.46 + ((r.j % 17) / 17) * 0.16;
    const arc = (r.j % 2 === 0 ? -1 : 1) * (0.12 + ((r.j % 11) / 11) * 0.16);
    grid.flyParticle(p, qx, qy, d, 0.14, arc, EASE.inOut3, (pp) => {
      grid.popVisual(pp, 0.35);
    });
    grid.tweenProp(p, 'w', this.titleBox.tileSize, d, 0.14, EASE.in2);
    grid.tweenProp(p, 'h', this.titleBox.tileSize, d, 0.14, EASE.in2);
    grid.tweenColor(p, RGB_PALETTE.bone, d * 0.7, 0.14 + d * 0.35);
  }

  private dissolveTitleIntoGrid(): void {
    const grid = this.ctx?.grid;
    if (!grid) return;
    grid.particleAlpha = 1;
    grid.activateParticles();
    const L = this.titleBox.left;
    const W = Math.max(100, this.titleBox.w);

    grid.particles.forEach((p, idx) => {
      const pt = this.titlePts[idx % this.titlePts.length] ?? [960, 410];
      p.v = 1;
      p.x = pt[0];
      p.y = pt[1];
      p.w = this.titleBox.tileSize;
      p.h = this.titleBox.tileSize;
      p.sc = 1;
      p.A = null;
      grid.setColorImmediate(p, RGB_PALETTE.bone);

      const dv = grid.days[p.dayIndex] ?? grid.days[0];
      if (!dv) return;
      const dl = Math.max(0, ((p.x - L) / W) * 0.95) + ((idx % 13) / 13) * 0.12;
      const d = 0.48 + ((idx % 9) / 9) * 0.14;
      const arc = (idx % 2 === 0 ? -1 : 1) * (0.1 + ((idx % 7) / 7) * 0.18);
      const catRgb = hexToRgb(CATEGORY_COLORS[p.txn.category] ?? '#F4F03A');

      grid.flyParticle(p, dv.x, dv.y, d, dl, arc, EASE.inOut3, (pp) => {
        pp.v = 0;
        if (dv.k < 0.01 && !(dv.A && dv.A.k)) {
          grid.tweenProp(dv, 'k', 1, MOTION_TOKENS.spring.settle, 0, EASE.spring);
        }
        grid.setColorImmediate(dv, catRgb);
        grid.tweenColor(dv, grid.getBaseColor(dv.index), 0.28, 0.04);
        grid.popVisual(dv, 0.14 + 0.32 * Math.min(1, p.txn.amount_minor / 12000));
      });
      grid.tweenColor(p, catRgb, d * 0.6, dl + 0.04);
      grid.tweenProp(p, 'w', grid.currentGeometry.c * 0.55, d, dl, EASE.in2);
      grid.tweenProp(p, 'h', grid.currentGeometry.c * 0.55, d, dl, EASE.in2);
    });
  }

  public finishPourImmediately(): void {
    if (this.pourState.done) return;
    this.pourState.active = false;
    this.pourState.done = true;
    const grid = this.ctx?.grid;
    if (grid) {
      grid.hideAllParticles();
      grid.lensBracketAlpha = 0;
      grid.resetToBaseColors(true);
    }
    const wallEl = this.container?.querySelector<HTMLElement>('#wall');
    if (wallEl) wallEl.style.visibility = 'hidden';
  }

  public explore(): void {
    this.finishPourImmediately();
    this.ctx?.openExplore();
  }

  public unmount(): void {
    this.finishPourImmediately();
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

export { exitStageGroup };
