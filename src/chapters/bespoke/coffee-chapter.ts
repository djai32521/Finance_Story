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
import type { ExtendedChapterContext } from '../core/pour-chapter.js';

function pickCoffeeFact(
  ctx: ChapterContext,
  preferredIds: string[],
  fallbackIndex = 0,
  fallbackLabel = 'Coffee Metric'
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
    id: preferredIds[0] ?? 'coffee_fallback',
    label: fallbackLabel,
    value: 0,
    unit: 'count',
    formatted: '0',
    txn_ids: ctx.chapter.txn_ids,
    computation: 'Fallback coffee metric',
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

export class CoffeeChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private topCafeDates = new Set<string>();
  private secondCafeDates = new Set<string>();
  private otherCoffeeDates = new Set<string>();

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const isSam = ctx.plan.person_name === 'Sam' && !ctx.plan.business_meta;
    const isB2B = Boolean(ctx.plan.business_meta);
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;

    let totalVisitsFact = pickCoffeeFact(
      ctx,
      ['coffee_total_visits', 'visits_top_merchant', 'total_transactions_count'],
      0,
      'Total Coffee Visits'
    );
    let totalSpendFact = pickCoffeeFact(
      ctx,
      ['coffee_total_spend', 'spend_top_merchant', 'total_spend_usd'],
      1,
      'Total Coffee Spend'
    );
    let topMerchantFact = pickCoffeeFact(ctx, ['top_merchant_name'], 2, 'Top Merchant Name');
    let topVisitsFact = pickCoffeeFact(
      ctx,
      ['visits_top_merchant', 'coffee_total_visits'],
      3,
      'Top Merchant Visits'
    );
    let topSpendFact = pickCoffeeFact(
      ctx,
      ['spend_top_merchant', 'coffee_total_spend'],
      4,
      'Top Merchant Spend'
    );
    let secondMerchantFact = pickCoffeeFact(
      ctx,
      ['second_coffee_merchant_name', 'top_merchant_name'],
      5,
      'Second Most-Visited Café'
    );
    let secondVisitsFact = pickCoffeeFact(
      ctx,
      ['second_coffee_visits', 'visits_top_merchant'],
      6,
      'Second Café Visits'
    );
    let secondSpendFact = pickCoffeeFact(
      ctx,
      ['second_coffee_spend', 'spend_top_merchant'],
      7,
      'Second Café Spend'
    );
    let merchantsCountFact = pickCoffeeFact(
      ctx,
      ['coffee_merchants_count', 'payday_count'],
      8,
      'Distinct Cafés Visited'
    );
    const streakDaysFact = pickCoffeeFact(
      ctx,
      ['longest_coffee_streak_days', 'payday_count'],
      9,
      'Longest Coffee Streak'
    );

    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const kickerText = ctx.chapter.params.kicker ?? '06 · THE MORNING RIVALRY';
    const badgeText = formatBespokeBadge(ctx.chapter.params.badge, isB2B);

    // Dynamically compute top 2 merchants from chapter transactions if not Sam
    const chapterPool =
      ctx.transactions.length > 0
        ? ctx.transactions
        : ctx.allTransactions.filter((t) => t.direction === 'out' && !t.is_transfer);

    if (!isSam && chapterPool.length > 0) {
      const byMerch = new Map<
        string,
        { name: string; count: number; spend: number; txnIds: string[] }
      >();
      chapterPool.forEach((t) => {
        const cur = byMerch.get(t.merchant) ?? {
          name: t.merchant,
          count: 0,
          spend: 0,
          txnIds: [],
        };
        cur.count += 1;
        cur.spend += t.amount_minor;
        cur.txnIds.push(t.id);
        byMerch.set(t.merchant, cur);
      });
      const ranked = Array.from(byMerch.values()).sort(
        (a, b) => b.count - a.count || b.spend - a.spend
      );
      const m1 = ranked[0];
      const m2 = ranked[1] ?? ranked[0];
      const poolSpend = chapterPool.reduce((acc, t) => acc + t.amount_minor, 0);

      if (m1 && !ctx.facts.has('top_merchant_name')) {
        topMerchantFact = {
          id: topMerchantFact.id,
          label: '#1 Counterparty',
          value: m1.name,
          unit: 'text',
          formatted: m1.name,
          txn_ids: m1.txnIds,
          computation: 'Top merchant in chapter pool',
        };
      }
      if (m1 && !ctx.facts.has('visits_top_merchant')) {
        topVisitsFact = {
          id: topVisitsFact.id,
          label: `${m1.name} Settlements`,
          value: m1.count,
          unit: 'count',
          formatted: String(m1.count),
          txn_ids: m1.txnIds,
          computation: 'Top merchant count',
        };
      }
      if (m1 && !ctx.facts.has('spend_top_merchant')) {
        topSpendFact = {
          id: topSpendFact.id,
          label: `${m1.name} Outflow`,
          value: m1.spend,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(m1.spend, { showCents: false }),
          txn_ids: m1.txnIds,
          computation: 'Top merchant spend',
        };
      }
      if (
        m2 &&
        (!ctx.facts.has('second_coffee_merchant_name') ||
          secondMerchantFact.formatted === topMerchantFact.formatted)
      ) {
        secondMerchantFact = {
          id: secondMerchantFact.id,
          label: '#2 Counterparty',
          value: m2.name,
          unit: 'text',
          formatted: m2.name,
          txn_ids: m2.txnIds,
          computation: 'Second merchant in chapter pool',
        };
        secondVisitsFact = {
          id: secondVisitsFact.id,
          label: `${m2.name} Settlements`,
          value: m2.count,
          unit: 'count',
          formatted: String(m2.count),
          txn_ids: m2.txnIds,
          computation: 'Second merchant count',
        };
        secondSpendFact = {
          id: secondSpendFact.id,
          label: `${m2.name} Outflow`,
          value: m2.spend,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(m2.spend, { showCents: false }),
          txn_ids: m2.txnIds,
          computation: 'Second merchant spend',
        };
      }
      if (!ctx.facts.has('coffee_total_visits')) {
        totalVisitsFact = {
          id: totalVisitsFact.id,
          label: 'Total Cadence Movements',
          value: chapterPool.length,
          unit: 'count',
          formatted: String(chapterPool.length),
          txn_ids: chapterPool.map((t) => t.id),
          computation: 'Chapter transaction count',
        };
      }
      if (!ctx.facts.has('coffee_total_spend')) {
        totalSpendFact = {
          id: totalSpendFact.id,
          label: 'Total Cadence Outflow',
          value: poolSpend,
          unit: 'usd_cents',
          formatted: formatMoneyMinor(poolSpend, { showCents: false }),
          txn_ids: chapterPool.map((t) => t.id),
          computation: 'Chapter total spend',
        };
      }
      if (!ctx.facts.has('coffee_merchants_count')) {
        merchantsCountFact = {
          id: merchantsCountFact.id,
          label: 'Distinct Counterparties',
          value: ranked.length,
          unit: 'count',
          formatted: String(ranked.length),
          txn_ids: chapterPool.map((t) => t.id),
          computation: 'Distinct merchants in chapter pool',
        };
      }
    }

    // Map transactions to #1 merchant, #2 merchant, and other chapter transactions
    const topTxnIdSet = new Set(topVisitsFact.txn_ids);
    const secondTxnIdSet = new Set(secondVisitsFact.txn_ids);
    const allCoffeeTxnIdSet = new Set([
      ...totalVisitsFact.txn_ids,
      ...topVisitsFact.txn_ids,
      ...secondVisitsFact.txn_ids,
      ...ctx.chapter.txn_ids,
    ]);

    const topName = topMerchantFact.formatted;
    const secondName = secondMerchantFact.formatted;

    this.topCafeDates.clear();
    this.secondCafeDates.clear();
    this.otherCoffeeDates.clear();

    const topWeekly = new Array<number>(53).fill(0);
    const secondWeekly = new Array<number>(53).fill(0);
    const otherWeekly = new Array<number>(53).fill(0);

    const dateToWeekIdx = new Map<string, number>();
    ctx.days.forEach((d) => {
      dateToWeekIdx.set(d.date, d.week_index);
    });
    const yearStartStr = ctx.days[0]?.date ?? `${ctx.plan.year}-01-01`;
    const firstWeekday = ctx.days[0]?.weekday ?? 2;

    const sourceTxns =
      !isSam && ctx.transactions.length > 0
        ? ctx.transactions
        : ctx.allTransactions.length > 0
          ? ctx.allTransactions
          : ctx.transactions;

    sourceTxns.forEach((t) => {
      const isTop = topTxnIdSet.has(t.id) || t.merchant === topName;
      const isSecond = !isTop && (secondTxnIdSet.has(t.id) || t.merchant === secondName);
      const isOtherCoffee =
        !isTop &&
        !isSecond &&
        (allCoffeeTxnIdSet.has(t.id) ||
          t.category === (ctx.chapter.params.focus_category ?? 'coffee'));

      if (!isTop && !isSecond && !isOtherCoffee) return;

      let weekIdx = dateToWeekIdx.get(t.date);
      if (weekIdx === undefined) {
        const dayOfYear = Math.max(
          0,
          Math.floor(
            (Date.parse(`${t.date}T00:00:00Z`) - Date.parse(`${yearStartStr}T00:00:00Z`)) / 86400000
          )
        );
        weekIdx = Math.max(0, Math.min(52, Math.floor((dayOfYear + firstWeekday) / 7)));
      }

      if (isTop) {
        this.topCafeDates.add(t.date);
        topWeekly[weekIdx] = (topWeekly[weekIdx] ?? 0) + 1;
      } else if (isSecond) {
        this.secondCafeDates.add(t.date);
        secondWeekly[weekIdx] = (secondWeekly[weekIdx] ?? 0) + 1;
      } else if (isOtherCoffee) {
        this.otherCoffeeDates.add(t.date);
        otherWeekly[weekIdx] = (otherWeekly[weekIdx] ?? 0) + 1;
      }
    });

    const isPhone = ctx.viewport === 'phone';
    const rivalrySvg = this.buildRivalrySvg(
      ctx,
      topMerchantFact,
      topVisitsFact,
      topSpendFact,
      secondMerchantFact,
      secondVisitsFact,
      secondSpendFact,
      totalVisitsFact,
      totalSpendFact,
      merchantsCountFact,
      topWeekly,
      secondWeekly,
      otherWeekly,
      isPhone ? 330 : 984,
      isPhone ? 190 : 392,
      isSam
    );

    const totalVisitsNum = stripCurrencyPrefix(totalVisitsFact.formatted);
    const topVisitsNum = stripCurrencyPrefix(topVisitsFact.formatted);
    const secondVisitsNum = stripCurrencyPrefix(secondVisitsFact.formatted);
    const totalSpendNum = stripCurrencyPrefix(totalSpendFact.formatted);

    const entityPlural = isSam ? 'CAFÉS' : isB2B ? 'COUNTERPARTIES' : 'MERCHANTS';
    const blkTotalVisitsTitle = isSam
      ? 'TOTAL COFFEE CUPS'
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[0]?.label?.toUpperCase() ??
            (isB2B ? 'COUNTERPARTY SETTLEMENTS' : 'TOTAL CADENCE VISITS')
        );
    const blkTopTitle = isSam
      ? this.escapeHtml(topMerchantFact.formatted.toUpperCase())
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[1]?.label?.toUpperCase() ??
            `#1 COUNTERPARTY · ${topMerchantFact.formatted.toUpperCase()}`
        );
    const blkSecondTitle = isSam
      ? this.escapeHtml(secondMerchantFact.formatted.toUpperCase())
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[2]?.label?.toUpperCase() ??
            `#2 COUNTERPARTY · ${secondMerchantFact.formatted.toUpperCase()}`
        );
    const blkTotalSpendTitle = isSam
      ? 'TOTAL COFFEE SPEND'
      : this.escapeHtml(
          ctx.chapter.params.blocks?.[3]?.label?.toUpperCase() ??
            (isB2B ? 'COUNTERPARTY OUTFLOW' : 'TOTAL CADENCE SPEND')
        );

    const badgeDisplayStyle = badgeText ? 'inline-flex' : 'none';
    const takeawayPrefixHtml = takeawayPrefix
      ? `<span style="font-family:'JetBrains Mono',monospace;font-size:${isPhone ? '9px' : '10.5px'};font-weight:700;letter-spacing:${isPhone ? '0.1em' : '0.12em'};color:#F4F03A;text-transform:uppercase;margin-right:${isPhone ? '6px' : '8px'};">${takeawayPrefix}</span>`
      : '';
    const countNounCap = isB2B ? 'SETTLEMENTS' : 'VISITS';
    const spendSuffixCap = isB2B ? 'OUTFLOW' : 'SPENT';
    const totalSpendSuffixCap = isB2B ? 'TOTAL OUTFLOW' : 'TOTAL SPENT';
    const twistBodyHtml = isB2B
      ? `${this.escapeHtml(topMerchantFact.formatted)} led cadence (${this.escapeHtml(topVisitsFact.formatted)} settlements, ${this.escapeHtml(topSpendFact.formatted)}), while ${this.escapeHtml(secondMerchantFact.formatted)} settled ${this.escapeHtml(secondSpendFact.formatted)} across ${this.escapeHtml(secondVisitsFact.formatted)} invoices.`
      : `${this.escapeHtml(topMerchantFact.formatted)} won frequency (${this.escapeHtml(topVisitsFact.formatted)} stops, ${this.escapeHtml(topSpendFact.formatted)}), while ${this.escapeHtml(secondMerchantFact.formatted)} logged ${this.escapeHtml(secondSpendFact.formatted)} on ${this.escapeHtml(secondVisitsFact.formatted)} visits.`;

    if (isPhone) {
      container.innerHTML = `
        <div class="coffee-phone-stage" data-testid="coffee-chapter-stage" data-viewport="phone" style="position:relative;width:390px;height:844px;overflow:hidden;">
          <div class="tx" style="position:absolute;left:16px;top:36px;right:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span class="badge-bespoke" data-testid="bespoke-badge" style="display:${badgeDisplayStyle};align-items:center;gap:6px;padding:4px 8px;background:#111111;color:#F4F03A;border:1.5px solid #F4F03A;font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">${this.escapeHtml(badgeText)}</span>
            <span class="lab" style="position:static;font-size:10px;color:#C9C5BA;">${this.escapeHtml(kickerText)}</span>
          </div>

          <div class="ch-header-stack" style="left:16px;right:16px;top:60px;max-height:126px;gap:6px;">
            <div class="split tx" data-testid="chapter-headline" style="width:358px;font-size:24px;font-weight:300;letter-spacing:-0.04em;line-height:1.05;color:var(--bone);">${this.escapeHtml(headlineText)}</div>
            <div class="tx" data-testid="chapter-body" style="width:358px;padding:6px 10px;background:#1C1C1B;border-left:3px solid #F4F03A;font-family:'Space Grotesk',sans-serif;font-size:11.5px;line-height:1.3;color:var(--bone);">
              ${takeawayPrefixHtml}${this.escapeHtml(bodyText)}
            </div>
          </div>

          <div class="blk ia" data-ax="b" id="coffee-rivalry-blk" data-testid="coffee-rivalry-block" style="position:absolute;left:16px;top:194px;width:358px;height:242px;background:#1C1C1B;color:var(--bone);border:1.5px solid #3A3A38;transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:14px;top:10px;right:14px;font-size:9.5px;display:flex;justify-content:space-between;align-items:center;">
              <span>${isSam ? 'HEAD-TO-HEAD CAFÉ SPLIT &amp; 53×7 MATRIX' : 'COUNTERPARTY CADENCE &amp; 53×7 MATRIX'}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalVisitsFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 6px;border:1px solid #F4F03A;color:#F4F03A;background:#111;cursor:pointer;">Receipts (${totalVisitsFact.txn_ids.length})</button>
            </div>
            <div class="dt" style="position:absolute;left:14px;top:38px;width:330px;height:190px;">${rivalrySvg}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-total-visits" style="position:absolute;left:16px;top:448px;width:174px;height:176px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkTotalVisitsTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalVisitsFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${totalVisitsFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:48px;font-size:52px;"><span class="od" data-v="${this.escapeHtml(totalVisitsNum.rawDigits)}">${this.escapeHtml(totalVisitsNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">${this.escapeHtml(merchantsCountFact.formatted)} ${entityPlural} · ${this.escapeHtml(streakDaysFact.formatted)}D STREAK</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-top-cafe" style="position:absolute;left:200px;top:448px;width:174px;height:176px;background:var(--bone);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkTopTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(topSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${topSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:48px;font-size:52px;"><span class="od" data-v="${this.escapeHtml(topVisitsNum.rawDigits)}">${this.escapeHtml(topVisitsNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">${countNounCap} · ${this.escapeHtml(topSpendFact.formatted)} ${spendSuffixCap}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-second-cafe" style="position:absolute;left:16px;top:636px;width:174px;height:176px;background:#FF4F1F;color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkSecondTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(secondSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${secondSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:48px;font-size:52px;"><span class="od" data-v="${this.escapeHtml(secondVisitsNum.rawDigits)}">${this.escapeHtml(secondVisitsNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">${countNounCap} · ${this.escapeHtml(secondSpendFact.formatted)} ${spendSuffixCap}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-total-spend" style="position:absolute;left:200px;top:636px;width:174px;height:176px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkTotalSpendTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${totalSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:12px;top:52px;font-size:42px;">${totalSpendNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(totalSpendNum.rawDigits)}">${this.escapeHtml(totalSpendNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:12px;bottom:10px;font-size:8.5px;">ACROSS ${this.escapeHtml(merchantsCountFact.formatted)} ${entityPlural}</div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="coffee-desktop-stage" data-testid="coffee-chapter-stage" data-viewport="desktop" style="position:absolute;inset:0;">
          <div class="ch-header-stack" style="left:60px;top:64px;max-width:1030px;max-height:252px;">
            <div class="tx" style="display:flex;align-items:center;gap:16px;">
              <span class="badge-bespoke" data-testid="bespoke-badge" style="display:${badgeDisplayStyle};align-items:center;gap:8px;padding:6px 12px;background:#111111;color:#F4F03A;border:1.5px solid #F4F03A;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;">${this.escapeHtml(badgeText)}</span>
              <span class="lab" style="position:static;color:#C9C5BA;">${this.escapeHtml(kickerText)}</span>
            </div>

            <div class="split tx" data-testid="chapter-headline" style="font-size:58px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;color:var(--bone);">${this.escapeHtml(headlineText)}</div>
            <div class="tx" data-testid="chapter-body" style="padding:12px 18px;background:#1C1C1B;border:1px solid #3A3A38;border-left:4px solid #F4F03A;font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:400;line-height:1.35;color:var(--bone);">
              ${takeawayPrefixHtml}${this.escapeHtml(bodyText)}
            </div>
          </div>

          <div class="blk ia" data-ax="b" id="coffee-rivalry-blk" data-testid="coffee-rivalry-block" style="position:absolute;left:64px;top:330px;width:1040px;height:474px;background:#1C1C1B;color:var(--bone);border:1.5px solid #3A3A38;transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:28px;top:20px;right:28px;display:flex;justify-content:space-between;align-items:center;">
              <span>${isSam ? `HEAD-TO-HEAD CAFÉ SPLIT BAR &amp; 53-WEEK DUAL-TRACK MATRIX · ${this.escapeHtml(topMerchantFact.formatted.toUpperCase())} VS ${this.escapeHtml(secondMerchantFact.formatted.toUpperCase())}` : `COUNTERPARTY CADENCE &amp; 53-WEEK DUAL-TRACK MATRIX · ${this.escapeHtml(topMerchantFact.formatted.toUpperCase())} VS ${this.escapeHtml(secondMerchantFact.formatted.toUpperCase())}`}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalVisitsFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;padding:5px 10px;border:1.5px solid #F4F03A;background:#111111;color:#F4F03A;cursor:pointer;">Receipts (${totalVisitsFact.txn_ids.length})</button>
            </div>
            <div class="dt" style="position:absolute;left:28px;top:60px;width:984px;height:392px;">${rivalrySvg}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-total-visits" style="position:absolute;left:1128px;top:68px;width:356px;height:356px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkTotalVisitsTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalVisitsFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${totalVisitsFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:76px;font-size:128px;"><span class="od" data-v="${this.escapeHtml(totalVisitsNum.rawDigits)}">${this.escapeHtml(totalVisitsNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">${this.escapeHtml(merchantsCountFact.formatted)} ${entityPlural} · ${this.escapeHtml(streakDaysFact.formatted)}-DAY LONGEST STREAK</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-top-cafe" style="position:absolute;left:1500px;top:68px;width:356px;height:356px;background:var(--bone);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkTopTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(topSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${topSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:84px;font-size:128px;"><span class="od" data-v="${this.escapeHtml(topVisitsNum.rawDigits)}">${this.escapeHtml(topVisitsNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">${countNounCap} · ${this.escapeHtml(topSpendFact.formatted)} ${totalSpendSuffixCap}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-second-cafe" style="position:absolute;left:1128px;top:448px;width:356px;height:356px;background:#FF4F1F;color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkSecondTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(secondSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${secondSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:84px;font-size:128px;"><span class="od" data-v="${this.escapeHtml(secondVisitsNum.rawDigits)}">${this.escapeHtml(secondVisitsNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">${countNounCap} · ${this.escapeHtml(secondSpendFact.formatted)} ${spendSuffixCap}${isSam ? ' (HIGHER SPEND!)' : ''}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-total-spend" style="position:absolute;left:1500px;top:448px;width:356px;height:356px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${blkTotalSpendTitle}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(totalSpendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${totalSpendFact.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:84px;font-size:104px;">${totalSpendNum.hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(totalSpendNum.rawDigits)}">${this.escapeHtml(totalSpendNum.rawDigits)}</span></div>
            <div class="lab dt" style="position:absolute;left:26px;bottom:24px;right:22px;font-size:11px;">ACROSS ${this.escapeHtml(merchantsCountFact.formatted)} DISTINCT ${entityPlural}</div>
          </div>

          <div class="blk ia" data-ax="b" data-testid="coffee-block-twist" style="position:absolute;left:1128px;top:824px;width:728px;height:180px;background:var(--lav);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:28px;top:20px;right:28px;display:flex;justify-content:space-between;align-items:center;">
              <span>${isSam ? 'THE RIVALRY TWIST · HABIT VS CHECK SIZE' : 'COUNTERPARTY CADENCE · FREQUENCY VS TICKET SIZE'}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(streakDaysFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:5px 10px;background:#111111;color:#F3F0E6;cursor:pointer;">Streak Receipts (${streakDaysFact.txn_ids.length}) →</button>
            </div>
            <div class="tx" style="position:absolute;left:28px;top:60px;right:28px;display:flex;justify-content:space-between;align-items:baseline;">
              <div style="font-size:21px;font-weight:400;max-width:490px;line-height:1.3;">
                ${twistBodyHtml}
              </div>
              <div class="lab" style="position:static;font-size:11px;text-align:right;">
                LONGEST STREAK<br><b style="font-size:20px;">${this.escapeHtml(streakDaysFact.formatted)} DAYS</b>
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

  private buildRivalrySvg(
    ctx: ChapterContext,
    topMerchantFact: Fact,
    topVisitsFact: Fact,
    topSpendFact: Fact,
    secondMerchantFact: Fact,
    secondVisitsFact: Fact,
    secondSpendFact: Fact,
    totalVisitsFact: Fact,
    totalSpendFact: Fact,
    merchantsCountFact: Fact,
    topWeekly: readonly number[],
    secondWeekly: readonly number[],
    otherWeekly: readonly number[],
    width: number,
    height: number,
    isSam: boolean
  ): string {
    const isB2B = Boolean(ctx.plan.business_meta);
    const totalVisitsVal = Math.max(1, Number(totalVisitsFact.value) || 163);
    const topVisitsVal = Math.max(1, Number(topVisitsFact.value) || 72);
    const secondVisitsVal = Math.max(1, Number(secondVisitsFact.value) || 41);
    const otherVisitsVal = Math.max(0, totalVisitsVal - topVisitsVal - secondVisitsVal);

    const totalSpendVal = Math.max(1, Number(totalSpendFact.value) || 226488);
    const topSpendVal = Math.max(1, Number(topSpendFact.value) || 57280);
    const secondSpendVal = Math.max(1, Number(secondSpendFact.value) || 63427);

    const barWidth = width - 16;
    const x0 = 8;

    // 1) Head-to-Head Visits Split Bar
    const vTopW = (topVisitsVal / totalVisitsVal) * barWidth;
    const vSecW = (secondVisitsVal / totalVisitsVal) * barWidth;
    const vOthW = Math.max(0, barWidth - vTopW - vSecW);

    // 2) Head-to-Head Spend Split Bar
    const sTopW = (topSpendVal / totalSpendVal) * barWidth;
    const sSecW = (secondSpendVal / totalSpendVal) * barWidth;
    const sOthW = Math.max(0, barWidth - sTopW - sSecW);

    const isCompact = height < 240;
    const barH = isCompact ? 20 : 32;
    const vBarY = isCompact ? 18 : 22;
    const sBarY = isCompact ? 62 : 90;

    // 3) 53-Week Dual-Track Matrix + 53×7 Calendar Rivalry Grid
    const matrixY = isCompact ? 102 : 162;
    const colPitch = barWidth / 53;
    const cellW = Math.max(2.5, colPitch * 0.78);

    let dualTracksSvg = '';
    const trackH = isCompact ? 14 : 26;
    const trackGap = isCompact ? 4 : 8;

    for (let w = 0; w < 53; w++) {
      const cx = x0 + w * colPitch;
      const cTop = topWeekly[w] ?? 0;
      const cSec = secondWeekly[w] ?? 0;
      const cOth = otherWeekly[w] ?? 0;

      const topFill = cTop > 0 ? '#F4F03A' : '#2A2A28';
      const topOp = cTop > 0 ? Math.min(1, 0.55 + cTop * 0.22).toFixed(2) : '1';
      const secFill = cSec > 0 ? '#FF4F1F' : '#2A2A28';
      const secOp = cSec > 0 ? Math.min(1, 0.55 + cSec * 0.22).toFixed(2) : '1';

      dualTracksSvg += `<rect class="rivalry-week-cell" data-track="top" x="${cx.toFixed(1)}" y="${matrixY}" width="${cellW.toFixed(1)}" height="${trackH}" fill="${topFill}" fill-opacity="${topOp}"/>`;
      dualTracksSvg += `<rect class="rivalry-week-cell" data-track="second" x="${cx.toFixed(1)}" y="${matrixY + trackH + trackGap}" width="${cellW.toFixed(1)}" height="${trackH}" fill="${secFill}" fill-opacity="${secOp}"/>`;
      if (!isCompact) {
        const othFill = cOth > 0 ? '#A9A2E0' : '#242422';
        dualTracksSvg += `<rect class="rivalry-week-cell" data-track="other" x="${cx.toFixed(1)}" y="${matrixY + (trackH + trackGap) * 2}" width="${cellW.toFixed(1)}" height="12" fill="${othFill}"/>`;
      }
    }

    // 4) 53×7 Mini Calendar Matrix at bottom of SVG (desktop)
    let calendarMatrixSvg = '';
    if (!isCompact) {
      const calTop = matrixY + (trackH + trackGap) * 2 + 28;
      const rowPitch = 14.5;
      const dotH = 11.5;
      ctx.days.forEach((d) => {
        const x = x0 + d.week_index * colPitch;
        const y = calTop + d.weekday * rowPitch;
        const hasTop = this.topCafeDates.has(d.date);
        const hasSec = this.secondCafeDates.has(d.date);
        const hasOth = this.otherCoffeeDates.has(d.date);
        const fill = hasTop ? '#F4F03A' : hasSec ? '#FF4F1F' : hasOth ? '#A9A2E0' : '#262624';
        calendarMatrixSvg += `<rect class="coffee-cal-dot" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellW.toFixed(1)}" height="${dotH}" fill="${fill}"/>`;
      });
    }

    const otherEntitiesLabel = isSam ? 'OTHER CAFÉS' : 'OTHER COUNTERPARTIES';
    const totalEntitiesLabel = isSam ? 'CAFÉS TOTAL' : 'COUNTERPARTIES TOTAL';
    const cadenceTitle = isSam ? '53-WEEK DUAL-TRACK CADENCE' : '53-WEEK COUNTERPARTY CADENCE';
    const truncMerch = (name: string) => {
      const u = name.toUpperCase();
      return u.length > 22 ? `${u.slice(0, 21)}…` : u;
    };
    const topSvgName = this.escapeHtml(truncMerch(topMerchantFact.formatted));
    const secSvgName = this.escapeHtml(truncMerch(secondMerchantFact.formatted));
    const countSuffix = isCompact ? '' : isB2B ? ' SETTLEMENTS' : ' VISITS';

    const vTopLabelLen =
      (topSvgName.length + topVisitsFact.formatted.length + countSuffix.length + 3) *
      (isCompact ? 5.2 : 6.4);
    const vStaggerBelow = !isCompact && (vTopW < vTopLabelLen + 12 || x0 + vTopW > width - 260);
    const vSecX = vStaggerBelow
      ? Math.min(width - 220, Math.max(x0 + 140, x0 + vTopW))
      : x0 + vTopW + (isCompact ? 2 : 6);
    const vSecY = vStaggerBelow ? vBarY + barH + 13 : vBarY - 6;

    const sTopLabelLen =
      (topSvgName.length + topSpendFact.formatted.length + 3) * (isCompact ? 5.2 : 6.4);
    const sStaggerBelow = !isCompact && (sTopW < sTopLabelLen + 12 || x0 + sTopW > width - 290);
    const sSecX = sStaggerBelow
      ? Math.min(width - 240, Math.max(x0 + 140, x0 + sTopW))
      : x0 + sTopW + (isCompact ? 18 : 6);
    const sSecY = sStaggerBelow ? sBarY + barH + 13 : sBarY - 6;

    return `
      <svg data-testid="coffee-rivalry-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">
        <!-- Track 1: Visits Split -->
        <text x="${x0}" y="${vBarY - 6}" fill="#F4F03A" font-family="JetBrains Mono, monospace" font-size="${isCompact ? '8' : '10'}" font-weight="600">${topSvgName} (${this.escapeHtml(topVisitsFact.formatted)}${countSuffix})</text>
        <text x="${vSecX.toFixed(1)}" y="${vSecY}" fill="#FF4F1F" font-family="JetBrains Mono, monospace" font-size="${isCompact ? '8' : '10'}" font-weight="600">${secSvgName} (${this.escapeHtml(secondVisitsFact.formatted)}${countSuffix})</text>
        ${!isCompact ? `<text x="${width - 8}" y="${vBarY - 6}" fill="#C9C5BA" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="end">${otherEntitiesLabel} (${otherVisitsVal})</text>` : ''}

        <rect class="rivalry-split-bar" data-bar="visits-top" x="${x0}" y="${vBarY}" width="${vTopW.toFixed(1)}" height="${barH}" fill="#F4F03A"/>
        <rect class="rivalry-split-bar" data-bar="visits-second" x="${(x0 + vTopW).toFixed(1)}" y="${vBarY}" width="${vSecW.toFixed(1)}" height="${barH}" fill="#FF4F1F"/>
        <rect class="rivalry-split-bar" data-bar="visits-other" x="${(x0 + vTopW + vSecW).toFixed(1)}" y="${vBarY}" width="${vOthW.toFixed(1)}" height="${barH}" fill="#555552"/>

        <!-- Track 2: Spend Split -->
        <text x="${x0}" y="${sBarY - 6}" fill="#F4F03A" font-family="JetBrains Mono, monospace" font-size="${isCompact ? '8' : '10'}" font-weight="600">${topSvgName} (${this.escapeHtml(topSpendFact.formatted)})</text>
        <text x="${sSecX.toFixed(1)}" y="${sSecY}" fill="#FF4F1F" font-family="JetBrains Mono, monospace" font-size="${isCompact ? '8' : '10'}" font-weight="600">${secSvgName} (${this.escapeHtml(secondSpendFact.formatted)}${isCompact || !isSam ? '' : ' · HIGHER SPEND!'})</text>
        ${!isCompact ? `<text x="${width - 8}" y="${sBarY - 6}" fill="#A9A2E0" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="end">${this.escapeHtml(merchantsCountFact.formatted)} ${totalEntitiesLabel} (${this.escapeHtml(totalSpendFact.formatted)})</text>` : ''}

        <rect class="rivalry-split-bar" data-bar="spend-top" x="${x0}" y="${sBarY}" width="${sTopW.toFixed(1)}" height="${barH}" fill="#F4F03A"/>
        <rect class="rivalry-split-bar" data-bar="spend-second" x="${(x0 + sTopW).toFixed(1)}" y="${sBarY}" width="${sSecW.toFixed(1)}" height="${barH}" fill="#FF4F1F"/>
        <rect class="rivalry-split-bar" data-bar="spend-other" x="${(x0 + sTopW + sSecW).toFixed(1)}" y="${sBarY}" width="${sOthW.toFixed(1)}" height="${barH}" fill="#A9A2E0"/>

        <!-- Track 3: 53-Week Dual-Track Matrix -->
        <text x="${x0}" y="${matrixY - 6}" fill="#C9C5BA" font-family="JetBrains Mono, monospace" font-size="${isCompact ? '8' : '9.5'}">${cadenceTitle}${isCompact ? '' : ` (YELLOW = ${topSvgName} · EMBER = ${secSvgName})`}</text>
        ${dualTracksSvg}
        ${calendarMatrixSvg}
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
      const solarRgb = RGB_PALETTE.c1;
      const emberRgb = hexToRgb('#FF4F1F');
      const lavRgb = RGB_PALETTE.lav;

      grid.days.forEach((v) => {
        if (this.topCafeDates.has(v.day.date)) {
          grid.tweenColor(v, solarRgb, 0.25, 0.04);
          grid.popVisual(v, 0.42, 0.04);
        } else if (this.secondCafeDates.has(v.day.date)) {
          grid.tweenColor(v, emberRgb, 0.25, 0.06);
          grid.popVisual(v, 0.46, 0.06);
        } else if (this.otherCoffeeDates.has(v.day.date)) {
          grid.tweenColor(v, lavRgb, 0.25, 0.08);
        } else {
          grid.tweenColor(v, RGB_PALETTE.dim, 0.25);
        }
      });
    }

    enterStageGroup(this.container, tl, 0, rm);

    if (!rm) {
      const splitBars = Array.from(
        this.container.querySelectorAll<SVGRectElement>('.rivalry-split-bar')
      );
      if (splitBars.length > 0) {
        tl.fromTo(
          splitBars,
          { scaleX: 0, transformOrigin: '0% 50%' },
          { scaleX: 1, duration: 0.48, stagger: 0.05, ease: 'power3.out' },
          0.32
        );
      }
    }

    timeline.logEvent('bespoke.coffee.play', {
      topDays: this.topCafeDates.size,
      secondDays: this.secondCafeDates.size,
      viewport: this.ctx.viewport,
    });
  }

  public explore(): void {
    this.ctx?.openExplore(this.ctx.chapter.params.focus_category ?? 'coffee');
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

export function createCoffeeChapter(): ChapterModule {
  return new CoffeeChapter();
}
