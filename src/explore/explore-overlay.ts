import gsap from 'gsap';
import type { Category, Day, Transaction } from '../../contracts/index.js';
import { formatMoneyMinor, getCategoryDisplayLabel } from '../../contracts/index.js';
import { DayFlipCard } from '../grid/day-flip-card.js';
import { DragSelector, type RangeAggregationResult } from '../grid/drag-selector.js';
import {
  DISPLAY_CATEGORIES,
  EASE,
  GRID_PRESETS,
  formatDayLabel,
  type InteractiveGrid,
} from '../grid/interactive-grid.js';
import { ScrubBar } from '../grid/scrub-bar.js';

export interface ExploreOverlayCallbacks {
  onCloseExplore: () => void;
  onOpenReceipts: (title: string, txnIds: string[]) => void;
  onOpenAsk: (prefillQuestion?: string) => void;
  onExportShareCard: (size?: '1080x1350' | '1080x1920') => Promise<string>;
  onLogEvent?: (type: string, value?: Record<string, unknown> | string | number) => void;
  getStageScale: () => number;
  getStageElement: () => HTMLElement;
}

export class ExploreOverlay {
  public readonly underLayerEl: HTMLElement;
  public readonly overLayerEl: HTMLElement;
  private readonly grid: InteractiveGrid;
  private readonly callbacks: ExploreOverlayCallbacks;
  public readonly flipCard: DayFlipCard;
  public readonly dragSelector: DragSelector;
  public readonly scrubBar: ScrubBar;

  private readonly tipEl: HTMLElement;
  private readonly tipX: gsap.QuickToFunc;
  private readonly tipY: gsap.QuickToFunc;

  private activeState = false;
  private hoveredDayIndex = -1;
  private lastSelectionSummary: RangeAggregationResult | null = null;
  private lastLensTxnIds: string[] = [];
  private lastLensTitle = 'All Categories';
  private categoryLabels: Record<string, string> = {};
  private isB2B = false;
  private currencySymbol = 'US$';

  constructor(
    underParent: HTMLElement,
    overParent: HTMLElement,
    chromeParent: HTMLElement,
    grid: InteractiveGrid,
    callbacks: ExploreOverlayCallbacks
  ) {
    this.grid = grid;
    this.callbacks = callbacks;

    this.underLayerEl = document.createElement('div');
    this.underLayerEl.className = 'ch';
    this.underLayerEl.id = 'u-explore';
    this.underLayerEl.style.cssText =
      'position:absolute;inset:0;visibility:hidden;pointer-events:none;';
    this.underLayerEl.innerHTML = `<div class="num gh" style="position:absolute;right:30px;top:600px;font-size:520px;color:var(--ghost, #1C1C1B)"><sup id="exghost-sup" style="font-size:60px;margin-top:0.5em">US$</sup><span id="exghost">0</span></div>`;
    underParent.appendChild(this.underLayerEl);

    this.overLayerEl = document.createElement('div');
    this.overLayerEl.className = 'ch';
    this.overLayerEl.id = 'o-explore';
    this.overLayerEl.dataset.testid = 'explore-overlay';
    this.overLayerEl.style.cssText =
      'position:absolute;inset:0;visibility:hidden;pointer-events:none;';
    overParent.appendChild(this.overLayerEl);

    let tip = chromeParent.querySelector<HTMLElement>('#tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'tip';
      tip.style.cssText =
        'position:absolute;left:0;top:0;background:var(--bone, #F3F0E6);color:var(--ink, #111111);font:500 13px/1.45 "JetBrains Mono",monospace;letter-spacing:0.06em;text-transform:uppercase;padding:10px 13px;pointer-events:none;opacity:0;white-space:nowrap;border:1.5px solid #111;z-index:30;';
      chromeParent.appendChild(tip);
    }
    this.tipEl = tip;
    this.tipX = gsap.quickTo(this.tipEl, 'x', { duration: 0.16, ease: 'power3.out' });
    this.tipY = gsap.quickTo(this.tipEl, 'y', { duration: 0.16, ease: 'power3.out' });

    let pill = chromeParent.querySelector<HTMLElement>('#pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'pill';
      pill.dataset.testid = 'drag-pill';
      pill.style.cssText =
        'position:absolute;left:0;top:0;background:var(--c1, #F4F03A);color:var(--ink, #111111);padding:10px 14px 9px;pointer-events:none;opacity:0;white-space:nowrap;border:1.5px solid #111;z-index:30;';
      pill.innerHTML = `<div class="num" style="font-size:40px"><sup id="pillsup">US$</sup><span id="pillv">0</span></div><div class="lab" id="pilll" style="font-size:11px;position:static;margin-top:4px"></div>`;
      chromeParent.appendChild(pill);
    }

    this.scrubBar = new ScrubBar(this.grid, {
      onLogEvent: this.callbacks.onLogEvent,
    });

    this.buildDom();

    this.flipCard = new DayFlipCard(this.overLayerEl, {
      onOpenReceipts: (title, ids) => this.callbacks.onOpenReceipts(title, ids),
      onLogEvent: this.callbacks.onLogEvent,
    });

    const pillValEl = pill.querySelector<HTMLElement>('#pillv')!;
    const pillLabEl = pill.querySelector<HTMLElement>('#pilll')!;
    this.dragSelector = new DragSelector(this.grid, pill, pillValEl, pillLabEl, {
      onSingleClickDay: (dayIdx) => {
        const dv = this.grid.days[dayIdx];
        if (dv) {
          this.flipCard.open(dv, GRID_PRESETS.explore);
        }
      },
      onRangeSelected: (summary) => this.showSelectionSummary(summary),
      onLogEvent: this.callbacks.onLogEvent,
    });
  }

  private buildDom(): void {
    const chipsHtml = [
      `<button type="button" class="chip mag" data-cat="" aria-pressed="true" data-testid="lens-chip-all"><i style="background:var(--bone);outline:1px solid #111"></i>All</button>`,
      ...DISPLAY_CATEGORIES.map(
        (c) =>
          `<button type="button" class="chip mag" data-cat="${c.key}" aria-pressed="false" data-testid="lens-chip-${c.key.replace(/\s+/g, '-')}"><i style="background:${c.color}"></i>${c.label}</button>`
      ),
    ].join('');

    this.overLayerEl.innerHTML = `
      <div class="lab tx" style="position:absolute;left:64px;top:92px">EXPLORE YOUR YEAR</div>
      <div class="lab tx" style="position:absolute;left:64px;top:122px;font-size:12px">Hover a day · click to flip · drag to add up · tap a lens · scrub to replay</div>
      <div class="tx ia" style="position:absolute;right:64px;top:88px;display:flex;gap:10px;pointer-events:auto;">
        <button type="button" class="btn" id="explore-lens-receipts-btn" data-testid="explore-receipts-btn" style="border-color:var(--bone);color:var(--bone)">Receipts</button>
        <button type="button" class="btn" id="explore-ask-btn" data-testid="explore-ask-btn" style="border-color:var(--bone);color:var(--bone)">Ask your year [A]</button>
        <button type="button" class="btn" id="explore-share-btn" data-testid="explore-share-btn" style="border-color:var(--bone);color:var(--bone)">Export PNG</button>
        <button type="button" class="btn primary" id="explore-close-btn" data-testid="explore-close-btn" style="background:var(--c1);color:var(--ink);border-color:var(--c1)">← Back to story</button>
      </div>
      <div class="tx ia" id="chips" data-testid="category-lens-bar" style="position:absolute;left:160px;top:186px;display:flex;gap:9px;flex-wrap:wrap;width:1620px;pointer-events:auto;">
        ${chipsHtml}
      </div>
      ${this.grid.renderAnnotationsHtml(GRID_PRESETS.explore, { legend: false })}
      ${this.scrubBar.renderControlsHtml(GRID_PRESETS.explore)}
      <div class="lab tx" style="position:absolute;left:160px;top:766px" id="exday-kicker">HOVERED DAY</div>
      <div class="tx" id="exday" data-testid="explore-day-readout" style="position:absolute;left:160px;top:798px;font-size:68px;font-weight:300;letter-spacing:-0.035em;white-space:nowrap">—</div>
      <div class="lab tx" id="exdet" data-testid="explore-detail-readout" style="position:absolute;left:160px;top:886px;font-size:13px;width:960px">Move over the grid or tap a category chip</div>
      <div class="blk later" data-ax="b" id="exsel" data-testid="explore-selection-block" style="position:absolute;left:1220px;top:720px;width:636px;height:296px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;transform:scaleY(0)">
        <div class="lab tx" style="position:absolute;left:28px;top:22px;right:28px;display:flex;justify-content:space-between;align-items:center">
          <span id="exsel-title">SELECTION</span>
          <button type="button" id="exsel-receipts-btn" data-testid="selection-receipts-btn" style="font-family:'JetBrains Mono',monospace;font-size:11px;padding:6px 12px;background:#111;color:#F3F0E6;cursor:pointer;pointer-events:auto;">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:22px;top:66px;font-size:120px"><sup id="exselsup">US$</sup><span id="exselv">0</span></div>
        <div class="lab tx" id="exsell" style="position:absolute;left:28px;bottom:22px;font-size:12px"></div>
      </div>
    `;

    this.scrubBar.bindElements(this.overLayerEl);

    const chips = Array.from(this.overLayerEl.querySelectorAll<HTMLButtonElement>('#chips .chip'));
    for (const btn of chips) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cat = (btn.dataset.cat ?? '') as Category | '';
        this.selectCategoryLens(cat, btn);
      });
    }

    this.overLayerEl.querySelector('#explore-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onCloseExplore();
    });

    this.overLayerEl.querySelector('#explore-ask-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onOpenAsk();
    });

    this.overLayerEl.querySelector('#explore-share-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.callbacks.onExportShareCard('1080x1350');
    });

    this.overLayerEl.querySelector('#explore-lens-receipts-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const ids =
        this.lastLensTxnIds.length > 0
          ? this.lastLensTxnIds
          : this.grid.days.flatMap((d) => d.day.txn_ids);
      this.callbacks.onOpenReceipts(this.lastLensTitle, ids);
    });

    this.overLayerEl.querySelector('#exsel-receipts-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.lastSelectionSummary) {
        this.callbacks.onOpenReceipts(
          `${this.lastSelectionSummary.startLabel} → ${this.lastSelectionSummary.endLabel} (${this.lastSelectionSummary.dayCount} days)`,
          this.lastSelectionSummary.txnIds
        );
      } else if (this.lastLensTxnIds.length > 0) {
        this.callbacks.onOpenReceipts(this.lastLensTitle, this.lastLensTxnIds);
      }
    });
  }

  private getDisplayCategoryLabel(cat: Category): string {
    if (this.categoryLabels[cat] || this.isB2B) {
      return getCategoryDisplayLabel(cat, this.categoryLabels, this.isB2B);
    }
    return DISPLAY_CATEGORIES.find((c) => c.key === cat)?.label ?? cat;
  }

  public setDataset(
    _days: readonly Day[],
    _transactions: readonly Transaction[],
    categoryLabels?: Record<string, string>,
    isB2B?: boolean,
    currencySymbol?: string
  ): void {
    this.categoryLabels = categoryLabels ? { ...categoryLabels } : {};
    this.isB2B = Boolean(isB2B);
    this.currencySymbol = currencySymbol ?? 'US$';
    this.flipCard.currencySymbol = this.currencySymbol;
    const exghostSup = this.underLayerEl.querySelector<HTMLElement>('#exghost-sup');
    if (exghostSup) exghostSup.textContent = this.currencySymbol;
    const exselSup = this.overLayerEl.querySelector<HTMLElement>('#exselsup');
    if (exselSup) exselSup.textContent = this.currencySymbol;
    const pillSup = this.tipEl.parentElement?.querySelector<HTMLElement>('#pillsup');
    if (pillSup) pillSup.textContent = this.currencySymbol;
    const chips = Array.from(this.overLayerEl.querySelectorAll<HTMLButtonElement>('#chips .chip'));
    for (const btn of chips) {
      const cat = (btn.dataset.cat ?? '') as Category | '';
      if (!cat) continue;
      const spec = DISPLAY_CATEGORIES.find((c) => c.key === cat);
      const color = spec?.color ?? '#F4F03A';
      const label = this.getDisplayCategoryLabel(cat);
      btn.innerHTML = `<i style="background:${color}"></i>${label}`;
    }
  }

  public isActive(): boolean {
    return this.activeState;
  }

  public open(initialCategory?: Category): void {
    this.activeState = true;
    this.flipCard.reducedMotion = this.grid.reducedMotion;
    this.scrubBar.pos = Math.max(0, this.grid.days.length - 1);
    this.scrubBar.playing = false;
    this.scrubBar.activeLens = initialCategory ?? '';

    this.grid.hideAllParticles();
    this.grid.daysVisible = true;
    this.grid.setGridGeometry(GRID_PRESETS.explore, { dur: 0.45 });
    this.grid.resetToBaseColors();

    gsap.set([this.underLayerEl, this.overLayerEl], { autoAlpha: 1 });
    const exsel = this.overLayerEl.querySelector<HTMLElement>('#exsel');
    if (exsel) {
      gsap.set(exsel, { scaleY: 0 });
    }
    this.scrubBar.drawScrubPlayhead(GRID_PRESETS.explore);

    const allTxnIds = this.grid.days.flatMap((d) => d.txns.map((t) => t.id));
    const firstYear = this.grid.days[0]?.day.date.slice(0, 4) ?? '2025';
    const lastYear = this.grid.days[this.grid.days.length - 1]?.day.date.slice(0, 4) ?? firstYear;
    const yearStr = firstYear !== lastYear ? `${firstYear}–${lastYear.slice(-2)}` : firstYear;
    this.lastLensTxnIds = allTxnIds;
    this.lastLensTitle = `All ${yearStr} Purchases`;

    if (initialCategory) {
      this.selectCategoryLens(initialCategory);
    } else {
      this.updateChipPressedStates('');
    }

    this.callbacks.onLogEvent?.('explore.open', initialCategory ?? 'all');
  }

  public close(): void {
    if (!this.activeState) return;
    this.activeState = false;
    this.scrubBar.pauseReplay();
    this.dragSelector.clearSelection();
    this.flipCard.close(true);
    this.hideTooltip();
    this.grid.clearHover();
    gsap.set([this.underLayerEl, this.overLayerEl], { autoAlpha: 0 });
    this.callbacks.onLogEvent?.('explore.close');
  }

  public selectCategoryLens(cat: Category | '', sourceBtn?: HTMLElement): void {
    this.scrubBar.activeLens = cat;
    this.updateChipPressedStates(cat);

    let ox = 420;
    let oy = 210;
    if (sourceBtn) {
      const r = sourceBtn.getBoundingClientRect();
      const sr = this.callbacks.getStageElement().getBoundingClientRect();
      const s = this.callbacks.getStageScale() || 1;
      ox = (r.left + r.width / 2 - sr.left) / s;
      oy = (r.top + r.height / 2 - sr.top) / s;
    }

    const res = this.grid.applyCategoryLensWave(cat, ox, oy, this.scrubBar.pos);
    this.lastLensTxnIds = res.matchingTxnIds;
    const catLabel = cat ? this.getDisplayCategoryLabel(cat) : 'All Categories';
    this.lastLensTitle = `${catLabel} — ${res.count} purchases`;

    const exdayKicker = this.overLayerEl.querySelector<HTMLElement>('#exday-kicker');
    const exdayEl = this.overLayerEl.querySelector<HTMLElement>('#exday');
    const exdetEl = this.overLayerEl.querySelector<HTMLElement>('#exdet');
    const exghostEl = this.underLayerEl.querySelector<HTMLElement>('#exghost');

    const firstYear = this.grid.days[0]?.day.date.slice(0, 4) ?? '2025';
    const lastYear = this.grid.days[this.grid.days.length - 1]?.day.date.slice(0, 4) ?? firstYear;
    const yearStr = firstYear !== lastYear ? `${firstYear}–${lastYear.slice(-2)}` : firstYear;
    const formattedTotal = formatMoneyMinor(res.totalMinor, { showCents: false, prefix: '' });
    if (exdayKicker) {
      exdayKicker.textContent = cat
        ? `CATEGORY LENS · ${catLabel.toUpperCase()}`
        : 'ALL CATEGORIES';
    }
    if (exdayEl) {
      const readoutText = `${catLabel} · ${this.currencySymbol}${formattedTotal}`;
      exdayEl.textContent = readoutText;
      exdayEl.style.fontSize =
        readoutText.length > 28 ? '46px' : readoutText.length > 22 ? '56px' : '68px';
    }
    if (exdetEl) {
      exdetEl.textContent = `${res.count} purchase${res.count === 1 ? '' : 's'} across ${yearStr} · Click "Receipts" to inspect every transaction`;
    }
    if (exghostEl) {
      exghostEl.textContent = formatMoneyMinor(res.totalMinor, { showCents: false, prefix: '' });
    }

    this.callbacks.onLogEvent?.('explore.lens', cat || 'all');
  }

  private updateChipPressedStates(cat: Category | ''): void {
    const chips = Array.from(this.overLayerEl.querySelectorAll<HTMLButtonElement>('#chips .chip'));
    for (const b of chips) {
      b.setAttribute('aria-pressed', (b.dataset.cat ?? '') === cat ? 'true' : 'false');
    }
  }

  public showSelectionSummary(summary: RangeAggregationResult): void {
    this.lastSelectionSummary = summary;
    const exsel = this.overLayerEl.querySelector<HTMLElement>('#exsel');
    const exselv = this.overLayerEl.querySelector<HTMLElement>('#exselv');
    const exsell = this.overLayerEl.querySelector<HTMLElement>('#exsell');
    const exselTitle = this.overLayerEl.querySelector<HTMLElement>('#exsel-title');

    if (!exsel || !exselv || !exsell) return;

    if (exselTitle) {
      exselTitle.textContent = `SELECTION · ${summary.dayCount} DAYS`;
    }
    const selFormatted = formatMoneyMinor(summary.discretionaryOutMinor, {
      showCents: false,
      prefix: '',
    });
    exselv.textContent = selFormatted;
    if (exselv.parentElement) {
      exselv.parentElement.style.fontSize =
        selFormatted.length >= 9 ? '88px' : selFormatted.length >= 7 ? '104px' : '120px';
    }
    const dailyAvgDigits = summary.formattedDailyAvg.replace(/^\$/, '');
    exsell.textContent = `${summary.dayCount} DAYS · ${summary.txnIds.length} ITEMS · ${summary.startLabel.toUpperCase()} → ${summary.endLabel.toUpperCase()} · ${this.currencySymbol}${dailyAvgDigits}/DAY`;

    gsap.killTweensOf(exsel);
    if (
      this.grid.reducedMotion ||
      (typeof document !== 'undefined' && document.body.classList.contains('film'))
    ) {
      gsap.set(exsel, { scaleY: 1, autoAlpha: 1 });
    } else {
      gsap.fromTo(
        exsel,
        { scaleY: 0, autoAlpha: 1 },
        { scaleY: 1, duration: 0.48, ease: EASE.soft }
      );
    }
  }

  public handlePointerMove(stageX: number, stageY: number): void {
    if (!this.activeState) return;
    if (this.scrubBar.scrubbing) {
      this.scrubBar.scrubToStageX(stageX, GRID_PRESETS.explore);
      return;
    }

    const hitIdx = this.grid.applyHoverMagnification(stageX, stageY);
    if (this.dragSelector.onPointerMove(stageX, stageY, hitIdx)) {
      return;
    }

    if (hitIdx !== this.hoveredDayIndex) {
      this.hoveredDayIndex = hitIdx;
      if (hitIdx >= 0) {
        const dv = this.grid.days[hitIdx]!;
        const dayLabel = formatDayLabel(dv.day);
        const spendFormatted = formatMoneyMinor(dv.day.discretionary_out_minor, {
          showCents: true,
          prefix: '',
        });
        const topMerchants = dv.txns
          .slice()
          .sort((a, b) => b.amount_minor - a.amount_minor)
          .slice(0, 3)
          .map((t) => t.merchant)
          .filter((m, idx, arr) => arr.indexOf(m) === idx);

        const paydayBadge = dv.day.is_payday ? (this.isB2B ? ' · SETTLEMENT' : ' · PAYDAY') : '';
        this.tipEl.innerHTML = `<b style="font-weight:600;display:block;font-size:15px">${dayLabel}</b>${this.currencySymbol}${spendFormatted} · ${dv.txns.length} purchase${dv.txns.length === 1 ? '' : 's'}${paydayBadge}${topMerchants.length ? '<br>' + topMerchants.join(' · ') : ''}`;
        gsap.to(this.tipEl, { autoAlpha: 1, duration: 0.12 });

        const exdayKicker = this.overLayerEl.querySelector<HTMLElement>('#exday-kicker');
        const exdayEl = this.overLayerEl.querySelector<HTMLElement>('#exday');
        const exdetEl = this.overLayerEl.querySelector<HTMLElement>('#exdet');
        const exghostEl = this.underLayerEl.querySelector<HTMLElement>('#exghost');

        if (exdayKicker) exdayKicker.textContent = 'HOVERED DAY';
        if (exdayEl) {
          exdayEl.textContent = dayLabel;
          exdayEl.style.fontSize = '68px';
        }
        if (exdetEl) {
          exdetEl.textContent = `${this.currencySymbol}${spendFormatted} across ${dv.txns.length} purchase${dv.txns.length === 1 ? '' : 's'}${topMerchants.length ? ' · ' + topMerchants.join(', ') : ''}`;
        }
        if (exghostEl) {
          exghostEl.textContent = formatMoneyMinor(dv.day.discretionary_out_minor, {
            showCents: false,
            prefix: '',
          });
        }
        this.callbacks.onLogEvent?.('explore.hover', {
          day: dayLabel,
          spend: +(dv.day.discretionary_out_minor / 100).toFixed(2),
        });
      } else {
        this.hideTooltip();
      }
    }

    if (hitIdx >= 0) {
      const offsetX = stageX > 1480 ? -this.tipEl.offsetWidth - 22 : 22;
      this.tipX(stageX + offsetX);
      this.tipY(Math.max(40, stageY + 22));
    }
  }

  public handlePointerDown(stageX: number, stageY: number): void {
    if (!this.activeState) return;
    if (this.flipCard.isOpen()) {
      this.flipCard.close();
    }
    if (this.scrubBar.isHitScrubTrack(stageX, stageY, GRID_PRESETS.explore)) {
      this.scrubBar.scrubbing = true;
      this.scrubBar.pauseReplay();
      this.scrubBar.scrubToStageX(stageX, GRID_PRESETS.explore);
      this.callbacks.onLogEvent?.('explore.scrub.start', this.scrubBar.pos);
      return;
    }

    const hitIdx = this.grid.hitTestDay(stageX, stageY, GRID_PRESETS.explore);
    if (hitIdx >= 0) {
      const exsel = this.overLayerEl.querySelector<HTMLElement>('#exsel');
      if (exsel) gsap.to(exsel, { scaleY: 0, duration: 0.2 });
      this.dragSelector.onPointerDown(hitIdx);
    }
  }

  public handlePointerUp(): void {
    if (!this.activeState) return;
    if (this.scrubBar.scrubbing) {
      this.scrubBar.scrubbing = false;
      this.callbacks.onLogEvent?.('explore.scrub.end', this.scrubBar.pos);
      return;
    }
    this.dragSelector.onPointerUp();
  }

  public step(dtSec: number): void {
    if (!this.activeState) return;
    this.scrubBar.updateReplay(dtSec);
  }

  public hideTooltip(): void {
    gsap.to(this.tipEl, { autoAlpha: 0, duration: 0.12 });
  }
}
