import type { Day, Fact, StoryPlan, Transaction } from '../../contracts/index.js';
import { formatMoneyMinor, isDiscretionaryCategory } from '../../contracts/index.js';

/**
 * Deterministic seeded PRNG for mock dataset generation (seed = 20250101).
 */
function createSeededRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMockDataset(): {
  transactions: Transaction[];
  days: Day[];
  facts: Fact[];
  plan: StoryPlan;
} {
  const rand = createSeededRng(20250101);
  const transactions: Transaction[] = [];
  const days: Day[] = [];

  const sampleMerchants = [
    {
      raw: 'SQ *BLUE BOTTLE COFFEE SEATTLE WA',
      clean: 'Blue Bottle Coffee',
      cat: 'coffee' as const,
      min: 480,
      max: 1450,
    },
    {
      raw: "TRADER JOE'S SEATTLE WA",
      clean: "Trader Joe's",
      cat: 'groceries' as const,
      min: 1800,
      max: 11200,
    },
    {
      raw: 'NORTHGATE BREWING CO SEATTLE WA',
      clean: 'Northgate Brewing',
      cat: 'eating out' as const,
      min: 2400,
      max: 7800,
    },
    {
      raw: 'UBER EATS SAN FRANCISCO CA',
      clean: 'Uber Eats',
      cat: 'takeaway' as const,
      min: 1900,
      max: 5400,
    },
    {
      raw: 'CHEVRON BALLARD SEATTLE WA',
      clean: 'Chevron',
      cat: 'transport' as const,
      min: 4500,
      max: 9200,
    },
    {
      raw: 'B&H PHOTO NEW YORK NY',
      clean: 'B&H Photo',
      cat: 'shopping' as const,
      min: 3500,
      max: 45000,
    },
    {
      raw: 'SEATTLE CITY LIGHT SEATTLE WA',
      clean: 'Seattle City Light',
      cat: 'bills' as const,
      min: 9500,
      max: 14500,
    },
    {
      raw: 'ADOBE SYSTEMS SAN JOSE CA',
      clean: 'Adobe',
      cat: 'subscriptions' as const,
      min: 4275,
      max: 4275,
    },
    {
      raw: 'BRIGHTPATH PHYSIO SEATTLE WA',
      clean: 'Brightpath Physio',
      cat: 'health' as const,
      min: 5478,
      max: 5478,
    },
    {
      raw: 'SWEETWATER SOUND FORT WAYNE IN',
      clean: 'Sweetwater',
      cat: 'fun' as const,
      min: 4500,
      max: 28000,
    },
  ];

  const startDate = new Date('2025-01-01T00:00:00Z');
  let txnCounter = 1;

  for (let d = 0; d < 365; d++) {
    const cur = new Date(startDate.getTime() + d * 86400000);
    const isoDate = cur.toISOString().slice(0, 10);
    const jsDay = cur.getUTCDay(); // 0=Sun..6=Sat
    const weekday = (jsDay + 6) % 7; // 0=Mon..6=Sun
    // Jan 1 2025 is Wednesday (weekday = 2)
    const weekIndex = Math.floor((d + 2) / 7);

    const nextDay = new Date(cur.getTime() + 86400000);
    const isLastDayOfMonth = nextDay.getUTCMonth() !== cur.getUTCMonth();
    const isPayday = isLastDayOfMonth && weekday < 5;

    const dayTxnIds: string[] = [];
    let discretionaryOutMinor = 0;
    let allOutMinor = 0;
    let inMinor = 0;

    if (isPayday) {
      const id = `MOCK-SAV-${String(txnCounter++).padStart(4, '0')}`;
      const payMinor = 675000;
      transactions.push({
        id,
        date: isoDate,
        posted_date: isoDate,
        account: 'Savings',
        tran_type: 'D/C',
        amount_minor: payMinor,
        currency: 'USD',
        direction: 'in',
        raw_description: 'D/C FROM PACIFIC STUDIO LABS INC SALARY/WAGES',
        merchant: 'Pacific Studio Labs',
        merchant_confidence: 0.99,
        category: 'income',
        category_confidence: 0.99,
        is_recurring: true,
        is_transfer: false,
        is_refund: false,
        source_row: {
          id,
          date: isoDate,
          posted_date: isoDate,
          account: 'Savings',
          tran_type: 'D/C',
          description: 'D/C FROM PACIFIC STUDIO LABS INC SALARY/WAGES',
          amount: '6750.00',
          currency: 'USD',
        },
      });
      inMinor += payMinor;
      dayTxnIds.push(id);
    }

    const countToday = rand() < 0.2 ? 0 : 1 + Math.floor(rand() * 3);
    for (let k = 0; k < countToday; k++) {
      const pick = sampleMerchants[Math.floor(rand() * sampleMerchants.length)]!;
      const amountMinor = Math.round(pick.min + rand() * (pick.max - pick.min));
      const id = `MOCK-CARD-${String(txnCounter++).padStart(4, '0')}`;
      transactions.push({
        id,
        date: isoDate,
        posted_date: isoDate,
        account: 'Credit card',
        tran_type: 'DEBIT',
        amount_minor: amountMinor,
        currency: 'USD',
        direction: 'out',
        raw_description: pick.raw,
        merchant: pick.clean,
        merchant_confidence: 0.95,
        category: pick.cat,
        category_confidence: 0.95,
        is_recurring: pick.cat === 'subscriptions' || pick.cat === 'bills',
        is_transfer: false,
        is_refund: false,
        source_row: {
          id,
          date: isoDate,
          posted_date: isoDate,
          account: 'Credit card',
          tran_type: 'DEBIT',
          description: pick.raw,
          amount: (-amountMinor / 100).toFixed(2),
          currency: 'USD',
        },
      });
      allOutMinor += amountMinor;
      if (isDiscretionaryCategory(pick.cat)) {
        discretionaryOutMinor += amountMinor;
      }
      dayTxnIds.push(id);
    }

    days.push({
      date: isoDate,
      weekday,
      week_index: weekIndex,
      discretionary_out_minor: discretionaryOutMinor,
      all_out_minor: allOutMinor,
      in_minor: inMinor,
      txn_ids: dayTxnIds,
      is_payday: isPayday,
    });
  }

  const outTxns = transactions.filter((t) => t.direction === 'out' && !t.is_transfer);
  const totalOutMinor = outTxns.reduce((acc, t) => acc + t.amount_minor, 0);
  const cornerTxns = outTxns.filter((t) => t.merchant === 'Blue Bottle Coffee');
  const cornerTotalMinor = cornerTxns.reduce((acc, t) => acc + t.amount_minor, 0);

  const facts: Fact[] = [
    {
      id: 'year_number',
      label: 'Year',
      value: 2025,
      unit: 'year',
      formatted: '2025',
      txn_ids: transactions.slice(0, 5).map((t) => t.id),
      computation: 'Calendar year covered by the transaction dataset',
    },
    {
      id: 'total_transactions_count',
      label: 'Total Transactions',
      value: transactions.length,
      unit: 'count',
      formatted: transactions.length.toLocaleString('en-US'),
      txn_ids: transactions.map((t) => t.id),
      computation: 'Total count of parsed transactions in the year',
    },
    {
      id: 'total_spend_usd',
      label: 'Total Spend',
      value: totalOutMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(totalOutMinor, { showCents: false }),
      txn_ids: outTxns.map((t) => t.id),
      computation: 'Sum of all non-transfer outgoing transactions',
    },
    {
      id: 'top_merchant_name',
      label: 'Top Merchant Name',
      value: 'Blue Bottle Coffee',
      unit: 'text',
      formatted: 'Blue Bottle Coffee',
      txn_ids: cornerTxns.map((t) => t.id),
      computation: 'Merchant with highest visit count',
    },
    {
      id: 'visits_top_merchant',
      label: 'Top Merchant Visits',
      value: cornerTxns.length,
      unit: 'count',
      formatted: String(cornerTxns.length),
      txn_ids: cornerTxns.map((t) => t.id),
      computation: 'Count of transactions at Blue Bottle Coffee',
    },
    {
      id: 'spend_top_merchant',
      label: 'Top Merchant Total Spend',
      value: cornerTotalMinor,
      unit: 'usd_cents',
      formatted: formatMoneyMinor(cornerTotalMinor, { showCents: true }),
      txn_ids: cornerTxns.map((t) => t.id),
      computation: 'Sum of amount_minor for Blue Bottle Coffee transactions',
    },
    {
      id: 'payday_count',
      label: 'Paydays',
      value: days.filter((d) => d.is_payday).length,
      unit: 'count',
      formatted: String(days.filter((d) => d.is_payday).length),
      txn_ids: transactions.filter((t) => t.category === 'income').map((t) => t.id),
      computation: 'Count of salary deposit days',
    },
    {
      id: 'payday_spike_ratio',
      label: 'Payday vs Normal Day Multiplier',
      value: 2.8,
      unit: 'ratio',
      formatted: '2.8×',
      txn_ids: outTxns.slice(0, 25).map((t) => t.id),
      computation:
        'Ratio of average daily discretionary spend in 5 days post-payday vs rest of year',
    },
  ];

  const plan: StoryPlan = {
    person_name: 'Sam',
    year_fact_id: 'year_number',
    year: 2025,
    palette_ids: ['ink_solar', 'solar_ember', 'ink_rose', 'paper_studio'],
    one_line:
      'In {fact:year_number}, across {fact:total_transactions_count} movements and {fact:total_spend_usd} spent, {fact:top_merchant_name} anchored your mornings {fact:visits_top_merchant} times.',
    personality: {
      title: 'The Studio-Building Sprinter',
      subtitle:
        'You surge {fact:payday_spike_ratio} after each of your {fact:payday_count} paydays, channeling big bursts into music gear and {fact:visits_top_merchant} ritual stops at {fact:top_merchant_name}.',
      dominant_categories: ['shopping', 'groceries', 'eating out', 'coffee', 'fun'],
      payday_spike_ratio_fact_id: 'payday_spike_ratio',
      shape_seed: 2025,
    },
    chapters: [
      {
        id: 'pour',
        type: 'pour',
        palette_id: 'ink_solar',
        headline: 'Your {fact:year_number}.',
        body: '{fact:total_transactions_count} moments of money out and in, unscrambled into one living grid.',
        fact_ids: ['year_number', 'total_transactions_count', 'total_spend_usd'],
        txn_ids: transactions.slice(0, 50).map((t) => t.id),
        params: {
          kicker: 'THE POUR',
        },
      },
      {
        id: 'year_as_squares',
        type: 'year_as_squares',
        palette_id: 'ink_solar',
        headline: '{fact:total_spend_usd} across the calendar.',
        body: 'Every square is a day of {fact:year_number}, pulsing across {fact:payday_count} paydays.',
        fact_ids: ['total_spend_usd', 'year_number', 'payday_count'],
        txn_ids: outTxns.slice(0, 50).map((t) => t.id),
        params: {
          kicker: 'THE YEAR AS SQUARES',
        },
      },
      {
        id: 'your_place',
        type: 'your_place',
        palette_id: 'solar_ember',
        headline: '{fact:top_merchant_name}',
        body: '{fact:visits_top_merchant} visits this year, adding up to {fact:spend_top_merchant}.',
        fact_ids: ['top_merchant_name', 'visits_top_merchant', 'spend_top_merchant'],
        txn_ids: cornerTxns.map((t) => t.id),
        params: {
          kicker: 'YOUR PLACE',
          focus_merchant: 'Blue Bottle Coffee',
          focus_category: 'coffee',
        },
      },
      {
        id: 'shatter',
        type: 'shatter',
        palette_id: 'ink_rose',
        headline: 'Where {fact:total_spend_usd} went.',
        body: 'Every purchase breaks out of the calendar and stacks into its true category.',
        fact_ids: ['total_spend_usd', 'total_transactions_count'],
        txn_ids: outTxns.map((t) => t.id),
        params: {
          kicker: 'THE SHATTER',
        },
      },
      {
        id: 'personality',
        type: 'personality',
        palette_id: 'paper_studio',
        headline: 'The Studio-Building Sprinter',
        body: 'You surge {fact:payday_spike_ratio} after each of your {fact:payday_count} paydays.',
        fact_ids: [
          'payday_spike_ratio',
          'payday_count',
          'visits_top_merchant',
          'top_merchant_name',
        ],
        txn_ids: outTxns.slice(0, 30).map((t) => t.id),
        params: {
          kicker: 'YOUR MONEY PERSONALITY',
        },
      },
      {
        id: 'one_line',
        type: 'one_line',
        palette_id: 'ink_solar',
        headline:
          'In {fact:year_number}, across {fact:total_transactions_count} movements and {fact:total_spend_usd} spent, {fact:top_merchant_name} anchored your mornings {fact:visits_top_merchant} times.',
        body: 'One sentence, backed by every receipt in {fact:year_number}.',
        fact_ids: [
          'year_number',
          'total_transactions_count',
          'total_spend_usd',
          'top_merchant_name',
          'visits_top_merchant',
        ],
        txn_ids: cornerTxns.map((t) => t.id),
        params: {
          kicker: 'YOUR ONE LINE',
        },
      },
      {
        id: 'share_card',
        type: 'share_card',
        palette_id: 'solar_ember',
        headline: 'Sam · {fact:year_number}',
        body: '{fact:total_spend_usd} across {fact:total_transactions_count} moments · {fact:visits_top_merchant} visits to {fact:top_merchant_name}.',
        fact_ids: [
          'year_number',
          'total_spend_usd',
          'total_transactions_count',
          'visits_top_merchant',
          'top_merchant_name',
        ],
        txn_ids: cornerTxns.map((t) => t.id),
        params: {
          kicker: 'SHARE YOUR YEAR',
        },
      },
    ],
  };

  return { transactions, days, facts, plan };
}
