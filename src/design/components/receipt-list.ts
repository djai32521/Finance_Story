/**
 * Tabular Receipt List & Slide-Over Receipts Drawer (`src/design/components/receipt-list.ts`)
 *
 * Enforces Rule 2 (Every claim is traceable to its receipts) and Rule 6 (Privacy by default:
 * only shows cleaned `merchant`, `date`, `category`, and formatted `amount_minor` — never
 * raw bank strings, account numbers, or unmasked names).
 */

import type { Transaction } from '../../../contracts/data.js';
import { formatMoneyMinor } from '../../../contracts/data.js';
import { CATEGORY_META } from '../palette.js';
import { MONTH_NAMES_UPPER } from '../tokens.js';

export interface ReceiptListOptions {
  maxRows?: number;
  showDate?: boolean;
  showCategorySwatch?: boolean;
  showTotalRow?: boolean;
  rowClassName?: string;
}

function formatShortIsoDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const monthIdx = Math.max(0, Math.min(11, parseInt(parts[1]!, 10) - 1));
  const dom = parseInt(parts[2]!, 10);
  return `${dom} ${MONTH_NAMES_UPPER[monthIdx]}`;
}

/**
 * Render HTML markup for a list of traceable receipt rows (`.rc`).
 */
export function renderReceiptListHtml(
  transactions: readonly Transaction[],
  options: ReceiptListOptions = {}
): string {
  const maxRows = options.maxRows ?? 13;
  const showDate = options.showDate ?? true;
  const showSwatch = options.showCategorySwatch ?? true;
  const rowCls = ['rc', options.rowClassName ?? 'ar'].filter(Boolean).join(' ');

  const visible = transactions.slice(0, maxRows);
  const rowsHtml = visible
    .map((tx) => {
      const meta = CATEGORY_META[tx.category];
      const swatch = showSwatch
        ? `<i class="sw" style="background:${meta?.color ?? '#F4F03A'}"></i>`
        : '';
      const dateCol = showDate ? `<span class="dt-col">${formatShortIsoDate(tx.date)}</span>` : '';
      const amtFormatted = formatMoneyMinor(tx.amount_minor, {
        showCents: true,
        prefix: '',
      });
      return `<div class="${rowCls}" data-txn-id="${tx.id}">${swatch}${dateCol}<span>${tx.merchant}</span><span class="ld"></span><span>${amtFormatted}</span></div>`;
    })
    .join('');

  const overflowCount = transactions.length - visible.length;
  const moreHtml =
    overflowCount > 0
      ? `<div class="${rowCls}" style="opacity:0.7">+ ${overflowCount} more transaction${overflowCount === 1 ? '' : 's'}</div>`
      : '';

  let totalHtml = '';
  if (options.showTotalRow) {
    const totalMinor = transactions.reduce((sum, t) => sum + t.amount_minor, 0);
    const totalFormatted = formatMoneyMinor(totalMinor, {
      showCents: true,
      prefix: 'US$',
    });
    totalHtml = `<div class="${rowCls}" style="border-top:1.5px solid #111;margin-top:8px;padding-top:12px;font-weight:600"><span>TOTAL</span><span class="ld" style="opacity:0"></span><span>${totalFormatted}</span></div>`;
  }

  return rowsHtml + moreHtml + totalHtml;
}

/**
 * Controller for the stage-level Slide-Over Receipts Drawer.
 */
export class ReceiptsDrawer {
  public readonly el: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly totalEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'receipts-drawer ia';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:14px">
        <div>
          <div class="lab" style="position:static;font-size:11px;opacity:0.7">TRACEABLE RECEIPTS</div>
          <div class="drawer-title" style="font-size:26px;font-weight:400;letter-spacing:-0.02em;margin-top:2px">Receipts</div>
        </div>
        <button type="button" class="btn drawer-close" style="padding:8px 14px;font-size:11px">CLOSE ✕</button>
      </div>
      <div class="lab drawer-count" style="position:static;font-size:11px;margin-top:12px">0 TRANSACTIONS</div>
      <div class="drawer-list"></div>
      <div class="rc drawer-total" style="border-top:2px solid #111;margin-top:12px;padding-top:14px;font-weight:600;font-size:17px"></div>
    `;
    container.appendChild(this.el);

    this.titleEl = this.el.querySelector('.drawer-title') as HTMLElement;
    this.countEl = this.el.querySelector('.drawer-count') as HTMLElement;
    this.listEl = this.el.querySelector('.drawer-list') as HTMLElement;
    this.totalEl = this.el.querySelector('.drawer-total') as HTMLElement;

    const closeBtn = this.el.querySelector('.drawer-close');
    closeBtn?.addEventListener('click', () => this.close());
  }

  public open(title: string, transactions: readonly Transaction[]): void {
    this.titleEl.textContent = title;
    this.countEl.textContent = `${transactions.length} TRANSACTION${transactions.length === 1 ? '' : 'S'} · VERIFIED BY ID`;
    this.listEl.innerHTML = renderReceiptListHtml(transactions, {
      maxRows: 100,
      showDate: true,
      showCategorySwatch: true,
      showTotalRow: false,
    });
    const totalMinor = transactions.reduce((acc, t) => acc + t.amount_minor, 0);
    this.totalEl.innerHTML = `<span>TOTAL</span><span class="ld" style="opacity:0"></span><span>${formatMoneyMinor(totalMinor, { showCents: true, prefix: 'US$' })}</span>`;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
  }

  public close(): void {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
  }

  public isOpen(): boolean {
    return this.el.classList.contains('open');
  }
}
