/**
 * Flat Color Block & Metric Block Builders (`src/design/components/block.ts`)
 *
 * Enforces Rule 2 (One-axis scaling via `data-ax="b" | "t" | "l" | "r"`),
 * crisp flat color fields, giant cropped watermark numerals, and traceable receipt triggers.
 */

import { renderBigNumberHtml } from './odometer.js';

export type BlockAxis = 'b' | 't' | 'l' | 'r';

export interface BlockConfig {
  id?: string;
  axis?: BlockAxis;
  anchor?: boolean;
  later?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  bg: string;
  fg: string;
  label?: string;
  labelRight?: string;
  watermark?: string;
  watermarkColor?: string;
  valueFormatted?: string;
  valueSizePx?: number;
  prefixSup?: string;
  suffixSup?: string;
  sublabel?: string;
  receiptCount?: number;
  receiptClaimTitle?: string;
  innerHtml?: string;
  className?: string;
}

/**
 * Render HTML markup for a traceable "RECEIPTS · N" trigger badge.
 */
export function renderReceiptBadgeHtml(params: {
  count: number;
  claimTitle: string;
  txnIds?: readonly string[];
  style?: string;
  className?: string;
}): string {
  const idsAttr = params.txnIds ? ` data-txn-ids="${params.txnIds.join(',')}"` : '';
  const titleSafe = params.claimTitle.replace(/"/g, '&quot;');
  const cls = ['receipt-badge', 'dt', 'ia', params.className ?? ''].filter(Boolean).join(' ');
  const styleAttr = params.style ? ` style="${params.style}"` : '';
  return `<button type="button" class="${cls}" data-receipt-title="${titleSafe}"${idsAttr}${styleAttr}>RECEIPTS · ${params.count}</button>`;
}

/**
 * Render HTML markup for a flat color block (`.blk`) with optional giant number,
 * background watermark, top labels, bottom sublabel, and receipt trigger badge.
 */
export function renderBlockHtml(config: BlockConfig): string {
  const axis = config.axis ?? 'b';
  const idAttr = config.id ? ` id="${config.id}"` : '';
  const anchorAttr = config.anchor ? ' data-anchor="1"' : '';
  const cls = ['blk', config.later ? 'later' : '', config.className ?? '']
    .filter(Boolean)
    .join(' ');
  const style = `left:${config.x}px;top:${config.y}px;width:${config.width}px;height:${config.height}px;background:${config.bg};color:${config.fg}`;

  const watermarkHtml = config.watermark
    ? `<div class="num gh" style="position:absolute;right:-20px;bottom:-60px;font-size:${Math.round(config.height * 0.95)}px;color:${config.watermarkColor ?? 'rgba(17,17,17,0.08)'}">${config.watermark}</div>`
    : '';

  const labelLeftHtml = config.label
    ? `<div class="lab tx" style="left:28px;top:22px">${config.label}</div>`
    : '';

  const labelRightHtml = config.labelRight
    ? `<div class="lab dt" style="right:28px;top:22px;text-align:right">${config.labelRight}</div>`
    : '';

  const numberHtml =
    config.valueFormatted !== undefined
      ? renderBigNumberHtml({
          valueFormatted: config.valueFormatted,
          sizePx: config.valueSizePx ?? 120,
          prefixSup: config.prefixSup,
          suffixSup: config.suffixSup,
          style: `left:24px;bottom:${config.sublabel ? '58px' : '20px'}`,
        })
      : '';

  const sublabelHtml = config.sublabel
    ? `<div class="lab dt" style="left:28px;bottom:22px;font-size:12px">${config.sublabel}</div>`
    : '';

  const receiptBadgeHtml =
    config.receiptCount !== undefined && config.receiptCount > 0
      ? renderReceiptBadgeHtml({
          count: config.receiptCount,
          claimTitle: config.receiptClaimTitle ?? config.label ?? 'Receipts',
          style: 'right:24px;bottom:20px',
        })
      : '';

  return `<div class="${cls}"${idAttr} data-ax="${axis}"${anchorAttr} style="${style}">${watermarkHtml}${labelLeftHtml}${labelRightHtml}${numberHtml}${sublabelHtml}${receiptBadgeHtml}${config.innerHtml ?? ''}</div>`;
}

/**
 * Create a DOM `HTMLDivElement` for a flat color block from `BlockConfig`.
 */
export function createBlockElement(config: BlockConfig): HTMLDivElement {
  const temp = document.createElement('div');
  temp.innerHTML = renderBlockHtml(config);
  return temp.firstElementChild as HTMLDivElement;
}
