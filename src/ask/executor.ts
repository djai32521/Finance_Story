/**
 * Deterministic Query Executor (`src/ask/executor.ts`)
 *
 * Executes a validated `AskQueryDSL` purely in code against `Transaction[]`.
 * The model NEVER computes answers — all filtering, aggregation, sorting,
 * and money formatting happen deterministically here.
 */

import { CATEGORY_LABELS } from '../design/palette.js';
import { formatMoneyMinor, type Category, type Transaction } from '../../contracts/data.js';
import type {
  AskQueryDSL,
  AskQueryResult,
  GroupedQueryBucket,
  QueryMeasure,
} from '../../contracts/query.js';
import { parseQuestionToDSL } from './nl-parser.js';
import { validateAskQueryDSL } from './validator.js';

export const MONTH_LABELS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const WEEKDAY_LABELS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface CanonicalMerchantSpec {
  canonical: string;
  aliases: readonly string[];
  rawPatterns?: readonly RegExp[];
  defaultCategory?: Category;
}

/**
 * Canonical merchant definitions and safe aliases used by both the NL parser
 * and the query executor so merchant matching works across both mock and real datasets.
 */
export const CANONICAL_MERCHANT_SPECS: readonly CanonicalMerchantSpec[] = [
  {
    canonical: 'Blue Bottle Coffee',
    aliases: ['blue bottle coffee', 'blue bottle'],
    rawPatterns: [/blue\s*bottle/i],
    defaultCategory: 'coffee',
  },
  {
    canonical: "Trader Joe's",
    aliases: ["trader joe's", 'trader joes'],
    rawPatterns: [/trader\s*joe/i],
    defaultCategory: 'groceries',
  },
  {
    canonical: 'Uber Eats',
    aliases: ['uber eats', 'ubereats'],
    rawPatterns: [/uber\s+eats/i],
    defaultCategory: 'takeaway',
  },
  {
    canonical: 'Uber One',
    aliases: ['uber one'],
    rawPatterns: [/uber\s+one/i],
    defaultCategory: 'subscriptions',
  },
  {
    canonical: 'B&H Photo',
    aliases: ['b&h photo', 'bh photo', 'b&h'],
    rawPatterns: [/b&h\s*photo|bh\s*photo/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Monarch Acoustic',
    aliases: ['monarch acoustic', 'monarch'],
    rawPatterns: [/monarch\s*acoustic/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Sightglass Coffee',
    aliases: ['sightglass coffee', 'sightglass coffee roasters', 'sightglass'],
    rawPatterns: [/sightglass/i],
    defaultCategory: 'coffee',
  },
  {
    canonical: 'Lantern & Lark',
    aliases: ['lantern and lark', 'lantern & lark'],
    rawPatterns: [/lantern\s+(and|&)\s+lark/i],
    defaultCategory: 'coffee',
  },
  {
    canonical: 'Shell',
    aliases: ['shell', 'shell oil', 'shell station'],
    rawPatterns: [/^shell\s+oil|^shell\b/i],
    defaultCategory: 'transport',
  },
  {
    canonical: 'Puget Sound Energy',
    aliases: ['puget sound energy', 'pse'],
    rawPatterns: [/puget\s+sound\s+energy/i],
    defaultCategory: 'bills',
  },
  {
    canonical: 'Seattle City Light',
    aliases: ['seattle city light', 'city light'],
    rawPatterns: [/seattle\s+city\s+light/i],
    defaultCategory: 'bills',
  },
  {
    canonical: 'Mint Mobile',
    aliases: ['mint', 'mint mobile'],
    rawPatterns: [/mint\s+mobile|^mint$/i],
    defaultCategory: 'bills',
  },
  {
    canonical: 'T-Mobile',
    aliases: ['t-mobile', 't-mobile wireless', 'tmobile'],
    rawPatterns: [/t-mobile/i],
    defaultCategory: 'bills',
  },
  {
    canonical: 'Adobe',
    aliases: ['adobe', 'adobe.com', 'adobe systems', 'adobe dublin'],
    rawPatterns: [/adobe/i],
    defaultCategory: 'subscriptions',
  },
  {
    canonical: 'Brightpath',
    aliases: ['brightpath', 'brightpath physio', 'py brightpath'],
    rawPatterns: [/brightpath/i],
    defaultCategory: 'health',
  },
  {
    canonical: 'Northgate Brewing',
    aliases: ['northgate brewing', 'northgate brewing co', 'northgate'],
    rawPatterns: [/northgate\s+brewing/i],
    defaultCategory: 'eating out',
  },
  {
    canonical: 'Sweetwater',
    aliases: ['sweetwater', 'sweetwater sound'],
    rawPatterns: [/sweetwater/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Alaska Airlines',
    aliases: ['alaska airlines', 'alaska air'],
    rawPatterns: [/alaska\s+air/i],
    defaultCategory: 'travel',
  },
  {
    canonical: 'Korean Air',
    aliases: ['korean air', 'koreanair'],
    rawPatterns: [/korean\s*air/i],
    defaultCategory: 'travel',
  },
  {
    canonical: 'Spotify',
    aliases: ['spotify'],
    rawPatterns: [/spotify/i],
    defaultCategory: 'subscriptions',
  },
  {
    canonical: 'Patreon',
    aliases: ['patreon'],
    rawPatterns: [/patreon/i],
    defaultCategory: 'subscriptions',
  },
  {
    canonical: 'Google One',
    aliases: ['google one'],
    rawPatterns: [/google\s+one/i],
    defaultCategory: 'subscriptions',
  },
  {
    canonical: 'Target Grocery',
    aliases: ['target grocery'],
    rawPatterns: [/target\s+grocery/i],
    defaultCategory: 'groceries',
  },
  {
    canonical: 'Costco Wholesale',
    aliases: ['costco wholesale', 'costco'],
    rawPatterns: [/costco\s+wholesale/i],
    defaultCategory: 'groceries',
  },
  {
    canonical: 'Whole Foods Market',
    aliases: ['whole foods market', 'whole foods'],
    rawPatterns: [/whole\s+foods\s+market/i],
    defaultCategory: 'groceries',
  },
  {
    canonical: 'Golden Lotus Mart',
    aliases: ['golden lotus mart', 'golden lotus'],
    rawPatterns: [/golden\s+lotus/i],
    defaultCategory: 'groceries',
  },
  {
    canonical: 'Japan Mart',
    aliases: ['japan mart'],
    rawPatterns: [/japan\s+mart/i],
    defaultCategory: 'groceries',
  },
  {
    canonical: 'The Home Depot',
    aliases: ['the home depot', 'home depot'],
    rawPatterns: [/home\s+depot/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: "Lowe's",
    aliases: ["lowe's", 'lowes'],
    rawPatterns: [/lowe'?s/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Target',
    aliases: ['target', 'target store'],
    rawPatterns: [/target\s+store|^target$/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Adafruit',
    aliases: ['adafruit', 'micro center'],
    rawPatterns: [/micro\s+center|adafruit/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Brewcraft',
    aliases: ['brewcraft', 'brewcraft supplies'],
    rawPatterns: [/brewcraft/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Quick Plate',
    aliases: ['quick plate'],
    rawPatterns: [/quick\s+plate/i],
    defaultCategory: 'takeaway',
  },
  {
    canonical: 'Good Dough Bagels',
    aliases: ['good dough bagels', 'good dough'],
    rawPatterns: [/good\s+dough/i],
    defaultCategory: 'coffee',
  },
  {
    canonical: 'Cafe Lumen',
    aliases: ['cafe lumen', 'café lumen'],
    rawPatterns: [/cafe\s+lumen/i],
    defaultCategory: 'coffee',
  },
  {
    canonical: 'Grain & Silver',
    aliases: ['grain & silver', 'grain and silver'],
    rawPatterns: [/grain\s*&\s*silver/i],
    defaultCategory: 'coffee',
  },
  {
    canonical: 'Cedargate Brewery',
    aliases: ['cedargate brewery', 'cedargate'],
    rawPatterns: [/cedargate\s+brewery/i],
    defaultCategory: 'eating out',
  },
  {
    canonical: 'Shake Shack',
    aliases: ['shake shack', 'shakeshack'],
    rawPatterns: [/shake\s*shack/i],
    defaultCategory: 'takeaway',
  },
  {
    canonical: 'Inkblot Books',
    aliases: ['inkblot books', 'inkblot'],
    rawPatterns: [/inkblot\s+books/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Stripes Uptown',
    aliases: ['stripes uptown', 'stripesuptown'],
    rawPatterns: [/stripesuptown/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Squarespace',
    aliases: ['squarespace', 'sqsp'],
    rawPatterns: [/squarespace|sqsp/i],
    defaultCategory: 'subscriptions',
  },
  {
    canonical: 'SynthYard',
    aliases: ['synthyard', 'synthyardlt'],
    rawPatterns: [/synthyard/i],
    defaultCategory: 'shopping',
  },
  {
    canonical: 'Ticketmaster',
    aliases: ['ticketmaster'],
    rawPatterns: [/ticketmaster/i],
    defaultCategory: 'fun',
  },
  {
    canonical: 'Pacific Studio Labs',
    aliases: ['pacific studio labs', 'pacific studio'],
    rawPatterns: [/pacific\s+studio\s+labs/i],
    defaultCategory: 'income',
  },
  {
    canonical: 'FX Fee',
    aliases: [
      'fx fee',
      'intl transaction fee',
      'international transaction fee',
      'foreign transaction fee',
      'fx fees',
    ],
    rawPatterns: [/intl\s+transaction\s+fee/i],
    defaultCategory: 'fees',
  },
  {
    canonical: 'Sound Transit',
    aliases: ['sound transit', 'sound transit parking', 'seattle dot'],
    rawPatterns: [/sound\s+transit|seattle\s+dot/i],
    defaultCategory: 'transport',
  },
  {
    canonical: 'Washington DOL',
    aliases: ['washington dol', 'wa dol', 'wsdot'],
    rawPatterns: [/wsdot|washington\s+dol/i],
    defaultCategory: 'transport',
  },
  {
    canonical: 'Walgreens',
    aliases: ['walgreens'],
    rawPatterns: [/walgreens/i],
    defaultCategory: 'health',
  },
  {
    canonical: 'CVS Pharmacy',
    aliases: ['cvs pharmacy', 'cvs'],
    rawPatterns: [/cvs\s+pharmacy/i],
    defaultCategory: 'health',
  },
];

/**
 * Compute weekday index from ISO date string `YYYY-MM-DD`:
 * `0 = Monday .. 6 = Sunday` (per `DECISIONS.md` D-09).
 */
export function getIsoWeekday(isoDate: string): number {
  const dt = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const jsDay = dt.getUTCDay(); // 0 = Sun .. 6 = Sat
  return (jsDay + 6) % 7; // 0 = Mon .. 6 = Sun
}

function normalizeWhitespace(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Match a transaction against a requested merchant filter string.
 * Supports canonical merchant aliases so queries work reliably across
 * slight variations in cleaned merchant display names.
 */
export function matchesMerchantFilter(txn: Transaction, merchantFilter: string): boolean {
  const needle = normalizeWhitespace(merchantFilter);
  if (!needle) return true;

  const txnMerchant = normalizeWhitespace(txn.merchant);
  const txnRaw = normalizeWhitespace(txn.raw_description ?? '');

  // Check if the filter matches a known canonical merchant spec
  const matchedSpec = CANONICAL_MERCHANT_SPECS.find(
    (spec) =>
      normalizeWhitespace(spec.canonical) === needle ||
      spec.aliases.some((a) => normalizeWhitespace(a) === needle)
  );

  if (matchedSpec) {
    if (normalizeWhitespace(matchedSpec.canonical) === txnMerchant) {
      return true;
    }
    if (
      matchedSpec.aliases.some((alias) => {
        const normAlias = normalizeWhitespace(alias);
        return txnMerchant === normAlias || txnMerchant.includes(normAlias);
      })
    ) {
      return true;
    }
    if (
      matchedSpec.rawPatterns &&
      matchedSpec.rawPatterns.some((re) => re.test(txnRaw) || re.test(txnMerchant))
    ) {
      return true;
    }
    return false;
  }

  // Fallback substring match on cleaned merchant name (or non-PII raw description)
  if (txnMerchant.includes(needle) || needle.includes(txnMerchant)) {
    return true;
  }
  return false;
}

/**
 * Strip any accidental account numbers, card numbers, or unmasked names from
 * a merchant display string (Rule 6: Privacy by default).
 */
export function sanitizeMerchantDisplay(merchant: string): string {
  return merchant
    .replace(/\bUS-ACCT-\d+\b/gi, '')
    .replace(/\b\d{2}-\d{4}-\s*\d{7}-\d{2}\b/g, '')
    .replace(/\bFC\d{2}-\d{4}-\d{7}-\d{2}\b/gi, '')
    .replace(/\bCARD\s+\d{4}\b/gi, 'Card')
    .replace(/\b(Sam\s+MERCER|sammercer|samm)\b/gi, 'Self')
    .replace(/\bMax\s*Vance\b/gi, 'Friend A')
    .replace(/\bLEE\s+R\b/gi, 'Friend B')
    .replace(/\bShare\b/gi, 'Friend C')
    .replace(/\bTheo(\s*flight)?\b/gi, 'Friend D')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute aggregate value in minor units (or count) for a slice of transactions.
 */
function computeAggregateMinor(txns: readonly Transaction[], measure: QueryMeasure): number {
  if (txns.length === 0) return 0;
  switch (measure) {
    case 'sum':
      return txns.reduce((acc, t) => acc + t.amount_minor, 0);
    case 'count':
    case 'list':
      return txns.length;
    case 'average': {
      const sum = txns.reduce((acc, t) => acc + t.amount_minor, 0);
      return Math.round(sum / txns.length);
    }
    case 'max': {
      let maxVal = txns[0]!.amount_minor;
      for (const t of txns) {
        if (t.amount_minor > maxVal) maxVal = t.amount_minor;
      }
      return maxVal;
    }
    case 'min': {
      let minVal = txns[0]!.amount_minor;
      for (const t of txns) {
        if (t.amount_minor < minVal) minVal = t.amount_minor;
      }
      return minVal;
    }
  }
}

function formatAggregateValue(valueMinor: number, measure: QueryMeasure): string {
  if (measure === 'count' || measure === 'list') {
    return Math.round(valueMinor).toLocaleString('en-US');
  }
  if (measure === 'average') {
    return formatMoneyMinor(valueMinor, { showCents: true });
  }
  return formatMoneyMinor(valueMinor);
}

/**
 * Compute grouped breakdown buckets according to `query.group_by`.
 */
function computeBreakdown(
  matching: readonly Transaction[],
  query: AskQueryDSL
): GroupedQueryBucket[] {
  const { group_by, measure, filters } = query;
  if (group_by === 'none') {
    return [];
  }

  if (group_by === 'month') {
    // Determine month range (default all 12 months of 2025)
    const startMonth = filters.date_from ? Number(filters.date_from.slice(5, 7)) - 1 : 0;
    const endMonth = filters.date_to ? Number(filters.date_to.slice(5, 7)) - 1 : 11;
    const yearStr = filters.date_from?.slice(0, 4) ?? matching[0]?.date.slice(0, 4) ?? '2025';

    const byMonth = new Map<number, Transaction[]>();
    for (let m = Math.max(0, startMonth); m <= Math.min(11, endMonth); m++) {
      byMonth.set(m, []);
    }
    for (const t of matching) {
      const m = Number(t.date.slice(5, 7)) - 1;
      if (m >= 0 && m <= 11) {
        const list = byMonth.get(m) ?? [];
        list.push(t);
        byMonth.set(m, list);
      }
    }

    return Array.from(byMonth.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([m, txns]) => {
        const key = `${yearStr}-${String(m + 1).padStart(2, '0')}`;
        const label = MONTH_LABELS_SHORT[m] ?? key;
        const val = computeAggregateMinor(txns, measure);
        return {
          key,
          label,
          value_minor: val,
          count: txns.length,
          formatted_value: formatAggregateValue(val, measure),
          txn_ids: txns.map((t) => t.id),
        };
      });
  }

  if (group_by === 'weekday') {
    const byWeekday = new Map<number, Transaction[]>();
    for (let w = 0; w < 7; w++) {
      byWeekday.set(w, []);
    }
    for (const t of matching) {
      const w = getIsoWeekday(t.date);
      const list = byWeekday.get(w) ?? [];
      list.push(t);
      byWeekday.set(w, list);
    }

    return Array.from(byWeekday.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([w, txns]) => {
        const key = String(w);
        const label = WEEKDAY_LABELS_SHORT[w] ?? key;
        const val = computeAggregateMinor(txns, measure);
        return {
          key,
          label,
          value_minor: val,
          count: txns.length,
          formatted_value: formatAggregateValue(val, measure),
          txn_ids: txns.map((t) => t.id),
        };
      });
  }

  if (group_by === 'merchant') {
    const byMerchant = new Map<string, Transaction[]>();
    for (const t of matching) {
      const cleanName = sanitizeMerchantDisplay(t.merchant) || 'Unknown';
      const list = byMerchant.get(cleanName) ?? [];
      list.push(t);
      byMerchant.set(cleanName, list);
    }

    return Array.from(byMerchant.entries())
      .map(([merchant, txns]) => {
        const val = computeAggregateMinor(txns, measure);
        return {
          key: merchant.toLowerCase(),
          label: merchant,
          value_minor: val,
          count: txns.length,
          formatted_value: formatAggregateValue(val, measure),
          txn_ids: txns.map((t) => t.id),
        };
      })
      .sort(
        (a, b) =>
          b.value_minor - a.value_minor || b.count - a.count || a.label.localeCompare(b.label)
      );
  }

  if (group_by === 'category') {
    const byCategory = new Map<Category, Transaction[]>();
    for (const t of matching) {
      const list = byCategory.get(t.category) ?? [];
      list.push(t);
      byCategory.set(t.category, list);
    }

    return Array.from(byCategory.entries())
      .map(([cat, txns]) => {
        const val = computeAggregateMinor(txns, measure);
        const label = CATEGORY_LABELS[cat] ?? cat;
        return {
          key: cat,
          label,
          value_minor: val,
          count: txns.length,
          formatted_value: formatAggregateValue(val, measure),
          txn_ids: txns.map((t) => t.id),
        };
      })
      .sort(
        (a, b) =>
          b.value_minor - a.value_minor || b.count - a.count || a.label.localeCompare(b.label)
      );
  }

  return [];
}

/**
 * Execute an `AskQueryDSL` against a dataset of `Transaction[]`.
 */
export function executeAskQuery(
  queryInput: AskQueryDSL,
  transactions: readonly Transaction[],
  options: {
    question?: string;
    source?: 'model' | 'deterministic' | 'builder';
  } = {}
): AskQueryResult {
  const question = options.question ?? queryInput.interpretation ?? '';
  const source = options.source ?? 'deterministic';

  let effectiveInput = queryInput;
  if (
    source === 'deterministic' &&
    options.question &&
    transactions.length > 0 &&
    ((queryInput.filters.merchants.length === 0 && queryInput.filters.categories.length === 0) ||
      !queryInput.answerable ||
      (transactions[0]?.date && !transactions[0].date.startsWith('2025')))
  ) {
    effectiveInput = parseQuestionToDSL(options.question, transactions);
  }

  const validation = validateAskQueryDSL(effectiveInput, question, transactions);
  const query = validation.query;

  if (!query.answerable) {
    return {
      question,
      query,
      answerable: false,
      reason_if_not: query.reason_if_not,
      suggested_question:
        query.suggested_question ?? 'How much did I spend on eating out on weekends?',
      value_minor: 0,
      formatted_answer: 'Can’t tell',
      unit_label: '',
      interpretation: query.reason_if_not ?? 'This question cannot be answered from the bank CSV.',
      matching_dates: [],
      matching_txn_ids: [],
      receipts: [],
      breakdown: [],
      source,
    };
  }

  const { filters, measure } = query;
  const lowerCategories = filters.categories.map((c) => c.toLowerCase() as Category);
  const explicitlyRequestsTransfers = lowerCategories.includes('transfers');

  // Filter transactions deterministically
  const matching = transactions.filter((txn) => {
    // 1. Direction & transfer/refund exclusion
    if (txn.direction !== filters.direction) {
      return false;
    }

    if (!explicitlyRequestsTransfers) {
      if (txn.is_transfer || txn.category === 'transfers') {
        return false;
      }
      if (txn.is_refund) {
        return false;
      }
    }

    // 2. Category filter (case-insensitive)
    if (lowerCategories.length > 0) {
      const txnCat = txn.category.toLowerCase() as Category;
      if (!lowerCategories.includes(txnCat)) {
        return false;
      }
    }

    // 3. Merchant filter
    if (filters.merchants.length > 0) {
      const matchedAnyMerchant = filters.merchants.some((m) => matchesMerchantFilter(txn, m));
      if (!matchedAnyMerchant) {
        return false;
      }
    }

    // 4. Date range filter (inclusive YYYY-MM-DD)
    if (filters.date_from !== null && txn.date < filters.date_from) {
      return false;
    }
    if (filters.date_to !== null && txn.date > filters.date_to) {
      return false;
    }

    // 5. Weekdays filter (0 = Monday .. 6 = Sunday)
    if (filters.weekdays.length > 0) {
      const weekday = getIsoWeekday(txn.date);
      if (!filters.weekdays.includes(weekday)) {
        return false;
      }
    }

    // 6. Amount min/max filter (in minor units / cents)
    if (filters.amount_min !== null && txn.amount_minor < filters.amount_min) {
      return false;
    }
    if (filters.amount_max !== null && txn.amount_minor > filters.amount_max) {
      return false;
    }

    return true;
  });

  // Sort receipts according to the measure
  const sortedReceipts = [...matching]
    .sort((a, b) => {
      if (measure === 'min') {
        return (
          a.amount_minor - b.amount_minor ||
          a.date.localeCompare(b.date) ||
          a.id.localeCompare(b.id)
        );
      }
      if (measure === 'list') {
        return (
          b.date.localeCompare(a.date) ||
          b.amount_minor - a.amount_minor ||
          a.id.localeCompare(b.id)
        );
      }
      // For sum, count, average, max: sort by amount_minor descending so receipts[0] is the largest transaction
      return (
        b.amount_minor - a.amount_minor || a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
      );
    })
    .map((t) => ({
      ...t,
      merchant: sanitizeMerchantDisplay(t.merchant),
    }));

  const value_minor = computeAggregateMinor(matching, measure);
  const formatted_answer = formatAggregateValue(value_minor, measure);

  let unit_label = 'US$';
  if (measure === 'count' || measure === 'list') {
    if (filters.merchants.length > 0) {
      unit_label = 'visits';
    } else if (filters.direction === 'in') {
      unit_label = 'deposits';
    } else {
      unit_label = 'purchases';
    }
  }

  // For max/min, enrich the interpretation with the winning merchant and date if not already present
  let interpretation = query.interpretation;
  if (
    (measure === 'max' || measure === 'min') &&
    sortedReceipts[0] &&
    !interpretation.toLowerCase().includes(sortedReceipts[0].merchant.toLowerCase())
  ) {
    const topTxn = sortedReceipts[0];
    interpretation = `${interpretation} (${topTxn.merchant} on ${topTxn.date})`;
  }

  // Matching dates & transaction IDs
  const dateSource =
    (measure === 'max' || measure === 'min') &&
    filters.categories.length === 0 &&
    filters.merchants.length === 0 &&
    sortedReceipts[0]
      ? [sortedReceipts[0]]
      : sortedReceipts;

  const matching_dates = Array.from(new Set(dateSource.map((t) => t.date))).sort();
  const matching_txn_ids = sortedReceipts.map((t) => t.id);
  const breakdown = computeBreakdown(sortedReceipts, query);

  return {
    question,
    query: {
      ...query,
      interpretation,
    },
    answerable: true,
    reason_if_not: null,
    suggested_question: null,
    value_minor,
    formatted_answer,
    unit_label,
    interpretation,
    matching_dates,
    matching_txn_ids,
    receipts: sortedReceipts,
    breakdown,
    source,
  };
}
