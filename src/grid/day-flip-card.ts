import gsap from 'gsap';
import type { Transaction } from '../../contracts/index.js';
import { formatMoneyMinor } from '../../contracts/index.js';
import {
  CATEGORY_COLORS,
  EASE,
  formatDayLabel,
  type DayVisual,
  type GridGeometry,
} from './interactive-grid.js';

export interface DayFlipCardCallbacks {
  onOpenReceipts: (title: string, txnIds: string[]) => void;
  onLogEvent?: (type: string, value?: Record<string, unknown> | string | number) => void;
}

export class DayFlipCard {
  public readonly element: HTMLElement;
  private readonly innerEl: HTMLElement;
  private readonly frontEl: HTMLElement;
  private readonly backEl: HTMLElement;
  private activeDayIndex = -1;
  private activeDayVisual: DayVisual | null = null;
  private activeGeometry: GridGeometry | null = null;
  private readonly callbacks: DayFlipCardCallbacks;
  public reducedMotion = false;
  public currencySymbol = 'US$';

  constructor(parentContainer: HTMLElement, callbacks: DayFlipCardCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.id = 'flip';
    this.element.dataset.testid = 'day-flip-card';
    this.element.style.cssText =
      'position:absolute;left:0;top:0;perspective:1400px;pointer-events:none;visibility:hidden;z-index:25;';

    this.innerEl = document.createElement('div');
    this.innerEl.className = 'in';
    this.innerEl.style.cssText = 'position:absolute;inset:0;transform-style:preserve-3d;';

    this.frontEl = document.createElement('div');
    this.frontEl.className = 'f';
    this.frontEl.style.cssText =
      'position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;';

    this.backEl = document.createElement('div');
    this.backEl.className = 'b';
    this.backEl.style.cssText =
      'position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:rotateY(180deg);background:var(--bone, #F3F0E6);color:var(--ink, #111111);padding:22px 24px;overflow:hidden;border:2px solid var(--ink, #111111);display:flex;flex-direction:column;';

    this.innerEl.appendChild(this.frontEl);
    this.innerEl.appendChild(this.backEl);
    this.element.appendChild(this.innerEl);
    parentContainer.appendChild(this.element);
  }

  public isOpen(): boolean {
    return this.activeDayIndex >= 0;
  }

  public getActiveDayIndex(): number {
    return this.activeDayIndex;
  }

  public open(
    dayVisual: DayVisual,
    geom: GridGeometry,
    allDayTransactions?: readonly Transaction[]
  ): void {
    this.activeDayIndex = dayVisual.index;
    this.activeDayVisual = dayVisual;
    this.activeGeometry = geom;

    const txns = allDayTransactions ?? dayVisual.txns;
    const dayLabel = formatDayLabel(dayVisual.day);
    const totalMinor = txns.reduce((acc, t) => acc + t.amount_minor, 0);
    const totalFormatted = formatMoneyMinor(totalMinor, { showCents: true, prefix: '' });

    const visibleTxns = txns.slice(0, 8);
    const W = 420;
    const H = Math.min(540, Math.max(210, 154 + visibleTxns.length * 34));

    let x = dayVisual.x + geom.c;
    let y = dayVisual.y - H / 2;
    if (x + W > 1880) {
      x = Math.max(40, dayVisual.x - geom.c - W);
    }
    y = Math.max(84, Math.min(1040 - H, y));

    this.frontEl.style.background = `rgb(${dayVisual.r | 0},${dayVisual.g | 0},${dayVisual.b | 0})`;

    const rowsHtml =
      visibleTxns.length > 0
        ? visibleTxns
            .map((t) => {
              const swatchColor = CATEGORY_COLORS[t.category] ?? '#F4F03A';
              const amtStr = formatMoneyMinor(t.amount_minor, {
                showCents: true,
                prefix: '',
              });
              return `<div class="rc rr" style="font:500 14px/1 'JetBrains Mono',monospace;display:flex;gap:8px;padding:7px 0;align-items:baseline;">
                <i class="sw" style="width:9px;height:9px;display:inline-block;flex:none;background:${swatchColor};outline:1px solid #111"></i>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px">${this.escapeHtml(t.merchant)}</span>
                <span style="font-size:10px;opacity:0.65;text-transform:uppercase">${this.escapeHtml(t.category)}</span>
                <span class="ld" style="flex:1;border-bottom:1.5px dotted currentColor;opacity:0.45;transform:translateY(-3px)"></span>
                <span>${amtStr}</span>
              </div>`;
            })
            .join('')
        : `<div class="rc rr" style="font:500 14px/1.4 'JetBrains Mono',monospace;padding:12px 0;opacity:0.65">No discretionary purchases on this day.</div>`;

    const moreHtml =
      txns.length > visibleTxns.length
        ? `<div class="rc rr" style="font:500 12px/1 'JetBrains Mono',monospace;opacity:0.7;padding-top:4px">+ ${txns.length - visibleTxns.length} more in Receipts</div>`
        : '';

    this.backEl.innerHTML = `
      <div class="lab" style="position:static;display:flex;justify-content:space-between;align-items:center;font-size:12px">
        <span>${dayLabel.toUpperCase()}${dayVisual.day.is_payday ? ' · PAYDAY' : ''}</span>
        <div style="display:flex;gap:10px;align-items:center">
          <span>${txns.length} ITEM${txns.length === 1 ? '' : 'S'}</span>
          <button type="button" data-action="close-flip" aria-label="Close day card" style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;padding:2px 6px;border:1px solid #111;cursor:pointer;pointer-events:auto;">×</button>
        </div>
      </div>
      <div style="margin-top:12px;flex:1;overflow:hidden">${rowsHtml}${moreHtml}</div>
      <div class="rc rr" style="font:600 15px/1 'JetBrains Mono',monospace;display:flex;gap:8px;border-top:1.5px solid #111;margin-top:8px;padding-top:12px;align-items:center;justify-content:space-between">
        <span>TOTAL · ${this.escapeHtml(this.currencySymbol)}${totalFormatted}</span>
        <button type="button" data-action="open-day-receipts" style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;padding:6px 10px;background:#111;color:#F3F0E6;cursor:pointer;pointer-events:auto;">Receipts (${dayVisual.day.txn_ids.length})</button>
      </div>
    `;

    this.element.style.pointerEvents = 'auto';

    const closeBtn = this.backEl.querySelector('[data-action="close-flip"]');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    const receiptsBtn = this.backEl.querySelector('[data-action="open-day-receipts"]');
    receiptsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onOpenReceipts(
        `${dayLabel} — ${txns.length} purchase${txns.length === 1 ? '' : 's'}`,
        dayVisual.day.txn_ids
      );
    });

    gsap.killTweensOf([this.element, this.innerEl]);
    const rowEls = Array.from(this.backEl.querySelectorAll('.rr'));

    if (this.reducedMotion) {
      gsap.set(this.element, {
        left: x,
        top: y,
        width: W,
        height: H,
        autoAlpha: 0,
      });
      gsap.set(this.innerEl, { rotationY: 180 });
      gsap.to(this.element, { autoAlpha: 1, duration: 0.22 });
    } else {
      gsap.set(this.element, {
        autoAlpha: 1,
        left: dayVisual.x - geom.c / 2,
        top: dayVisual.y - geom.c / 2,
        width: geom.c,
        height: geom.c,
      });
      gsap.set(this.innerEl, { rotationY: 0 });
      gsap.to(this.element, {
        left: x,
        top: y,
        width: W,
        height: H,
        duration: 0.48,
        ease: 'expo.inOut',
      });
      gsap.to(this.innerEl, {
        rotationY: 180,
        duration: 0.48,
        ease: EASE.spring,
      });
      if (rowEls.length > 0) {
        gsap.fromTo(
          rowEls,
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: 0.28, stagger: 0.035, delay: 0.26, ease: 'power3.out' }
        );
      }
    }

    this.callbacks.onLogEvent?.('explore.flip', {
      day: dayLabel,
      items: txns.length,
    });
  }

  public close(instant = false): void {
    if (this.activeDayIndex < 0) return;
    const prevVisual = this.activeDayVisual;
    const prevGeom = this.activeGeometry;
    this.activeDayIndex = -1;
    this.activeDayVisual = null;
    this.element.style.pointerEvents = 'none';

    gsap.killTweensOf([this.element, this.innerEl]);
    if (instant || this.reducedMotion || !prevVisual || !prevGeom) {
      gsap.set(this.element, { autoAlpha: 0 });
      return;
    }

    gsap.to(this.element, {
      left: prevVisual.x - prevGeom.c / 2,
      top: prevVisual.y - prevGeom.c / 2,
      width: prevGeom.c,
      height: prevGeom.c,
      duration: 0.34,
      ease: 'power3.inOut',
    });
    gsap.to(this.innerEl, {
      rotationY: 0,
      duration: 0.34,
      ease: 'power3.inOut',
      onComplete: () => {
        gsap.set(this.element, { autoAlpha: 0 });
      },
    });
    this.callbacks.onLogEvent?.('explore.unflip', formatDayLabel(prevVisual.day));
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
