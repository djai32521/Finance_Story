import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
  Transaction,
} from '../../../contracts/index.js';
import { formatMoneyMinor, getCategoryDisplayLabel } from '../../../contracts/index.js';
import { GRID_PRESETS, RGB_PALETTE, hexToRgb } from '../../grid/interactive-grid.js';
import {
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from '../core/pour-chapter.js';

const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

function pickStudioFact(
  ctx: ChapterContext,
  preferredIds: string[],
  fallbackIndex = 0,
  fallbackLabel = 'Studio Metric'
): Fact {
  for (const id of preferredIds) {
    if (ctx.facts.has(id)) {
      return ctx.getFact(id);
    }
  }
  const fbId = ctx.chapter.fact_ids[fallbackIndex] ?? ctx.chapter.fact_ids[0];
  if (fbId && ctx.facts.has(fbId)) {
    return ctx.getFact(fbId);
  }
  const first = ctx.facts.values().next().value;
  if (first) return first;
  return {
    id: preferredIds[0] ?? 'studio_fallback',
    label: fallbackLabel,
    value: 0,
    unit: 'count',
    formatted: '0',
    txn_ids: ctx.chapter.txn_ids,
    computation: 'Fallback studio metric',
  };
}

function stripCurrencyPrefix(formatted: string): { hasDollar: boolean; rawDigits: string } {
  const hasDollar = formatted.startsWith('$') || formatted.startsWith('US$');
  const rawDigits = formatted.replace(/^(US\$|\$)/, '');
  return { hasDollar, rawDigits };
}

function formatBespokeBadge(badgeParam?: string, isB2B = false): string {
  if (isB2B) return '';
  const raw = (badgeParam ?? 'ONLY IN YOUR APP').trim().toUpperCase();
  if (raw.includes('ONLY IN YOUR APP') && raw.includes('BESPOKE')) {
    return raw;
  }
  if (raw.includes('ONLY IN YOUR APP')) {
    return `${raw} · BESPOKE CHAPTER`;
  }
  return `ONLY IN YOUR APP · ${raw}`;
}

export class StudioChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private studioDates = new Set<string>();
  private milestoneDates = new Set<string>();

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const isSam = ctx.plan.person_name === 'Sam' && !ctx.plan.business_meta;
    const isB2B = Boolean(ctx.plan.business_meta);
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;

    let buildSpendFact = pickStudioFact(
      ctx,
      ['studio_total_spend', 'big_one_spend', 'total_spend_usd'],
      0,
      'Monarch Acoustic Studio Build Spend'
    );
    let depositFact = pickStudioFact(
      ctx,
      ['studio_deposit_spend', 'studio_total_spend'],
      1,
      'Studio May Deposit'
    );
    let finalFact = pickStudioFact(
      ctx,
      ['studio_final_spend', 'big_one_spend', 'studio_total_spend'],
      2,
      'Studio August Final Payment'
    );
    let synthFact = pickStudioFact(
      ctx,
      ['studio_synth_spend', 'studio_deposit_spend'],
      3,
      'August Synth Purchase'
    );
    let gearCountFact = pickStudioFact(
      ctx,
      ['studio_gear_count', 'total_transactions_count'],
      4,
      'Studio & Music Gear Purchases'
    );
    let totalWithGearFact = pickStudioFact(
      ctx,
      ['studio_total_with_gear_spend', 'studio_total_spend', 'total_spend_usd'],
      5,
      'Total Studio & Music Gear Spend'
    );

    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const kickerText = ctx.chapter.params.kicker ?? '05 · ROOM TO MAKE NOISE';
    const badgeText = formatBespokeBadge(ctx.chapter.params.badge, isB2B);

    // Gather chapter transactions procedurally
    const gearIdSet = new Set<string>([
      ...totalWithGearFact.txn_ids,
      ...gearCountFact.txn_ids,
      ...buildSpendFact.txn_ids,
      ...ctx.chapter.txn_ids,
    ]);

    let studioTxns: Transaction[] =
      !isSam && ctx.transactions.length > 0
        ? [...ctx.transactions]
        : ctx.allTransactions.filter((t) => gearIdSet.has(t.id));
    if (studioTxns.length === 0 && ctx.transactions.length > 0) {
      studioTxns = [...ctx.transactions];
    }
    if (studioTxns.length === 0 && ctx.chapter.params.focus_category) {
      studioTxns = ctx.allTransactions.filter(
        (t) =>
          t.direction === 'out' &&
          !t.is_transfer &&
          t.category === ctx.chapter.params.focus_category
      );
    }
    if (studioTxns.length === 0) {
      studioTxns = ctx.allTransactions
        .filter(
          (t) =>
            t.direction === 'out' &&
            !t.is_transfer &&
            (isSam
              ? /monarch|sweetwater|synth|duckling|myvolts|music|audio/i.test(
                  `${t.merchant} ${t.raw_description}`
                )
              : true)
        )
        .slice(0, 15);
    }

    const sortedChrono = studioTxns.slice().sort((a, b) => a.date.localeCompare(b.date));
    const sortedByAmount = studioTxns.slice().sort((a, b) => b.amount_minor - a.amount_minor);

    const finalTx = sortedByAmount[0];
    const depositTx = sortedByAmount[1] ?? sortedByAmount[0];
    const synthTx = sortedByAmount[2] ?? sortedByAmount[1] ?? sortedByAmount[0];

    if (!isSam) {
      const totalStudioMinor = studioTxns.reduce((acc, t) => acc + t.amount_minor, 0);
      const topTwoMinor =
        (finalTx?.amount_minor ?? 0) +
        (depositTx && depositTx.id !== finalTx?.id ? depositTx.amount_minor : 0);

      if (!ctx.facts.has('studio_total_spend') && finalTx) {
        buildSpendFact = {
          id: buildSpendFact.id,
          label: `${finalTx.merchant} Milestone Total`,
          value: topTwoMinor,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(topTwoMinor, { showCents: false }),
          txn_ids: [finalTx.id, ...(depositTx ? [depositTx.id] : [])],
          computation: 'Top two milestone transactions',
        };
      }
      if (!ctx.facts.has('studio_deposit_spend') && depositTx) {
        depositFact = {
          id: depositFact.id,
          label: `${depositTx.merchant} Milestone`,
          value: depositTx.amount_minor,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(depositTx.amount_minor, { showCents: false }),
          txn_ids: [depositTx.id],
          computation: 'Second-largest chapter transaction',
        };
      }
      if (!ctx.facts.has('studio_final_spend') && finalTx) {
        finalFact = {
          id: finalFact.id,
          label: `${finalTx.merchant} Peak Invoice`,
          value: finalTx.amount_minor,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(finalTx.amount_minor, { showCents: true }),
          txn_ids: [finalTx.id],
          computation: 'Largest chapter transaction',
        };
      }
      if (!ctx.facts.has('studio_synth_spend') && synthTx) {
        synthFact = {
          id: synthFact.id,
          label: `${synthTx.merchant} Settlement`,
          value: synthTx.amount_minor,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(synthTx.amount_minor, { showCents: false }),
          txn_ids: [synthTx.id],
          computation: 'Third-largest chapter transaction',
        };
      }
      if (!ctx.facts.has('studio_gear_count')) {
        gearCountFact = {
          id: gearCountFact.id,
          label: 'Chapter Ledger Movements',
          value: studioTxns.length,
          unit: 'count',
          formatted: String(studioTxns.length),
          txn_ids: studioTxns.map((t) => t.id),
          computation: 'Count of chapter transactions',
        };
      }
      if (!ctx.facts.has('studio_total_with_gear_spend')) {
        totalWithGearFact = {
          id: totalWithGearFact.id,
          label: 'Total Chapter Outflow',
          value: totalStudioMinor,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(totalStudioMinor, { showCents: false }),
          txn_ids: studioTxns.map((t) => t.id),
          computation: 'Sum of chapter transactions',
        };
      }
    }

    this.studioDates = new Set(studioTxns.map((t) => t.date));
    const milestoneIdSet = new Set([...depositFact.txn_ids, ...finalFact.txn_ids]);
    this.milestoneDates = new Set(
      studioTxns.filter((t) => milestoneIdSet.has(t.id)).map((t) => t.date)
    );
    if (this.milestoneDates.size === 0) {
      if (isSam) {
        this.milestoneDates.add('2025-05-24');
        this.milestoneDates.add('2025-08-11');
      } else {
        if (depositTx) this.milestoneDates.add(depositTx.date);
        if (finalTx) this.milestoneDates.add(finalTx.date);
      }
    }

    // Aggregate monthly spend and purchase count across the 12 months
    const monthlySpendMinor = new Array<number>(12).fill(0);
    const monthlyGearCount = new Array<number>(12).fill(0);
    sortedChrono.forEach((t) => {
      const m = Math.max(0, Math.min(11, parseInt(t.date.slice(5, 7), 10) - 1));
      monthlySpendMinor[m] = (monthlySpendMinor[m] ?? 0) + t.amount_minor;
      monthlyGearCount[m] = (monthlyGearCount[m] ?? 0) + 1;
    });

    const activeMonths = monthlySpendMinor
      .map((s, idx) => (s > 0 ? idx : -1))
      .filter((idx) => idx >= 0);
    const firstActiveMonth = isSam ? 4 : (activeMonths[0] ?? 0);
    const lastActiveMonth = isSam
      ? 7
      : (activeMonths[activeMonths.length - 1] ?? Math.max(firstActiveMonth, 11));
    let peakMonth = isSam ? 7 : firstActiveMonth;
    let secondPeakMonth = isSam ? 4 : firstActiveMonth;
    if (!isSam) {
      const monthOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].sort(
        (a, b) => (monthlySpendMinor[b] ?? 0) - (monthlySpendMinor[a] ?? 0)
      );
      peakMonth = monthOrder[0] ?? 0;
      secondPeakMonth =
        monthOrder[1] && (monthlySpendMinor[monthOrder[1]] ?? 0) > 0
          ? monthOrder[1]
          : firstActiveMonth;
    }

    const focusCategoryKey = ctx.chapter.params.focus_category ?? finalTx?.category ?? 'shopping';
    const focusCategoryLabel = getCategoryDisplayLabel(
      focusCategoryKey,
      ctx.plan.category_labels,
      isB2B
    ).toUpperCase();
    const topMerchantLabel = (finalTx?.merchant ?? 'PRIMARY VENDOR').toUpperCase();
    const distinctMerchantsSummary = Array.from(
      new Set(sortedByAmount.slice(0, 4).map((t) => t.merchant.toUpperCase()))
    ).join(' · ');

    const isPhone = ctx.viewport === 'phone';
    const blueprintSvg = this.buildBlueprintSvg(
      monthlySpendMinor,
      monthlyGearCount,
      depositFact,
      finalFact,
      synthFact,
      gearCountFact,
      isPhone ? 326 : 984,
      isPhone ? 130 : 244,
      {
        isSam,
        firstActiveMonth,
        lastActiveMonth,
        peakMonth,
        secondPeakMonth,
        focusCategoryLabel,
      }
    );

    const buildNum = stripCurrencyPrefix(buildSpendFact.formatted);
    const totalGearNum = stripCurrencyPrefix(totalWithGearFact.formatted);
    const finalNum = stripCurrencyPrefix(finalFact.formatted);
    const gearCountNum = stripCurrencyPrefix(gearCountFact.formatted);

    const topLedgerTxns = sortedByAmount.slice(0, isPhone ? 3 : 5);
    const ledgerRowsHtml = topLedgerTxns
      .map(
        (t) =>
          `<div class="rc" style="font:500 ${isPhone ? '11px' : '13px'}/1.15 'JetBrains Mono',monospace;display:flex;gap:8px;padding:${isPhone ? '4px' : '6px'} 0;align-items:baseline;">
            <span style="opacity:0.7;min-width:46px">${this.escapeHtml(t.date.slice(5))}</span>
            <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:${isPhone ? '150px' : '240px'}">${this.escapeHtml(t.merchant)}</span>
            <span class="ld" style="flex:1;border-bottom:1.5px dotted currentColor;opacity:0.4"></span>
            <span>${currencySup}${formatMoneyMinor(t.amount_minor, { showCents: true, prefix: '' })}</span>
          </div>`
      )
      .join('');

    const blk0Title = isSam
      ? 'MONARCH ACOUSTIC BUILD'
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[0]?.label?.toUpperCase() ?? `${topMerchantLabel} MILESTONES`
        );
    const blk1TitlePhone = isSam
      ? 'TOTAL + GEAR'
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[1]?.label?.toUpperCase() ?? `TOTAL ${focusCategoryLabel}`
        );
    const blk1TitleDesktop = isSam
      ? 'TOTAL WITH SYNTH &amp; GEAR'
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[1]?.label?.toUpperCase() ?? `TOTAL ${focusCategoryLabel}`
        );
    const blk2Title = isSam
      ? 'FINAL INVOICE · AUG'
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[2]?.label?.toUpperCase() ??
            `PEAK INVOICE · ${MONTH_LABELS[peakMonth]}`
        );
    const blk3Title = isSam
      ? 'STUDIO &amp; GEAR BUYS'
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[3]?.label?.toUpperCase() ?? `${focusCategoryLabel} ITEMS`
        );

    const badgeDisplayStyle = badgeText ? 'inline-flex' : 'none';
    const takeawayPrefixHtml = takeawayPrefix
      ? `<span style="font-family:'JetBrains Mono',monospace;font-size:${isPhone ? '9px' : '10.5px'};font-weight:700;letter-spacing:${isPhone ? '0.1em' : '0.12em'};color:#F4F03A;text-transform:uppercase;margin-right:${isPhone ? '6px' : '8px'};">${takeawayPrefix}</span>`
      : '';

    if (isPhone) {
      container.innerHTML = `
        <div class="studio-phone-stage" data-testid="studio-chapter-stage" data-viewport="phone" style="position:relative;width:390px;height:844px;overflow:hidden;">
          <div class="tx" style="position:absolute;left:16px;top:36px;right:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span class="badge-bespoke" data-testid="bespoke-badge" style="display:${badgeDisplayStyle};align-items:center;gap:6px;padding:4px 8px;background:#111111;color:#F4F03A;border:1.5px solid #F4F03A;font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">${this.escapeHtml(badgeText)}</span>
            <span class="lab" style="position:static;font-size:10px;color:#C9C5BA;">${this.escapeHtml(kickerText)}</span>
          </div>

          <div class="ch-header-stack" style="left:16px;right:16px;top:60px;max-height:126px;gap:6px;">
            <div class="split tx" data-testid="chapter-headline" style="width:358px;font-size:24px;font-weight:300;letter-spacing:-0.04em;line-height:1.05;color:var(--bone);">${this.escapeHtml(headlineText)}</div>
            <div class="tx" data-testid="chapter-body" style="width:358px;padding:6px 10px;background:#1C1C1B;border-left:3px solid #FF5A14;font-family:'Space Grotesk',sans-serif;font-size:11.5px;line-height:1.3;color:var(--bone);">
              ${takeawayPrefixHtml}${this.escapeHtml(bodyText)}
            </div>
          </div>

          <div class="blk ia" data-ax="b" id="studio-blueprint-blk" data-testid="studio-blueprint-block" style="position:absolute;left:16px;top:194px;width:358px;height:182px;background:#1C1C1B;color:var(--bone);border:1.5px solid #3A3A38;transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:14px;top:10px;right:14px;font-size:9.5px;display:flex;justify-content:space-between;align-items:center;">
              <span>${isSam ? 'ACOUSTIC BUILD TIMELINE · MAY–AUG' : `${this.escapeHtml(focusCategoryLabel)} TIMELINE · ${MONTH_LABELS[firstActiveMonth]}–${MONTH_LABELS[lastActiveMonth]}`}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalWithGearFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 6px;border:1px solid #F4F03A;color:#F4F03A;background:#111;cursor:pointer;">Receipts (${totalWithGearFact.txn_ids.length})</button>
            </div>
            <div class="dt" style="position:absolute;left:14px;top:38px;width:326px;height:130px;">${blueprintSvg}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-build" style="position:absolute;left:16px;top:386px;width:174px;height:126px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk0Title}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(buildSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${buildSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:42px;font-size:40px;">${buildNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(buildNum.rawDigits)}">${this.escapeHtml(buildNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">${isSam ? `DEP ${this.escapeHtml(depositFact.formatted)} · FIN ${this.escapeHtml(finalFact.formatted)}` : `${MONTH_LABELS[secondPeakMonth]} ${this.escapeHtml(depositFact.formatted)} · ${MONTH_LABELS[peakMonth]} ${this.escapeHtml(finalFact.formatted)}`}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-total-gear" style="position:absolute;left:200px;top:386px;width:174px;height:126px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk1TitlePhone}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalWithGearFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${totalWithGearFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:42px;font-size:40px;">${totalGearNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(totalGearNum.rawDigits)}">${this.escapeHtml(totalGearNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">${isSam ? `SYNTH ${this.escapeHtml(synthFact.formatted)} INCLUDED` : `${this.escapeHtml(synthFact.formatted)} MILESTONE INCLUDED`}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-final" style="position:absolute;left:16px;top:522px;width:174px;height:126px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk2Title}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(finalFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${finalFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:44px;font-size:34px;">${finalNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(finalNum.rawDigits)}">${this.escapeHtml(finalNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">${isSam ? 'YEAR’S BIGGEST SINGLE BUY' : 'PEAK CHAPTER SETTLEMENT'}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-gear-count" style="position:absolute;left:200px;top:522px;width:174px;height:126px;background:var(--lav);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk3Title}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(gearCountFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${gearCountFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:40px;font-size:44px;"><span class="od" data-v="${this.escapeHtml(gearCountNum.rawDigits)}">${this.escapeHtml(gearCountNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">${isSam ? 'SWEETWATER · SYNTH · AUDIO' : this.escapeHtml(distinctMerchantsSummary.slice(0, 28))}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-ledger" style="position:absolute;left:16px;top:658px;width:358px;height:152px;background:var(--bone);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:14px;top:10px;right:14px;font-size:9.5px;display:flex;justify-content:space-between;align-items:center;">
              <span>${isSam ? 'STUDIO BUILD LEDGER' : `${this.escapeHtml(focusCategoryLabel)} LEDGER`}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalWithGearFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 7px;background:#111;color:#F3F0E6;cursor:pointer;">All Receipts (${totalWithGearFact.txn_ids.length}) →</button>
            </div>
            <div class="tx" style="position:absolute;left:14px;top:36px;right:14px;">${ledgerRowsHtml}</div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="studio-desktop-stage" data-testid="studio-chapter-stage" data-viewport="desktop" style="position:absolute;inset:0;">
          <div class="ch-header-stack" style="left:60px;top:64px;max-width:1030px;max-height:252px;">
            <div class="tx" style="display:flex;align-items:center;gap:16px;">
              <span class="badge-bespoke" data-testid="bespoke-badge" style="display:${badgeDisplayStyle};align-items:center;gap:8px;padding:6px 12px;background:#111111;color:#F4F03A;border:1.5px solid #F4F03A;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;">${this.escapeHtml(badgeText)}</span>
              <span class="lab" style="position:static;color:#C9C5BA;">${this.escapeHtml(kickerText)}</span>
            </div>

            <div class="split tx" data-testid="chapter-headline" style="font-size:58px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;color:var(--bone);">${this.escapeHtml(headlineText)}</div>
            <div class="tx" data-testid="chapter-body" style="padding:12px 18px;background:#1C1C1B;border:1px solid #3A3A38;border-left:4px solid #FF5A14;font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:400;line-height:1.35;color:var(--bone);">
              ${takeawayPrefixHtml}${this.escapeHtml(bodyText)}
            </div>
          </div>

          <div class="blk ia" data-ax="b" id="studio-blueprint-blk" data-testid="studio-blueprint-block" style="position:absolute;left:64px;top:330px;width:1040px;height:474px;background:#1C1C1B;color:var(--bone);border:1.5px solid #3A3A38;transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:28px;top:22px;right:28px;display:flex;justify-content:space-between;align-items:center;">
              <span>${isSam ? `STUDIO SIGNAL &amp; ACOUSTIC BLUEPRINT TIMELINE · MAY DEPOSIT (${this.escapeHtml(depositFact.formatted)}) → AUG COMPLETION (${this.escapeHtml(finalFact.formatted)})` : `${this.escapeHtml(focusCategoryLabel)} SIGNAL &amp; DEPLOYMENT TIMELINE · ${MONTH_LABELS[secondPeakMonth]} (${this.escapeHtml(depositFact.formatted)}) → ${MONTH_LABELS[peakMonth]} PEAK (${this.escapeHtml(finalFact.formatted)})`}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalWithGearFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;padding:5px 10px;border:1.5px solid #F4F03A;background:#111111;color:#F4F03A;cursor:pointer;">Receipts (${totalWithGearFact.txn_ids.length})</button>
            </div>
            <div class="dt" style="position:absolute;left:28px;top:64px;width:984px;height:244px;">${blueprintSvg}</div>
            <div class="tx" style="position:absolute;left:28px;top:324px;right:28px;border-top:1px solid #3A3A38;padding-top:12px;">
              <div class="lab" style="position:static;font-size:11px;color:#F4F03A;margin-bottom:6px;">${isSam ? 'KEY ACOUSTIC &amp; GEAR MILESTONES · VERIFIED TRANSACTIONS' : `KEY ${this.escapeHtml(focusCategoryLabel)} MILESTONES · ${isB2B ? 'LEDGER TRANSACTIONS' : 'VERIFIED TRANSACTIONS'}`}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 28px;">
                ${ledgerRowsHtml}
              </div>
            </div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-build" style="position:absolute;left:1128px;top:68px;width:356px;height:356px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk0Title}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(buildSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${buildSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:76px;font-size:102px;">${buildNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(buildNum.rawDigits)}">${this.escapeHtml(buildNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">${isSam ? `MAY DEPOSIT ${this.escapeHtml(depositFact.formatted)} + AUG FINAL ${this.escapeHtml(finalFact.formatted)}` : `${MONTH_LABELS[secondPeakMonth]} ${this.escapeHtml(depositFact.formatted)} + ${MONTH_LABELS[peakMonth]} ${this.escapeHtml(finalFact.formatted)}`}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-total-gear" style="position:absolute;left:1500px;top:68px;width:356px;height:356px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk1TitleDesktop}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalWithGearFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${totalWithGearFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:76px;font-size:102px;">${totalGearNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(totalGearNum.rawDigits)}">${this.escapeHtml(totalGearNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">${isSam ? `INCLUDES AUG SYNTH (${this.escapeHtml(synthFact.formatted)}) &amp; HARDWARE` : `INCLUDES ${this.escapeHtml(synthFact.formatted)} MILESTONE &amp; LEDGER`}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-final" style="position:absolute;left:1128px;top:448px;width:356px;height:356px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk2Title}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(finalFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${finalFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:76px;font-size:84px;">${finalNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(finalNum.rawDigits)}">${this.escapeHtml(finalNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">${isSam ? 'MONARCH ACOUSTIC COMPLETION · YEAR’S BIGGEST BUY' : `${this.escapeHtml(topMerchantLabel)} · PEAK SETTLEMENT`}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-gear-count" style="position:absolute;left:1500px;top:448px;width:356px;height:356px;background:var(--lav);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blk3Title}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(gearCountFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${gearCountFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:76px;font-size:132px;"><span class="od" data-v="${this.escapeHtml(gearCountNum.rawDigits)}">${this.escapeHtml(gearCountNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">${isSam ? 'MONARCH ACOUSTIC · SWEETWATER · SYNTHYARD · MYVOLTS' : this.escapeHtml(distinctMerchantsSummary)}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="studio-block-synth" style="position:absolute;left:1128px;top:824px;width:728px;height:180px;background:var(--bone);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:28px;top:20px;right:28px;display:flex;justify-content:space-between;align-items:center;">
              <span>${isSam ? `POST-BUILD CELEBRATION · FIRST SYNTH IN THE NEW ROOM (${this.escapeHtml(synthFact.formatted)})` : `DEPLOYMENT MILESTONE · ${this.escapeHtml(topMerchantLabel)} (${this.escapeHtml(synthFact.formatted)})`}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(synthFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:5px 10px;background:#111111;color:#F3F0E6;cursor:pointer;">${isSam ? 'Synth Receipt' : 'Milestone Receipt'} (${synthFact.txn_ids.length}) →</button>
            </div>
            <div class="tx" style="position:absolute;left:28px;top:62px;right:28px;display:flex;justify-content:space-between;align-items:baseline;">
              <div style="font-size:22px;font-weight:400;max-width:480px;line-height:1.3;">
                ${isSam ? `Eight days after the ${this.escapeHtml(finalFact.formatted)} final acoustic build payment, a ${this.escapeHtml(synthFact.formatted)} synth landed to christen the room.` : `Peaking in ${MONTH_LABELS[peakMonth]} at ${this.escapeHtml(finalFact.formatted)}, ${this.escapeHtml(ctx.plan.person_name)} deployed ${this.escapeHtml(totalWithGearFact.formatted)} across ${this.escapeHtml(gearCountFact.formatted)} ${isB2B ? '' : 'verified '}${this.escapeHtml(focusCategoryLabel.toLowerCase())} settlements.`}
              </div>
              <div class="lab" style="position:static;font-size:11px;text-align:right;">
                ${isSam ? 'BUILD + GEAR TOTAL' : `${this.escapeHtml(focusCategoryLabel)} TOTAL`}<br><b style="font-size:18px;">${this.escapeHtml(totalWithGearFact.formatted)}</b>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    initOdometers(container);

    container.querySelectorAll<HTMLButtonElement>('.receipt-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = btn.dataset.factId;
        if (fid && ctx.facts.has(fid)) {
          const f = ctx.getFact(fid);
          ctx.openReceipts(`${f.label} (${f.formatted})`, f.txn_ids);
        } else {
          ctx.openReceipts(headlineText, ctx.chapter.txn_ids);
        }
      });
    });
  }

  private buildBlueprintSvg(
    monthlySpendMinor: readonly number[],
    monthlyGearCount: readonly number[],
    depositFact: Fact,
    finalFact: Fact,
    synthFact: Fact,
    gearCountFact: Fact,
    width: number,
    height: number,
    meta: {
      isSam: boolean;
      firstActiveMonth: number;
      lastActiveMonth: number;
      peakMonth: number;
      secondPeakMonth: number;
      focusCategoryLabel: string;
    }
  ): string {
    const maxMonthMinor = Math.max(100000, ...monthlySpendMinor);
    const padLeft = 24;
    const padRight = 24;
    const padTop = 30;
    const padBottom = 32;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const colStep = plotW / 12;
    const barW = Math.max(12, colStep * 0.56);

    // Blueprint horizontal grid lines
    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((r) => {
        const y = (padTop + plotH * (1 - r)).toFixed(1);
        return `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#2E2E2C" stroke-width="1" stroke-dasharray="${r === 0 ? 'none' : '3,3'}"/>`;
      })
      .join('');

    // Highlight active build/deployment zone
    const startX = padLeft + meta.firstActiveMonth * colStep;
    const endX = padLeft + (meta.lastActiveMonth + 1) * colStep;
    const buildZoneRect = `<rect x="${startX.toFixed(1)}" y="${padTop - 8}" width="${Math.max(colStep, endX - startX).toFixed(1)}" height="${(plotH + 8).toFixed(1)}" fill="#F4F03A" fill-opacity="0.07" stroke="#F4F03A" stroke-width="1" stroke-dasharray="4,4"/>`;

    // Signal polyline connecting monthly activity
    const pts: Array<[number, number]> = [];
    let barsSvg = '';

    for (let m = 0; m < 12; m++) {
      const spend = monthlySpendMinor[m] ?? 0;
      const cnt = monthlyGearCount[m] ?? 0;
      const cx = padLeft + m * colStep + colStep / 2;
      const ratio = spend > 0 ? Math.max(0.08, Math.sqrt(spend / maxMonthMinor)) : 0.02;
      const bh = Math.max(4, ratio * plotH);
      const bx = cx - barW / 2;
      const by = padTop + plotH - bh;
      pts.push([cx, by]);

      const isSecondPeak = m === meta.secondPeakMonth;
      const isPeak = m === meta.peakMonth;
      const fill = isPeak ? '#FF5A14' : isSecondPeak ? '#F4F03A' : cnt > 0 ? '#A9A2E0' : '#3A3A38';

      barsSvg += `<rect class="studio-signal-bar" data-month="${MONTH_LABELS[m]}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${fill}"/>`;
      barsSvg += `<text x="${cx.toFixed(1)}" y="${height - 8}" fill="#C9C5BA" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="middle">${MONTH_LABELS[m]}</text>`;

      if (cnt > 0) {
        barsSvg += `<circle cx="${cx.toFixed(1)}" cy="${by.toFixed(1)}" r="4" fill="#F3F0E6" stroke="#111111" stroke-width="1.5"/>`;
      }
    }

    const signalPathD = pts
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');

    const secPt = pts[meta.secondPeakMonth] ?? [
      padLeft + (meta.secondPeakMonth + 0.5) * colStep,
      padTop + plotH * 0.5,
    ];
    const peakPt = pts[meta.peakMonth] ?? [padLeft + (meta.peakMonth + 0.5) * colStep, padTop + 12];
    const secW = width > 400 ? 164 : 124;
    const peakW = width > 400 ? 268 : 200;
    const secRectX = Math.max(8, Math.min(width - secW - 8, secPt[0] - secW / 2));
    const peakRectX = Math.max(8, Math.min(width - peakW - 8, peakPt[0] - peakW / 2));
    const peakY = Math.max(16, peakPt[1] - 10);
    let secY = Math.max(16, secPt[1] - 10);
    if (
      secRectX < peakRectX + peakW + 8 &&
      secRectX + secW + 8 > peakRectX &&
      Math.abs(secY - peakY) < 20
    ) {
      secY = Math.min(height - padBottom - 10, peakY + 22);
    }

    const secCalloutText = meta.isSam
      ? `MAY DEPOSIT ${this.escapeHtml(depositFact.formatted)}`
      : `${MONTH_LABELS[meta.secondPeakMonth]} ${this.escapeHtml(depositFact.formatted)}`;
    const peakCalloutText = meta.isSam
      ? `AUG FINAL ${this.escapeHtml(finalFact.formatted)} + SYNTH ${this.escapeHtml(synthFact.formatted)}`
      : `${MONTH_LABELS[meta.peakMonth]} PEAK ${this.escapeHtml(finalFact.formatted)}`;
    const acquisitionsLabel = meta.isSam
      ? `${this.escapeHtml(gearCountFact.formatted)} STUDIO &amp; GEAR ACQUISITIONS`
      : `${this.escapeHtml(gearCountFact.formatted)} ${this.escapeHtml(meta.focusCategoryLabel)} MOVEMENTS`;

    const calloutsSvg = `
      <g class="blueprint-callouts">
        <rect x="${secRectX.toFixed(1)}" y="${(secY - 12).toFixed(1)}" width="${secW}" height="17" rx="2" fill="#111111" opacity="0.92"/>
        <text x="${(secRectX + secW / 2).toFixed(1)}" y="${secY.toFixed(1)}" fill="#F4F03A" font-family="JetBrains Mono, monospace" font-size="${width > 400 ? '10' : '8.5'}" font-weight="600" text-anchor="middle">${secCalloutText}</text>
        <rect x="${peakRectX.toFixed(1)}" y="${(peakY - 12).toFixed(1)}" width="${peakW}" height="17" rx="2" fill="#111111" opacity="0.92"/>
        <text x="${(peakRectX + peakW / 2).toFixed(1)}" y="${peakY.toFixed(1)}" fill="#FF5A14" font-family="JetBrains Mono, monospace" font-size="${width > 400 ? '10' : '8.5'}" font-weight="600" text-anchor="middle">${peakCalloutText}</text>
        ${width > 400 ? `<text x="${width - padRight}" y="16" fill="#A9A2E0" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="end">${acquisitionsLabel}</text>` : ''}
      </g>
    `;

    return `
      <svg data-testid="studio-blueprint-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">
        ${gridLines}
        ${buildZoneRect}
        <path class="studio-signal-wave" d="${signalPathD}" fill="none" stroke="#F4F03A" stroke-width="2" stroke-linejoin="round"/>
        ${barsSvg}
        ${calloutsSvg}
      </svg>
    `;
  }

  public play(timeline: TimelineController): void {
    if (!this.container || !this.ctx) return;
    const tl = (timeline as PlayerTimelineController).gsapTimeline ?? gsap.timeline();
    const rm = timeline.isReducedMotion();
    const grid = this.ctx.grid;

    if (grid) {
      grid.hideAllParticles();
      const preset = this.ctx.viewport === 'phone' ? GRID_PRESETS.phone : GRID_PRESETS.mini;
      grid.setGridGeometry(preset, { dur: rm ? 0 : 0.45, instant: rm });
      const emberRgb = hexToRgb('#FF5A14');
      const solarRgb = RGB_PALETTE.c1;

      grid.days.forEach((v) => {
        if (this.milestoneDates.has(v.day.date)) {
          grid.tweenColor(v, emberRgb, 0.25, 0.08);
          grid.popVisual(v, 0.55, 0.08);
        } else if (this.studioDates.has(v.day.date)) {
          grid.tweenColor(v, solarRgb, 0.25, 0.05);
          grid.popVisual(v, 0.38, 0.05);
        } else {
          grid.tweenColor(v, RGB_PALETTE.dim, 0.25);
        }
      });
    }

    enterStageGroup(this.container, tl, 0, rm);

    if (!rm) {
      const bars = Array.from(
        this.container.querySelectorAll<SVGRectElement>('.studio-signal-bar')
      );
      if (bars.length > 0) {
        tl.fromTo(
          bars,
          { scaleY: 0, transformOrigin: '50% 100%' },
          { scaleY: 1, duration: 0.42, stagger: 0.025, ease: 'power3.out' },
          0.35
        );
      }
    }

    timeline.logEvent('bespoke.studio.play', {
      studioDays: this.studioDates.size,
      viewport: this.ctx.viewport,
    });
  }

  public explore(): void {
    this.ctx?.openExplore(this.ctx.chapter.params.focus_category ?? 'shopping');
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

export function createStudioChapter(): ChapterModule {
  return new StudioChapter();
}
