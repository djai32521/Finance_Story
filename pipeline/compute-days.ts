import { isDiscretionaryCategory, type Day, type Transaction } from '../contracts/index.js';

/**
 * Generates all calendar Day entries for a given year (365 days, or 366 days on leap years).
 * Monday = 0 .. Sunday = 6 per D-09 and contracts/data.ts.
 */
export function computeDays(transactions: readonly Transaction[], year = 2025): Day[] {
  // Check if transactions represent a ~12-month fiscal period crossing two calendar years
  // (e.g. 2025-10-01 to 2026-09-30 in UK/enterprise trading workbooks).
  const sortedDates = transactions
    .map((t) => t.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];

  let startUtc = Date.UTC(year, 0, 1);
  let totalDays = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  let crossYearFiscal = false;

  if (minDate && maxDate) {
    const minY = Number.parseInt(minDate.slice(0, 4), 10);
    const maxY = Number.parseInt(maxDate.slice(0, 4), 10);
    const minM = Number.parseInt(minDate.slice(5, 7), 10);
    const minMs = Date.parse(`${minDate}T00:00:00Z`);
    const maxMs = Date.parse(`${maxDate}T00:00:00Z`);
    const spanDays = Math.round((maxMs - minMs) / 86400000);
    if (minY !== maxY && spanDays > 0 && spanDays <= 370) {
      crossYearFiscal = true;
      startUtc = Date.UTC(minY, minM - 1, 1);
      totalDays = 365;
    }
  }

  const byDate = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!crossYearFiscal && !t.date.startsWith(`${year}-`)) continue;
    const list = byDate.get(t.date);
    if (list) {
      list.push(t);
    } else {
      byDate.set(t.date, [t]);
    }
  }

  const firstDayJs = new Date(startUtc).getUTCDay();
  const firstDayWeekday = (firstDayJs + 6) % 7; // 0 = Monday .. 6 = Sunday

  const days: Day[] = [];

  for (let d = 0; d < totalDays; d++) {
    const cur = new Date(startUtc + d * 86400000);
    const isoDate = cur.toISOString().slice(0, 10);
    const jsDay = cur.getUTCDay();
    const weekday = (jsDay + 6) % 7;
    const weekIndex = Math.floor((d + firstDayWeekday) / 7);

    const dayTxns = byDate.get(isoDate) ?? [];
    let discretionaryOutMinor = 0;
    let allOutMinor = 0;
    let inMinor = 0;
    let isPayday = false;

    for (const t of dayTxns) {
      if (t.direction === 'out' && !t.is_transfer) {
        allOutMinor += t.amount_minor;
        if (!t.is_refund && isDiscretionaryCategory(t.category)) {
          discretionaryOutMinor += t.amount_minor;
        }
      } else if (t.direction === 'in' && !t.is_transfer && !t.is_refund) {
        inMinor += t.amount_minor;
        const contextStr = `${t.raw_description} ${t.merchant} ${t.category_label ?? ''}`;
        if (
          t.category === 'income' &&
          (/SALARY|WAGES|PAYROLL|REVENUE|ARR|MRR|SETTLEMENT|INVOICE|RETAINER|STRIPE|PAYOUT|CUSTOMER|SALES/i.test(
            contextStr
          ) ||
            t.amount_minor >= 200000)
        ) {
          isPayday = true;
        }
      }
    }

    days.push({
      date: isoDate,
      weekday,
      week_index: weekIndex,
      discretionary_out_minor: discretionaryOutMinor,
      all_out_minor: allOutMinor,
      in_minor: inMinor,
      txn_ids: dayTxns.map((t) => t.id),
      is_payday: isPayday,
    });
  }

  // Fallback for B2B datasets where revenue inflows are smaller than $2,000 and use custom descriptions
  if (!days.some((d) => d.is_payday)) {
    for (const d of days) {
      if (d.in_minor > 0) {
        const dayTxns = byDate.get(d.date) ?? [];
        const hasNonInterestInflow = dayTxns.some(
          (t) =>
            t.direction === 'in' &&
            !t.is_transfer &&
            !t.is_refund &&
            t.tran_type !== 'INT' &&
            !/^BANK - INTEREST/i.test(t.raw_description)
        );
        if (hasNonInterestInflow) {
          d.is_payday = true;
        }
      }
    }
  }

  // Fallback for single-direction operating/trading workbooks (where all rows are unsigned/outflows):
  // mark the peak settlement day of each month as a milestone so calendar cadence & heartbeat work.
  if (!days.some((d) => d.is_payday)) {
    const peakByMonth = new Map<string, Day>();
    for (const d of days) {
      if (d.all_out_minor <= 0) continue;
      const ym = d.date.slice(0, 7);
      const curPeak = peakByMonth.get(ym);
      if (!curPeak || d.all_out_minor > curPeak.all_out_minor) {
        peakByMonth.set(ym, d);
      }
    }
    for (const peakDay of peakByMonth.values()) {
      peakDay.is_payday = true;
    }
  }

  return days;
}
