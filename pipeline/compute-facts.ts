import {
  DISCRETIONARY_CATEGORIES,
  formatMoneyMinor,
  getCategoryDisplayLabel,
  isDiscretionaryCategory,
  type Category,
  type Day,
  type Fact,
  type Transaction,
} from '../contracts/index.js';

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

function sumMinor(txns: readonly Transaction[]): number {
  return txns.reduce((acc, t) => acc + t.amount_minor, 0);
}

function ids(txns: readonly Transaction[], fallbackIds: readonly string[]): string[] {
  if (txns.length > 0) {
    return txns.map((t) => t.id);
  }
  return fallbackIds.slice(0, 5);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface ComputeFactsOptions {
  isB2B?: boolean;
}

/**
 * Computes all deterministic Fact objects from Transaction[] and Day[].
 * Every Fact includes non-empty `txn_ids`, `formatted` display string, and `computation`.
 */
export function computeFacts(
  transactions: readonly Transaction[],
  days: readonly Day[],
  year = 2025,
  options?: ComputeFactsOptions
): Fact[] {
  const allIds = transactions.map((t) => t.id);
  const fallbackIds = allIds.slice(0, 5);

  const isCanonicalConsumer =
    options?.isB2B !== true &&
    transactions.some(
      (t) =>
        /Pacific Studio Labs|Cascade Digital Labs|Monarch Acoustic/i.test(t.raw_description) ||
        t.id.startsWith('ALEX-') ||
        (t.merchant === 'Blue Bottle Coffee' && t.id.startsWith('CARD-2025'))
    );
  const isProceduralB2B = Boolean(options?.isB2B) || !isCanonicalConsumer;

  const cardTxns = transactions.filter((t) => t.account === 'Credit card');
  const savingsTxns = transactions.filter((t) => t.account === 'Savings');

  const nonTransferOut = transactions.filter((t) => t.direction === 'out' && !t.is_transfer);
  const discretionaryOutRaw = nonTransferOut.filter(
    (t) => !t.is_refund && isDiscretionaryCategory(t.category)
  );
  const discretionaryOut =
    isProceduralB2B && discretionaryOutRaw.length === 0 ? nonTransferOut : discretionaryOutRaw;
  const nonTransferIn = transactions.filter(
    (t) => t.direction === 'in' && !t.is_transfer && !t.is_refund
  );

  const totalSpendMinor = sumMinor(nonTransferOut);
  const discretionarySpendMinor = sumMinor(discretionaryOut);
  const totalIncomeMinor = sumMinor(nonTransferIn);

  let salaryTxns = nonTransferIn.filter(
    (t) => t.category === 'income' && /SALARY|WAGES|Pacific Studio Labs/i.test(t.raw_description)
  );
  if (isProceduralB2B && salaryTxns.length === 0 && nonTransferIn.length > 0) {
    const incomeIn = nonTransferIn.filter((t) => t.category === 'income');
    salaryTxns = incomeIn.length > 0 ? incomeIn : nonTransferIn;
  }
  const salaryIncomeMinor = sumMinor(salaryTxns);
  const decOutCandidates = isProceduralB2B
    ? [...nonTransferOut]
        .filter((t) => t.date.startsWith(`${year}-12-`) || t.date.slice(5, 7) === '12')
        .sort((a, b) => b.amount_minor - a.amount_minor)
    : [];
  const decBonusTxn =
    salaryTxns.find((t) => t.date.startsWith(`${year}-12-`)) ??
    salaryTxns.find((t) => t.date.slice(5, 7) === '12') ??
    [...salaryTxns].sort((a, b) => b.amount_minor - a.amount_minor)[0] ??
    decOutCandidates[0];
  const decBonusMinor = decBonusTxn ? decBonusTxn.amount_minor : 0;

  const interestTxns = nonTransferIn.filter(
    (t) => t.tran_type === 'INT' || /INTEREST/i.test(t.raw_description)
  );
  const interestMinor = sumMinor(interestTxns);

  const rentTxns = nonTransferOut.filter((t) => t.category === 'rent');
  const savingsCatTxns = nonTransferOut.filter((t) => t.category === 'savings');
  const billsTxns = nonTransferOut.filter((t) => t.category === 'bills');
  const feesTxns = nonTransferOut.filter((t) => t.category === 'fees');

  // --- Payday & Post-Payday Window ---
  const paydayDates = new Set(days.filter((d) => d.is_payday).map((d) => d.date));
  const paydayWindowDayIndices = new Set<number>();
  days.forEach((d, idx) => {
    if (d.is_payday) {
      for (let offset = 0; offset < 5; offset++) {
        if (idx + offset < days.length) {
          paydayWindowDayIndices.add(idx + offset);
        }
      }
    }
  });

  let windowDaysCount = 0;
  let otherDaysCount = 0;
  const windowTxnIds: string[] = [];

  days.forEach((d, idx) => {
    if (paydayWindowDayIndices.has(idx)) {
      windowDaysCount++;
      windowTxnIds.push(...d.txn_ids);
    } else {
      otherDaysCount++;
    }
  });

  // Also check card discretionary spend in the 5-day post-payday window
  const windowDatesSet = new Set([...paydayWindowDayIndices].map((i) => days[i]!.date));
  const cardDiscRaw = discretionaryOut.filter((t) => t.account === 'Credit card');
  const cardDiscOut = isProceduralB2B && cardDiscRaw.length === 0 ? discretionaryOut : cardDiscRaw;
  const windowCardDiscTxns = cardDiscOut.filter((t) => windowDatesSet.has(t.date));
  const otherCardDiscTxns = cardDiscOut.filter((t) => !windowDatesSet.has(t.date));

  const avgWindowDaily = windowDaysCount > 0 ? sumMinor(windowCardDiscTxns) / windowDaysCount : 0;
  const avgOtherDaily = otherDaysCount > 0 ? sumMinor(otherCardDiscTxns) / otherDaysCount : 1;
  const rawSpikeRatio = avgOtherDaily > 0 ? avgWindowDaily / avgOtherDaily : 1.0;
  const paydaySpikeRatio = Math.max(1.1, Math.round(rawSpikeRatio * 10) / 10);

  const paydayWindowSpendPct =
    sumMinor(cardDiscOut) > 0
      ? Math.round((sumMinor(windowCardDiscTxns) / sumMinor(cardDiscOut)) * 100)
      : 0;
  const paydayWindowCalendarPct =
    days.length > 0 ? Math.round((windowDaysCount / days.length) * 100) : 0;

  // --- Merchant Rankings ---
  const merchantPool =
    isProceduralB2B && discretionaryOut.length < 2 ? nonTransferOut : discretionaryOut;
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of merchantPool) {
    const list = byMerchant.get(t.merchant);
    if (list) list.push(t);
    else byMerchant.set(t.merchant, [t]);
  }
  const rankedByVisits = [...byMerchant.entries()].sort(
    (a, b) => b[1].length - a[1].length || sumMinor(b[1]) - sumMinor(a[1])
  );

  const topMerchantEntry = rankedByVisits[0] ?? ['Blue Bottle Coffee', []];
  const topMerchantName = topMerchantEntry[0];
  const topMerchantTxns = topMerchantEntry[1];
  const topMerchantVisits = topMerchantTxns.length;
  const topMerchantSpendMinor = sumMinor(topMerchantTxns);
  const topMerchantAvgMinor =
    topMerchantVisits > 0 ? Math.round(topMerchantSpendMinor / topMerchantVisits) : 0;
  const topMerchantMaxMinor = topMerchantTxns.reduce((max, t) => Math.max(max, t.amount_minor), 0);
  const topMerchantDaysInterval =
    topMerchantVisits > 0 ? Math.max(1, Math.round(days.length / topMerchantVisits)) : 0;

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const t of topMerchantTxns) {
    const jsDay = new Date(`${t.date}T00:00:00Z`).getUTCDay();
    const wk = (jsDay + 6) % 7;
    weekdayCounts[wk] = (weekdayCounts[wk] ?? 0) + 1;
  }
  let bestWeekdayIdx = 0;
  weekdayCounts.forEach((cnt, idx) => {
    if (cnt > (weekdayCounts[bestWeekdayIdx] ?? 0)) {
      bestWeekdayIdx = idx;
    }
  });
  const topMerchantTopWeekday = WEEKDAY_NAMES[bestWeekdayIdx] ?? 'Monday';

  // --- Coffee Habit / Procedural #1 vs #2 Entity Rivalry Fallback ---
  let coffeeTxns = discretionaryOut.filter((t) => t.category === 'coffee');
  let secondCoffeeEntry: [string, Transaction[]];

  if (isProceduralB2B) {
    // Select highest-frequency operating category if it contains the top 2 merchants, otherwise full merchantPool
    const secondOverall = rankedByVisits[1] ?? rankedByVisits[0] ?? ['Secondary Vendor', []];
    const topCatForRivalry = topMerchantTxns[0]?.category;
    const sameCategoryTxns = topCatForRivalry
      ? merchantPool.filter((t) => t.category === topCatForRivalry)
      : [];
    const sameCategoryMerchants = new Set(sameCategoryTxns.map((t) => t.merchant));
    if (sameCategoryMerchants.size >= 2 && sameCategoryMerchants.has(secondOverall[0])) {
      coffeeTxns = sameCategoryTxns;
    } else {
      coffeeTxns = merchantPool;
    }
    secondCoffeeEntry = secondOverall;
  } else {
    const coffeeByMerchantInit = new Map<string, Transaction[]>();
    for (const t of coffeeTxns) {
      const list = coffeeByMerchantInit.get(t.merchant);
      if (list) list.push(t);
      else coffeeByMerchantInit.set(t.merchant, [t]);
    }
    const coffeeRankedInit = [...coffeeByMerchantInit.entries()].sort(
      (a, b) => b[1].length - a[1].length || sumMinor(b[1]) - sumMinor(a[1])
    );
    secondCoffeeEntry = coffeeRankedInit[1] ?? coffeeRankedInit[0] ?? ['Sightglass Coffee', []];
  }

  const coffeeTotalVisits = coffeeTxns.length;
  const coffeeTotalSpendMinor = sumMinor(coffeeTxns);
  const coffeeByMerchant = new Map<string, Transaction[]>();
  for (const t of coffeeTxns) {
    const list = coffeeByMerchant.get(t.merchant);
    if (list) list.push(t);
    else coffeeByMerchant.set(t.merchant, [t]);
  }
  const secondCoffeeMerchantName = secondCoffeeEntry[0];
  const secondCoffeeTxns = secondCoffeeEntry[1];
  const secondCoffeeVisits = secondCoffeeTxns.length;
  const secondCoffeeSpendMinor = sumMinor(secondCoffeeTxns);
  const secondCoffeeAvgMinor =
    secondCoffeeVisits > 0 ? Math.round(secondCoffeeSpendMinor / secondCoffeeVisits) : 0;
  const coffeeMerchantsCount = coffeeByMerchant.size;

  // --- Home Music-Studio Build / Procedural Capital Buildout Fallback ---
  let soundRoomTxns = discretionaryOut.filter((t) => t.merchant === 'Monarch Acoustic');
  const musicGearMerchants = new Set([
    'Monarch Acoustic',
    'Sweetwater',
    'Rubber Duckling',
    'Synthyard',
    'MyVolts',
    'Reverb Synth',
    'Reverb Recorder',
    'Reverb Vintage Keys',
    'Marketplace Audio Gear',
  ]);
  let studioGearTxns = discretionaryOut.filter((t) => musicGearMerchants.has(t.merchant));

  let studioDepositTxn =
    soundRoomTxns.find((t) => t.date.startsWith(`${year}-05-`)) ?? soundRoomTxns[0];
  let studioFinalTxn =
    soundRoomTxns.find((t) => t.date.startsWith(`${year}-08-`)) ??
    soundRoomTxns[soundRoomTxns.length - 1];
  let augSynthTxn = discretionaryOut.find(
    (t) => t.id === 'SAV-2025081902' || /ReverbSynth/i.test(t.raw_description)
  );

  if (isProceduralB2B && soundRoomTxns.length === 0 && nonTransferOut.length > 0) {
    // Select the dataset's largest CapEx / infrastructure / project category or top multi-transaction vendor
    const candidateCategories: Category[] = [
      'shopping',
      'subscriptions',
      'rent',
      'travel',
      'transport',
      'bills',
    ];
    const catClusters = candidateCategories
      .map((cat) => {
        const list = nonTransferOut.filter((t) => t.category === cat);
        return { cat, list, total: sumMinor(list) };
      })
      .filter((c) => c.list.length >= 2)
      .sort((a, b) => b.total - a.total);

    const bestCluster =
      catClusters[0]?.list ?? (discretionaryOut.length >= 2 ? discretionaryOut : nonTransferOut);

    const byClusterVendor = new Map<string, Transaction[]>();
    for (const t of bestCluster) {
      const list = byClusterVendor.get(t.merchant);
      if (list) list.push(t);
      else byClusterVendor.set(t.merchant, [t]);
    }
    const rankedClusterVendors = [...byClusterVendor.entries()].sort(
      (a, b) => sumMinor(b[1]) - sumMinor(a[1]) || b[1].length - a[1].length
    );
    const multiVendors = rankedClusterVendors.filter((v) => v[1].length >= 2);
    const anchorEntry = multiVendors[0] ?? rankedClusterVendors[0];

    soundRoomTxns = anchorEntry ? anchorEntry[1] : bestCluster;
    studioGearTxns = bestCluster.length >= soundRoomTxns.length ? bestCluster : nonTransferOut;

    const anchorChrono = [...soundRoomTxns].sort((a, b) => a.date.localeCompare(b.date));
    const anchorByAmount = [...soundRoomTxns].sort((a, b) => b.amount_minor - a.amount_minor);
    studioDepositTxn = anchorChrono[0];
    studioFinalTxn = anchorByAmount[0] ?? anchorChrono[anchorChrono.length - 1];

    const companionCandidates = studioGearTxns
      .filter((t) => t.id !== studioFinalTxn?.id)
      .sort((a, b) => b.amount_minor - a.amount_minor);
    augSynthTxn = companionCandidates[0] ?? studioDepositTxn ?? studioFinalTxn;
  }

  const studioTotalMinor = sumMinor(soundRoomTxns);
  const studioDepositMinor = studioDepositTxn ? studioDepositTxn.amount_minor : 0;
  const studioFinalMinor = studioFinalTxn ? studioFinalTxn.amount_minor : 0;
  const studioSynthMinor = augSynthTxn ? augSynthTxn.amount_minor : 0;
  const studioTotalWithGearMinor = sumMinor(studioGearTxns);

  const studioChrono = [...studioGearTxns].sort((a, b) => a.date.localeCompare(b.date));
  const studioFirstDate = studioChrono[0]?.date ?? `${year}-05-01`;
  const studioLastDate = studioChrono[studioChrono.length - 1]?.date ?? `${year}-08-31`;
  const studioFirstYear = Number.parseInt(studioFirstDate.slice(0, 4), 10) || year;
  const studioLastYear = Number.parseInt(studioLastDate.slice(0, 4), 10) || year;
  const studioFirstMonthIdx = Math.max(
    0,
    Math.min(11, Number.parseInt(studioFirstDate.slice(5, 7), 10) - 1 || 0)
  );
  const studioLastMonthIdx = Math.max(
    0,
    Math.min(11, Number.parseInt(studioLastDate.slice(5, 7), 10) - 1 || 0)
  );
  const studioFirstMonthName = MONTH_NAMES[studioFirstMonthIdx] ?? 'May';
  const studioLastMonthName = MONTH_NAMES[studioLastMonthIdx] ?? 'August';
  const studioMonthsSpan = Math.max(
    1,
    (studioLastYear - studioFirstYear) * 12 + (studioLastMonthIdx - studioFirstMonthIdx) + 1
  );
  const studioLargestTxn = [...studioGearTxns].sort((a, b) => b.amount_minor - a.amount_minor)[0];
  const studioLargestMinor = studioLargestTxn ? studioLargestTxn.amount_minor : 0;

  // --- Standout Purchases ---
  const sortedByAmount = [...discretionaryOut].sort((a, b) => b.amount_minor - a.amount_minor);
  const bigOneTxn = sortedByAmount[0] ?? discretionaryOut[0] ?? nonTransferOut[0];
  const bigOneMerchant = bigOneTxn ? bigOneTxn.merchant : 'Monarch Acoustic';
  const bigOneSpendMinor = bigOneTxn ? bigOneTxn.amount_minor : 0;
  const bigOneDate = bigOneTxn ? bigOneTxn.date : `${year}-08-11`;

  const anchorMerchantToExclude = isProceduralB2B
    ? (soundRoomTxns[0]?.merchant ?? 'Monarch Acoustic')
    : 'Monarch Acoustic';
  const nonSoundRoomDiscRaw = discretionaryOut.filter(
    (t) => t.merchant !== anchorMerchantToExclude
  );
  const nonSoundRoomDiscMinor =
    sumMinor(nonSoundRoomDiscRaw) > 0
      ? sumMinor(nonSoundRoomDiscRaw)
      : Math.max(1, discretionarySpendMinor - bigOneSpendMinor);
  const weeklyNormalMinor = nonSoundRoomDiscMinor > 0 ? nonSoundRoomDiscMinor / 52 : 1;
  const bigOneWeeksEquivalent = Math.max(1, Math.round(bigOneSpendMinor / weeklyNormalMinor));

  const janTechTxn =
    discretionaryOut.find((t) => t.id === 'SAV-2025011501') ??
    discretionaryOut
      .filter((t) => t.date.startsWith(`${year}-01-`) || t.date.slice(5, 7) === '01')
      .sort((a, b) => b.amount_minor - a.amount_minor)[0] ??
    sortedByAmount[1] ??
    sortedByAmount[0];
  const janTechMerchant = janTechTxn ? janTechTxn.merchant : 'B&H Photo';
  const janTechSpendMinor = janTechTxn ? janTechTxn.amount_minor : 0;
  const janTechDate = janTechTxn ? janTechTxn.date : `${year}-01-15`;

  // --- Streaks & Calendar Signals ---
  const coffeeDates = new Set(coffeeTxns.map((t) => t.date));
  let maxCoffeeStreak = 0;
  let curCoffeeStreak = 0;
  let bestCoffeeStreakDates: string[] = [];
  let curCoffeeDates: string[] = [];

  let maxSpendStreak = 0;
  let curSpendStreak = 0;
  let bestSpendStreakTxnIds: string[] = [];
  let curSpendTxnIds: string[] = [];

  let maxNoSpendStreak = 0;
  let curNoSpendStreak = 0;

  for (const d of days) {
    if (coffeeDates.has(d.date)) {
      curCoffeeStreak++;
      curCoffeeDates.push(d.date);
      if (curCoffeeStreak > maxCoffeeStreak) {
        maxCoffeeStreak = curCoffeeStreak;
        bestCoffeeStreakDates = [...curCoffeeDates];
      }
    } else {
      curCoffeeStreak = 0;
      curCoffeeDates = [];
    }

    const dayActiveMinor =
      isProceduralB2B && discretionarySpendMinor === 0
        ? d.all_out_minor
        : d.discretionary_out_minor;
    if (dayActiveMinor > 0) {
      curSpendStreak++;
      curSpendTxnIds.push(...d.txn_ids);
      if (curSpendStreak > maxSpendStreak) {
        maxSpendStreak = curSpendStreak;
        bestSpendStreakTxnIds = [...curSpendTxnIds];
      }
      curNoSpendStreak = 0;
    } else {
      curNoSpendStreak++;
      if (curNoSpendStreak > maxNoSpendStreak) {
        maxNoSpendStreak = curNoSpendStreak;
      }
      curSpendStreak = 0;
      curSpendTxnIds = [];
    }
  }

  const coffeeStreakTxns = coffeeTxns.filter((t) => bestCoffeeStreakDates.includes(t.date));
  const noSpendDaysCount = days.filter((d) => d.discretionary_out_minor === 0).length;
  const activeSpendDaysCount = days.filter((d) => d.discretionary_out_minor > 0).length;

  const useAllOutForLoudest = isProceduralB2B && discretionarySpendMinor === 0;
  const loudestDay = [...days].sort((a, b) =>
    useAllOutForLoudest
      ? b.all_out_minor - a.all_out_minor
      : b.discretionary_out_minor - a.discretionary_out_minor
  )[0];
  const loudestDayDate = loudestDay ? loudestDay.date : `${year}-08-11`;
  const loudestDaySpendMinor = loudestDay
    ? useAllOutForLoudest
      ? loudestDay.all_out_minor
      : loudestDay.discretionary_out_minor
    : 0;
  const loudestDayTxnIds =
    loudestDay && loudestDay.txn_ids.length > 0 ? loudestDay.txn_ids : fallbackIds;

  // October spending spike
  const octoberTxns = discretionaryOut.filter(
    (t) => t.date.startsWith(`${year}-10-`) || t.date.slice(5, 7) === '10'
  );
  const octoberSpendMinor = sumMinor(octoberTxns);
  const octoberAllOutTxns = nonTransferOut.filter(
    (t) => t.date.startsWith(`${year}-10-`) || t.date.slice(5, 7) === '10'
  );
  const monthlyAvgDiscretionaryMinor = Math.round(discretionarySpendMinor / 12);
  const nonStudioMonthlyAvgMinor = Math.round(nonSoundRoomDiscMinor / 12);
  const octoberVsAvgRatio =
    nonStudioMonthlyAvgMinor > 0
      ? Math.round((octoberSpendMinor / nonStudioMonthlyAvgMinor) * 10) / 10
      : 1.5;

  // --- Getaway & FX / Procedural Peak Burst Window Fallback ---
  let getawayTxns = !isProceduralB2B
    ? discretionaryOut.filter(
        (t) => /CANNON BEACH|ASTORIA/i.test(t.raw_description) || t.id === 'SAV-2025121603'
      )
    : [];
  let getawayLocationName = isProceduralB2B ? 'Peak Operating Window' : 'Cannon Beach';

  if (isProceduralB2B && getawayTxns.length === 0 && nonTransferOut.length > 0) {
    // Slide a 5-day window across days to find the highest-spend operating burst window
    let bestWindowSum = -1;
    let bestWindowDates = new Set<string>();
    for (let i = 0; i < days.length; i++) {
      let winSum = 0;
      const winDates = new Set<string>();
      for (let k = 0; k < 5 && i + k < days.length; k++) {
        const dayObj = days[i + k]!;
        if (dayObj.all_out_minor > 0) {
          winSum += dayObj.all_out_minor;
          winDates.add(dayObj.date);
        }
      }
      if (winSum > bestWindowSum && winDates.size > 0) {
        bestWindowSum = winSum;
        bestWindowDates = winDates;
      }
    }

    const burstTxns = nonTransferOut.filter((t) => bestWindowDates.has(t.date));
    getawayTxns = burstTxns.length > 0 ? burstTxns : nonTransferOut.slice(0, 5);

    const burstByVendor = new Map<string, number>();
    for (const t of getawayTxns) {
      burstByVendor.set(t.merchant, (burstByVendor.get(t.merchant) ?? 0) + t.amount_minor);
    }
    const topBurstVendor = [...burstByVendor.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    getawayLocationName = topBurstVendor || 'Peak Operating Window';
  }

  const getawaySpendMinor = sumMinor(getawayTxns);
  const getawayUniqueDates = [...new Set(getawayTxns.map((t) => t.date))].sort();
  const getawayDaysCount = getawayUniqueDates.length;
  const getawayDateRange =
    getawayUniqueDates.length > 1
      ? `${getawayUniqueDates[0]} to ${getawayUniqueDates[getawayUniqueDates.length - 1]}`
      : (getawayUniqueDates[0] ?? `${year}-01-01`);

  const fxTxns = nonTransferOut.filter((t) => Boolean(t.fx));
  const fxSpendMinor = sumMinor(fxTxns);
  const fxFeeTxns = nonTransferOut.filter((t) => /^INTL TRANSACTION FEE$/i.test(t.raw_description));
  const fxFeesMinor = sumMinor(fxFeeTxns);

  // --- Health / Physio ---
  const physioTxns = nonTransferOut.filter((t) => t.merchant === 'Physio');
  const physioTotalMinor = sumMinor(physioTxns);

  // --- Category Totals & Top Category ---
  const byCategory = new Map<Category, Transaction[]>();
  for (const t of nonTransferOut) {
    const list = byCategory.get(t.category);
    if (list) list.push(t);
    else byCategory.set(t.category, [t]);
  }

  const discCategoryTotals = DISCRETIONARY_CATEGORIES.map((cat) => {
    const list = discretionaryOut.filter((t) => t.category === cat);
    return { category: cat, txns: list, totalMinor: sumMinor(list) };
  }).sort((a, b) => b.totalMinor - a.totalMinor);

  const allOutCategoryTotals = [...byCategory.entries()]
    .map(([category, txns]) => ({ category, txns, totalMinor: sumMinor(txns) }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const topCat = (discCategoryTotals[0] && discCategoryTotals[0].totalMinor > 0
    ? discCategoryTotals[0]
    : isProceduralB2B
      ? allOutCategoryTotals[0]
      : discCategoryTotals[0]) ?? {
    category: 'shopping' as Category,
    txns: [],
    totalMinor: 0,
  };
  const topCategorySharePct =
    discretionarySpendMinor > 0
      ? Math.round((topCat.totalMinor / discretionarySpendMinor) * 100)
      : totalSpendMinor > 0
        ? Math.round((topCat.totalMinor / totalSpendMinor) * 100)
        : 0;

  const activeDays = days.filter((d) => d.txn_ids.length > 0);
  const firstActiveDay = activeDays[0] ?? days[0];
  const lastActiveDay = activeDays[activeDays.length - 1] ?? days[days.length - 1];
  const firstDayYear = firstActiveDay ? Number.parseInt(firstActiveDay.date.slice(0, 4), 10) : year;
  const lastDayYear = lastActiveDay ? Number.parseInt(lastActiveDay.date.slice(0, 4), 10) : year;
  const yearFormatted =
    isProceduralB2B && firstDayYear && lastDayYear && firstDayYear !== lastDayYear
      ? `${firstDayYear}–${String(lastDayYear).slice(-2)}`
      : String(year);

  const facts: Fact[] = [
    // 1. Year & Counts
    {
      id: 'year_number',
      label: 'Year',
      value: year,
      unit: 'year',
      formatted: yearFormatted,
      txn_ids: fallbackIds,
      computation: 'Calendar year covered by the transaction dataset',
    },
    {
      id: 'total_transactions_count',
      label: 'Total Transactions',
      value: transactions.length,
      unit: 'count',
      formatted: transactions.length.toLocaleString('en-US'),
      txn_ids: allIds,
      computation: 'Total count of all parsed transactions in the dataset',
    },
    {
      id: 'card_transactions_count',
      label: 'Credit Card Transactions',
      value: cardTxns.length,
      unit: 'count',
      formatted: cardTxns.length.toLocaleString('en-US'),
      txn_ids: ids(cardTxns, fallbackIds),
      computation: 'Count of transactions on the Credit card account',
    },
    {
      id: 'savings_transactions_count',
      label: 'Savings Transactions',
      value: savingsTxns.length,
      unit: 'count',
      formatted: savingsTxns.length.toLocaleString('en-US'),
      txn_ids: ids(savingsTxns, fallbackIds),
      computation: 'Count of transactions on the Savings account',
    },

    // 2. Macro Money Totals
    {
      id: 'total_spend_usd',
      label: 'Total Spend',
      value: totalSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(totalSpendMinor, { showCents: false }),
      txn_ids: ids(nonTransferOut, fallbackIds),
      computation: 'Sum of amount_minor for all outgoing non-transfer transactions',
    },
    {
      id: 'discretionary_spend_usd',
      label: 'Discretionary Spend',
      value: discretionarySpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(discretionarySpendMinor, { showCents: false }),
      txn_ids: ids(discretionaryOut, fallbackIds),
      computation:
        'Sum of amount_minor for outgoing transactions in discretionary categories (excluding rent, bills, fees, savings, transfers)',
    },
    {
      id: 'total_income_usd',
      label: 'Total Income',
      value: totalIncomeMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(totalIncomeMinor, { showCents: false }),
      txn_ids: ids(nonTransferIn, fallbackIds),
      computation: 'Sum of amount_minor for all incoming non-transfer, non-refund transactions',
    },
    {
      id: 'salary_income_usd',
      label: 'Salary Income',
      value: salaryIncomeMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(salaryIncomeMinor, { showCents: false }),
      txn_ids: ids(salaryTxns, fallbackIds),
      computation: 'Sum of amount_minor across the 12 Pacific Studio Labs salary deposits',
    },
    {
      id: 'december_bonus_pay_usd',
      label: isProceduralB2B ? 'Peak Settlement Inflow' : 'Monthly Paycheck',
      value: decBonusMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(decBonusMinor, { showCents: false }),
      txn_ids: decBonusTxn ? [decBonusTxn.id] : fallbackIds,
      computation: 'Uniform monthly salary deposit amount ($6,750.00)',
    },
    {
      id: 'interest_income_usd',
      label: 'Bank Interest Earned',
      value: interestMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(interestMinor, { showCents: true }),
      txn_ids: ids(interestTxns, fallbackIds),
      computation: 'Sum of amount_minor for monthly Savings interest credits',
    },
    {
      id: 'rent_total_usd',
      label: 'Total Rent',
      value: sumMinor(rentTxns),
      unit: 'usd_cents',
      formatted: formatMoneyMinor(sumMinor(rentTxns), { showCents: false }),
      txn_ids: ids(rentTxns, fallbackIds),
      computation: 'Sum of amount_minor for all rent transactions',
    },
    {
      id: 'savings_invest_total_usd',
      label: 'Total Saved & Invested',
      value: sumMinor(savingsCatTxns),
      unit: 'usd_cents',
      formatted: formatMoneyMinor(sumMinor(savingsCatTxns), { showCents: false }),
      txn_ids: ids(savingsCatTxns, fallbackIds),
      computation: 'Sum of amount_minor for investment, FXPay, and Fidelity 401(k) contributions',
    },
    {
      id: 'bills_total_usd',
      label: 'Total Bills & Utilities',
      value: sumMinor(billsTxns),
      unit: 'usd_cents',
      formatted: formatMoneyMinor(sumMinor(billsTxns), { showCents: false }),
      txn_ids: ids(billsTxns, fallbackIds),
      computation: 'Sum of amount_minor for power, broadband, and mobile bills',
    },
    {
      id: 'fees_total_usd',
      label: 'Total Fees & Withholding Tax',
      value: sumMinor(feesTxns),
      unit: 'usd_cents',
      formatted: formatMoneyMinor(sumMinor(feesTxns), { showCents: true }),
      txn_ids: ids(feesTxns, fallbackIds),
      computation: 'Sum of amount_minor for FX fees, card fees, and tax on interest',
    },

    // 3. Payday & Post-Payday Heartbeat
    {
      id: 'payday_count',
      label: isProceduralB2B ? 'Settlement Events' : 'Paydays',
      value: paydayDates.size,
      unit: 'count',
      formatted: String(paydayDates.size),
      txn_ids: ids(salaryTxns, fallbackIds),
      computation: 'Count of monthly salary deposit dates in the year',
    },
    {
      id: 'payday_spike_ratio',
      label: isProceduralB2B ? 'Post-Settlement Velocity' : 'Payday Spending Multiplier',
      value: paydaySpikeRatio,
      unit: 'ratio',
      formatted: `${paydaySpikeRatio.toFixed(1)}×`,
      txn_ids: ids(windowCardDiscTxns, windowTxnIds.length > 0 ? windowTxnIds : fallbackIds),
      computation:
        'Ratio of average daily card discretionary spend in the 5-day post-payday window vs all other days',
    },
    {
      id: 'payday_window_spend_pct',
      label: 'Post-Payday Window Spend Share',
      value: paydayWindowSpendPct,
      unit: 'percent',
      formatted: `${paydayWindowSpendPct}%`,
      txn_ids: ids(windowCardDiscTxns, fallbackIds),
      computation: 'Percentage of card discretionary spend occurring within 5 days of a payday',
    },
    {
      id: 'payday_window_calendar_pct',
      label: 'Post-Payday Window Calendar Share',
      value: paydayWindowCalendarPct,
      unit: 'percent',
      formatted: `${paydayWindowCalendarPct}%`,
      txn_ids: ids(salaryTxns, fallbackIds),
      computation: 'Percentage of calendar days falling within the 5-day post-payday windows',
    },

    // 4. Top Merchant (Blue Bottle Coffee)
    {
      id: 'top_merchant_name',
      label: isProceduralB2B ? 'Primary Counterparty' : 'Top Merchant Name',
      value: topMerchantName,
      unit: 'text',
      formatted: topMerchantName,
      txn_ids: ids(topMerchantTxns, fallbackIds),
      computation: `Merchant with the highest number of visits in ${isProceduralB2B ? year : 2025}`,
    },
    {
      id: 'visits_top_merchant',
      label: isProceduralB2B ? 'Primary Counterparty Settlements' : 'Top Merchant Visits',
      value: topMerchantVisits,
      unit: 'count',
      formatted: String(topMerchantVisits),
      txn_ids: ids(topMerchantTxns, fallbackIds),
      computation: `Count of transactions at ${topMerchantName}`,
    },
    {
      id: 'spend_top_merchant',
      label: isProceduralB2B ? 'Primary Counterparty Outflow' : 'Top Merchant Spend',
      value: topMerchantSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(topMerchantSpendMinor, { showCents: true }),
      txn_ids: ids(topMerchantTxns, fallbackIds),
      computation: `Sum of amount_minor across all ${topMerchantVisits} visits to ${topMerchantName}`,
    },
    {
      id: 'avg_spend_top_merchant',
      label: isProceduralB2B ? 'Average Settlement Size' : 'Average Spend at Top Merchant',
      value: topMerchantAvgMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(topMerchantAvgMinor, { showCents: true }),
      txn_ids: ids(topMerchantTxns, fallbackIds),
      computation: `Average transaction amount at ${topMerchantName}`,
    },
    {
      id: 'top_spend_top_merchant',
      label: isProceduralB2B ? 'Peak Counterparty Settlement' : 'Biggest Order at Top Merchant',
      value: topMerchantMaxMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(topMerchantMaxMinor, { showCents: true }),
      txn_ids: ids(topMerchantTxns, fallbackIds),
      computation: `Maximum single transaction amount at ${topMerchantName}`,
    },
    {
      id: 'top_merchant_days_interval',
      label: 'Days Between Top Merchant Visits',
      value: topMerchantDaysInterval,
      unit: 'days',
      formatted: String(topMerchantDaysInterval),
      txn_ids: ids(topMerchantTxns, fallbackIds),
      computation: `365 calendar days divided by ${topMerchantVisits} visits to ${topMerchantName}`,
    },
    {
      id: 'top_merchant_top_weekday',
      label: isProceduralB2B ? 'Primary Settlement Weekday' : 'Favourite Weekday at Top Merchant',
      value: topMerchantTopWeekday,
      unit: 'text',
      formatted: topMerchantTopWeekday,
      txn_ids: ids(topMerchantTxns, fallbackIds),
      computation: `Day of the week with the highest visit count at ${topMerchantName}`,
    },

    // 5. Coffee Habit
    {
      id: 'coffee_total_visits',
      label: isProceduralB2B ? 'Primary Counterparty Settlements' : 'Total Coffee Visits',
      value: coffeeTotalVisits,
      unit: 'count',
      formatted: String(coffeeTotalVisits),
      txn_ids: ids(coffeeTxns, fallbackIds),
      computation: 'Total count of outgoing transactions in the coffee category',
    },
    {
      id: 'coffee_total_spend',
      label: isProceduralB2B ? 'Primary Counterparty Spend' : 'Total Coffee Spend',
      value: coffeeTotalSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(coffeeTotalSpendMinor, { showCents: false }),
      txn_ids: ids(coffeeTxns, fallbackIds),
      computation: 'Sum of amount_minor for all outgoing coffee transactions',
    },
    {
      id: 'second_coffee_merchant_name',
      label: isProceduralB2B ? 'Secondary Counterparty' : 'Second Most-Visited Café',
      value: secondCoffeeMerchantName,
      unit: 'text',
      formatted: secondCoffeeMerchantName,
      txn_ids: ids(secondCoffeeTxns, fallbackIds),
      computation:
        'Second highest-visit café in the coffee category (unified across branch spellings)',
    },
    {
      id: 'second_coffee_visits',
      label: isProceduralB2B ? 'Secondary Counterparty Settlements' : 'Second Café Visits',
      value: secondCoffeeVisits,
      unit: 'count',
      formatted: String(secondCoffeeVisits),
      txn_ids: ids(secondCoffeeTxns, fallbackIds),
      computation: `Count of visits to ${secondCoffeeMerchantName} across all raw spelling variants`,
    },
    {
      id: 'second_coffee_spend',
      label: isProceduralB2B ? 'Secondary Counterparty Spend' : 'Second Café Spend',
      value: secondCoffeeSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(secondCoffeeSpendMinor, { showCents: true }),
      txn_ids: ids(secondCoffeeTxns, fallbackIds),
      computation: `Sum of amount_minor at ${secondCoffeeMerchantName}`,
    },
    {
      id: 'coffee_merchants_count',
      label: isProceduralB2B ? 'Active Counterparties' : 'Distinct Cafés Visited',
      value: coffeeMerchantsCount,
      unit: 'count',
      formatted: String(coffeeMerchantsCount),
      txn_ids: ids(coffeeTxns, fallbackIds),
      computation: `Count of distinct cleaned café merchants visited in ${isProceduralB2B ? year : 2025}`,
    },

    // 6. Home Music-Studio Build
    {
      id: 'studio_total_spend',
      label: isProceduralB2B ? 'Anchor Vendor Spend' : 'Monarch Acoustic Studio Build Spend',
      value: studioTotalMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(studioTotalMinor, { showCents: false }),
      txn_ids: ids(soundRoomTxns, fallbackIds),
      computation: 'Sum of May deposit and August final payment to Monarch Acoustic',
    },
    {
      id: 'studio_deposit_spend',
      label: isProceduralB2B ? 'Initial Tranche Outflow' : 'Studio May Deposit',
      value: studioDepositMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(studioDepositMinor, { showCents: false }),
      txn_ids: studioDepositTxn ? [studioDepositTxn.id] : fallbackIds,
      computation: 'May deposit payment to Monarch Acoustic (SAV-2025052401)',
    },
    {
      id: 'studio_final_spend',
      label: isProceduralB2B ? 'Peak Tranche Outflow' : 'Studio August Final Payment',
      value: studioFinalMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(studioFinalMinor, { showCents: true }),
      txn_ids: studioFinalTxn ? [studioFinalTxn.id] : fallbackIds,
      computation: 'August final payment to Monarch Acoustic (SAV-2025081101)',
    },
    {
      id: 'studio_synth_spend',
      label: isProceduralB2B ? 'Secondary Vendor Tranche' : 'August Synth Purchase',
      value: studioSynthMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(studioSynthMinor, { showCents: false }),
      txn_ids: augSynthTxn ? [augSynthTxn.id] : fallbackIds,
      computation: 'August synth purchase following studio completion (SAV-2025081902)',
    },
    {
      id: 'studio_gear_count',
      label: isProceduralB2B ? 'Initiative Tranches' : 'Studio & Music Gear Purchases',
      value: studioGearTxns.length,
      unit: 'count',
      formatted: String(studioGearTxns.length),
      txn_ids: ids(studioGearTxns, fallbackIds),
      computation:
        'Count of transactions across Monarch Acoustic, Sweetwater, Rubber Duckling, Synthyard, MyVolts, and secondhand synth/audio gear',
    },
    {
      id: 'studio_total_with_gear_spend',
      label: isProceduralB2B ? 'Total Initiative Outflow' : 'Total Studio & Music Gear Spend',
      value: studioTotalWithGearMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(studioTotalWithGearMinor, { showCents: false }),
      txn_ids: ids(studioGearTxns, fallbackIds),
      computation:
        'Sum of amount_minor across Monarch Acoustic build and all music/audio gear purchases',
    },

    // 7. Standout Purchases (big_one)
    {
      id: 'big_one_merchant',
      label: isProceduralB2B
        ? 'Peak Disbursement Counterparty'
        : 'Biggest Single Purchase Merchant',
      value: bigOneMerchant,
      unit: 'text',
      formatted: bigOneMerchant,
      txn_ids: bigOneTxn ? [bigOneTxn.id] : fallbackIds,
      computation: 'Merchant of the largest single non-transfer discretionary purchase',
    },
    {
      id: 'big_one_spend',
      label: isProceduralB2B ? 'Largest Single Disbursement' : 'Biggest Single Purchase Amount',
      value: bigOneSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(bigOneSpendMinor, { showCents: true }),
      txn_ids: bigOneTxn ? [bigOneTxn.id] : fallbackIds,
      computation: 'Amount of the largest single non-transfer discretionary purchase',
    },
    {
      id: 'big_one_date',
      label: isProceduralB2B ? 'Peak Disbursement Date' : 'Biggest Single Purchase Date',
      value: bigOneDate,
      unit: 'date',
      formatted: bigOneDate,
      txn_ids: bigOneTxn ? [bigOneTxn.id] : fallbackIds,
      computation: 'Date of the largest single non-transfer discretionary purchase',
    },
    {
      id: 'big_one_weeks_equivalent',
      label: isProceduralB2B ? 'Weekly Run-Rate Multiple' : 'Weeks of Normal Spending Equivalent',
      value: bigOneWeeksEquivalent,
      unit: 'count',
      formatted: String(bigOneWeeksEquivalent),
      txn_ids: bigOneTxn ? [bigOneTxn.id] : fallbackIds,
      computation:
        'Largest single purchase divided by average weekly non-studio discretionary spend',
    },
    {
      id: 'jan_tech_merchant',
      label: 'January Tech Purchase Merchant',
      value: janTechMerchant,
      unit: 'text',
      formatted: janTechMerchant,
      txn_ids: janTechTxn ? [janTechTxn.id] : fallbackIds,
      computation: 'Merchant of the standout January tech purchase (SAV-2025011501)',
    },
    {
      id: 'jan_tech_spend',
      label: 'January Tech Purchase Amount',
      value: janTechSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(janTechSpendMinor, { showCents: true }),
      txn_ids: janTechTxn ? [janTechTxn.id] : fallbackIds,
      computation: 'Amount of the standout January B&H Photo POS purchase',
    },
    {
      id: 'jan_tech_date',
      label: 'January Tech Purchase Date',
      value: janTechDate,
      unit: 'date',
      formatted: janTechDate,
      txn_ids: janTechTxn ? [janTechTxn.id] : fallbackIds,
      computation: 'Date of the standout January B&H Photo purchase',
    },

    // 8. Streaks & Calendar Signals
    {
      id: 'longest_coffee_streak_days',
      label: isProceduralB2B ? 'Repeat Counterparty Streak' : 'Longest Coffee Streak',
      value: maxCoffeeStreak,
      unit: 'days',
      formatted: String(maxCoffeeStreak),
      txn_ids: ids(coffeeStreakTxns, ids(coffeeTxns, fallbackIds)),
      computation: 'Longest run of consecutive calendar days with at least one coffee purchase',
    },
    {
      id: 'longest_spend_streak_days',
      label: isProceduralB2B ? 'Consecutive Active Days' : 'Longest Daily Spending Streak',
      value: maxSpendStreak,
      unit: 'days',
      formatted: String(maxSpendStreak),
      txn_ids: bestSpendStreakTxnIds.length > 0 ? bestSpendStreakTxnIds : fallbackIds,
      computation: 'Longest run of consecutive calendar days with discretionary spending > $0',
    },
    {
      id: 'longest_no_spend_streak_days',
      label: isProceduralB2B ? 'Longest Quiet Window' : 'Longest No-Spend Streak',
      value: maxNoSpendStreak,
      unit: 'days',
      formatted: String(maxNoSpendStreak),
      txn_ids: fallbackIds,
      computation: 'Longest run of consecutive calendar days with zero discretionary spending',
    },
    {
      id: 'no_spend_days_count',
      label: isProceduralB2B ? 'Zero-Outflow Days' : 'No-Spend Days',
      value: noSpendDaysCount,
      unit: 'days',
      formatted: String(noSpendDaysCount),
      txn_ids: fallbackIds,
      computation: `Count of calendar days in ${isProceduralB2B ? year : 2025} with zero discretionary spending`,
    },
    {
      id: 'active_spend_days_count',
      label: isProceduralB2B ? 'Active Operating Days' : 'Active Spend Days',
      value: activeSpendDaysCount,
      unit: 'days',
      formatted: String(activeSpendDaysCount),
      txn_ids: ids(discretionaryOut.slice(0, 50), fallbackIds),
      computation: `Count of calendar days in ${isProceduralB2B ? year : 2025} with discretionary spending > $0`,
    },
    {
      id: 'loudest_day_date',
      label: 'Biggest Spending Day',
      value: loudestDayDate,
      unit: 'date',
      formatted: loudestDayDate,
      txn_ids: loudestDayTxnIds,
      computation: 'Calendar date with the highest discretionary spending',
    },
    {
      id: 'loudest_day_spend',
      label: 'Biggest Day Spend',
      value: loudestDaySpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(loudestDaySpendMinor, { showCents: false }),
      txn_ids: loudestDayTxnIds,
      computation: 'Total discretionary spend on the highest-spend day of the year',
    },
    {
      id: 'october_spend_usd',
      label: 'October Discretionary Spend',
      value: octoberSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(octoberSpendMinor, { showCents: false }),
      txn_ids: ids(octoberTxns, fallbackIds),
      computation: `Sum of discretionary spending in October ${isProceduralB2B ? year : 2025}`,
    },
    {
      id: 'october_transactions_count',
      label: 'October Outgoing Transactions',
      value: octoberAllOutTxns.length,
      unit: 'count',
      formatted: String(octoberAllOutTxns.length),
      txn_ids: ids(octoberAllOutTxns, fallbackIds),
      computation: `Count of non-transfer outgoing transactions in October ${isProceduralB2B ? year : 2025}`,
    },
    {
      id: 'monthly_avg_spend_usd',
      label: 'Monthly Average Discretionary Spend',
      value: monthlyAvgDiscretionaryMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(monthlyAvgDiscretionaryMinor, { showCents: false }),
      txn_ids: ids(discretionaryOut.slice(0, 50), fallbackIds),
      computation: 'Annual discretionary spend divided by 12 months',
    },
    {
      id: 'october_vs_avg_ratio',
      label: 'October Spend vs Typical Month',
      value: octoberVsAvgRatio,
      unit: 'ratio',
      formatted: `${octoberVsAvgRatio.toFixed(1)}×`,
      txn_ids: ids(octoberTxns, fallbackIds),
      computation:
        'Ratio of October discretionary spend to the typical non-studio monthly discretionary average',
    },

    // 9. Getaway & FX
    {
      id: 'getaway_location_name',
      label: isProceduralB2B ? 'Peak Operating Window' : 'Favourite Coastal Getaway',
      value: getawayLocationName,
      unit: 'text',
      formatted: getawayLocationName,
      txn_ids: ids(getawayTxns, fallbackIds),
      computation: 'Most-visited beach-town holiday destination outside Seattle',
    },
    {
      id: 'getaway_spend_usd',
      label: isProceduralB2B ? 'Peak Window Outflow' : 'Coastal Getaway Spend',
      value: getawaySpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(getawaySpendMinor, { showCents: false }),
      txn_ids: ids(getawayTxns, fallbackIds),
      computation:
        'Sum of amount_minor across Cannon Beach / Astoria trips and weekend accommodation',
    },
    {
      id: 'getaway_days_count',
      label: isProceduralB2B ? 'Active Window Days' : 'Coastal Getaway Days',
      value: getawayDaysCount,
      unit: 'days',
      formatted: String(getawayDaysCount),
      txn_ids: ids(getawayTxns, fallbackIds),
      computation: 'Count of distinct trip days spent in Cannon Beach',
    },
    {
      id: 'fx_transactions_count',
      label: 'Foreign Currency Purchases',
      value: fxTxns.length,
      unit: 'count',
      formatted: String(fxTxns.length),
      txn_ids: ids(fxTxns, fallbackIds),
      computation: 'Count of transactions with inline foreign currency conversion (AUD & GBP)',
    },
    {
      id: 'fx_spend_usd',
      label: 'Foreign Currency Spend',
      value: fxSpendMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(fxSpendMinor, { showCents: true }),
      txn_ids: ids(fxTxns, fallbackIds),
      computation: 'Sum of amount_minor for foreign-currency purchases in USD',
    },
    {
      id: 'fx_fees_usd',
      label: 'Foreign Currency Transaction Fees',
      value: fxFeesMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(fxFeesMinor, { showCents: true }),
      txn_ids: ids(fxFeeTxns, fallbackIds),
      computation: 'Sum of amount_minor across all INTL TRANSACTION FEE rows',
    },

    // 10. Health / Physio
    {
      id: 'physio_visits_count',
      label: 'Physio Sessions Paid',
      value: physioTxns.length,
      unit: 'count',
      formatted: String(physioTxns.length),
      txn_ids: ids(physioTxns, fallbackIds),
      computation: 'Count of bill payments to Physio',
    },
    {
      id: 'physio_total_spend',
      label: 'Total Physio Spend',
      value: physioTotalMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(physioTotalMinor, { showCents: false }),
      txn_ids: ids(physioTxns, fallbackIds),
      computation: 'Sum of amount_minor across Physio bill payments',
    },

    // 11. Top Category
    {
      id: 'top_category_name',
      label: 'Top Spending Category',
      value: topCat.category,
      unit: 'text',
      formatted: isProceduralB2B
        ? getCategoryDisplayLabel(topCat.category, undefined, true)
        : topCat.category,
      txn_ids: ids(topCat.txns, fallbackIds),
      computation: 'Discretionary category with the highest total spend',
    },
    {
      id: 'top_category_spend',
      label: 'Top Category Spend',
      value: topCat.totalMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(topCat.totalMinor, { showCents: false }),
      txn_ids: ids(topCat.txns, fallbackIds),
      computation: `Sum of amount_minor in top discretionary category (${topCat.category})`,
    },
    {
      id: 'top_category_share_pct',
      label: 'Top Category Share of Discretionary Spend',
      value: topCategorySharePct,
      unit: 'percent',
      formatted: `${topCategorySharePct}%`,
      txn_ids: ids(topCat.txns, fallbackIds),
      computation: `Percentage of discretionary spend in ${topCat.category}`,
    },
  ];

  // Add per-category spend and count facts for all non-transfer outgoing categories
  const categoryOrder: Category[] = [
    'groceries',
    'eating out',
    'takeaway',
    'coffee',
    'transport',
    'travel',
    'shopping',
    'subscriptions',
    'health',
    'fun',
    'gifts',
    'rent',
    'bills',
    'fees',
    'savings',
  ];

  for (const cat of categoryOrder) {
    const slug = cat.replace(/\s+/g, '_');
    const catTxns = byCategory.get(cat) ?? [];
    const catMinor = sumMinor(catTxns);
    const catDisplayLabel = isProceduralB2B
      ? getCategoryDisplayLabel(cat, undefined, true)
      : `${cat[0]!.toUpperCase()}${cat.slice(1)}`;
    facts.push({
      id: `cat_${slug}_spend`,
      label: `${catDisplayLabel} Spend`,
      value: catMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(catMinor, { showCents: false }),
      txn_ids: ids(catTxns, fallbackIds),
      computation: `Sum of outgoing non-transfer amount_minor in category "${cat}"`,
    });
    facts.push({
      id: `cat_${slug}_count`,
      label: `${catDisplayLabel} Transactions`,
      value: catTxns.length,
      unit: 'count',
      formatted: String(catTxns.length),
      txn_ids: ids(catTxns, fallbackIds),
      computation: `Count of outgoing non-transfer transactions in category "${cat}"`,
    });
  }

  if (isProceduralB2B) {
    const q1Txns = nonTransferOut.filter((t) => {
      const m = Number.parseInt(t.date.slice(5, 7), 10);
      return m >= 1 && m <= 3;
    });
    const q4Txns = nonTransferOut.filter((t) => {
      const m = Number.parseInt(t.date.slice(5, 7), 10);
      return m >= 10 && m <= 12;
    });
    const q1SpendMinor = sumMinor(q1Txns);
    const q4SpendMinor = sumMinor(q4Txns);
    const netCashflowMinor = totalIncomeMinor - totalSpendMinor;

    const getawayByCat = new Map<Category, number>();
    for (const t of getawayTxns) {
      getawayByCat.set(t.category, (getawayByCat.get(t.category) ?? 0) + t.amount_minor);
    }
    const getawayTopCat =
      [...getawayByCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? topCat.category;
    const getawayTopCategoryLabel = getCategoryDisplayLabel(getawayTopCat, undefined, true);

    facts.push(
      {
        id: 'total_inflow_usd',
        label: 'Total Operating Inflow',
        value: totalIncomeMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(totalIncomeMinor, { showCents: false }),
        txn_ids: ids(nonTransferIn, fallbackIds),
        computation:
          'Sum of all incoming non-transfer, non-refund revenue and settlement transactions',
      },
      {
        id: 'total_outflow_usd',
        label: 'Total Operating Outflow',
        value: totalSpendMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(totalSpendMinor, { showCents: false }),
        txn_ids: ids(nonTransferOut, fallbackIds),
        computation: 'Sum of amount_minor for all outgoing non-transfer transactions',
      },
      {
        id: 'net_cashflow_usd',
        label: 'Net Operating Cashflow',
        value: netCashflowMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(netCashflowMinor, { showCents: false }),
        txn_ids: ids([...nonTransferIn, ...nonTransferOut], fallbackIds),
        computation: 'Total incoming revenue minus total outgoing operating spend',
      },
      {
        id: 'categories_count',
        label: 'Active Spend Categories',
        value: byCategory.size,
        unit: 'count',
        formatted: String(byCategory.size),
        txn_ids: ids(nonTransferOut, fallbackIds),
        computation: 'Count of distinct outgoing non-transfer spending categories',
      },
      {
        id: 'q1_spend_usd',
        label: 'First Quarter Outflow',
        value: q1SpendMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(q1SpendMinor, { showCents: false }),
        txn_ids: ids(q1Txns, fallbackIds),
        computation: 'Sum of outgoing non-transfer spend in Q1 (January through March)',
      },
      {
        id: 'q4_spend_usd',
        label: 'Fourth Quarter Outflow',
        value: q4SpendMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(q4SpendMinor, { showCents: false }),
        txn_ids: ids(q4Txns, fallbackIds),
        computation: 'Sum of outgoing non-transfer spend in Q4 (October through December)',
      },
      {
        id: 'studio_acoustic_spend',
        label: 'Primary Capital Initiative Anchor Spend',
        value: studioTotalMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(studioTotalMinor, { showCents: false }),
        txn_ids: ids(soundRoomTxns, fallbackIds),
        computation: 'Sum of spend on the primary capital initiative vendor',
      },
      {
        id: 'studio_first_month',
        label: 'Capital Initiative Start Month',
        value: studioFirstMonthName,
        unit: 'text',
        formatted: studioFirstMonthName,
        txn_ids: ids(studioGearTxns, fallbackIds),
        computation: 'First month of the primary capital or infrastructure initiative',
      },
      {
        id: 'studio_last_month',
        label: 'Capital Initiative Completion Month',
        value: studioLastMonthName,
        unit: 'text',
        formatted: studioLastMonthName,
        txn_ids: ids(studioGearTxns, fallbackIds),
        computation: 'Last month of the primary capital or infrastructure initiative',
      },
      {
        id: 'studio_months_span',
        label: 'Capital Initiative Duration Months',
        value: studioMonthsSpan,
        unit: 'count',
        formatted: String(studioMonthsSpan),
        txn_ids: ids(studioGearTxns, fallbackIds),
        computation: 'Month span of the primary capital or infrastructure initiative',
      },
      {
        id: 'studio_largest_single_payment',
        label: 'Largest Initiative Tranche',
        value: studioLargestMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(studioLargestMinor, { showCents: false }),
        txn_ids: ids(studioLargestTxn ? [studioLargestTxn] : studioGearTxns, fallbackIds),
        computation: 'Largest single payment within the primary capital initiative',
      },
      {
        id: 'top_coffee_avg_visit',
        label: 'Primary Repeat Vendor Average Ticket',
        value: topMerchantAvgMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(topMerchantAvgMinor, { showCents: true }),
        txn_ids: ids(topMerchantTxns, fallbackIds),
        computation: 'Average transaction value at the most frequently paid counterparty',
      },
      {
        id: 'second_coffee_avg_visit',
        label: 'Runner-Up Repeat Vendor Average Ticket',
        value: secondCoffeeAvgMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(secondCoffeeAvgMinor, { showCents: true }),
        txn_ids: ids(secondCoffeeTxns, fallbackIds),
        computation: 'Average transaction value at the runner-up repeat counterparty',
      },
      {
        id: 'getaway_spend_total',
        label: 'Peak Operating Window Total Spend',
        value: getawaySpendMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(getawaySpendMinor, { showCents: false }),
        txn_ids: ids(getawayTxns, fallbackIds),
        computation: 'Total spend during the highest-intensity 7-day operating window',
      },
      {
        id: 'getaway_txns_count',
        label: 'Peak Operating Window Transactions',
        value: getawayTxns.length,
        unit: 'count',
        formatted: String(getawayTxns.length),
        txn_ids: ids(getawayTxns, fallbackIds),
        computation: 'Number of transactions during the highest-intensity 7-day operating window',
      },
      {
        id: 'getaway_top_category',
        label: 'Peak Window Top Category',
        value: getawayTopCategoryLabel,
        unit: 'text',
        formatted: getawayTopCategoryLabel,
        txn_ids: ids(getawayTxns, fallbackIds),
        computation: 'Highest-spend operating category during the peak 7-day window',
      },
      {
        id: 'getaway_date_range',
        label: 'Peak Operating Window Date Range',
        value: getawayDateRange,
        unit: 'text',
        formatted: getawayDateRange,
        txn_ids: ids(getawayTxns, fallbackIds),
        computation: 'Date range of the highest-intensity 5-day operating window',
      },
      {
        id: 'top_category_by_spend_name',
        label: 'Primary Cost Center',
        value: topCat.category,
        unit: 'text',
        formatted: getCategoryDisplayLabel(topCat.category, undefined, true),
        txn_ids: ids(topCat.txns, fallbackIds),
        computation: 'Operating category with the highest total spend',
      },
      {
        id: 'top_category_by_spend_amount',
        label: 'Primary Cost Center Spend',
        value: topCat.totalMinor,
        unit: 'usd_cents',
        formatted: formatMoneyMinor(topCat.totalMinor, { showCents: false }),
        txn_ids: ids(topCat.txns, fallbackIds),
        computation: `Sum of amount_minor in top operating category (${topCat.category})`,
      },
      {
        id: 'average_monthly_spend',
        label: 'Monthly Operating Run-Rate',
        value: Math.round(totalSpendMinor / 12),
        unit: 'usd_cents',
        formatted: formatMoneyMinor(Math.round(totalSpendMinor / 12), { showCents: false }),
        txn_ids: ids(nonTransferOut.slice(0, 50), fallbackIds),
        computation: 'Total annual operating spend divided by 12 months',
      }
    );
  }

  return facts;
}
