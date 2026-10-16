/**
 * Deterministic Natural-Language -> `AskQueryDSL` Parser (`src/ask/nl-parser.ts`)
 *
 * Translates plain-English questions about Sam's 2025 into the Section 6.3 Query DSL
 * deterministically for instant offline execution and no-API-key fallback mode.
 * Also provides the structured chip-builder -> `AskQueryDSL` constructor.
 */

import { CATEGORY_LABELS } from '../design/palette.js';
import {
  DEFAULT_B2B_CATEGORY_LABELS,
  type Category,
  type Direction,
  type Transaction,
} from '../../contracts/data.js';
import type {
  AskQueryDSL,
  QueryFilters,
  QueryGroupBy,
  QueryMeasure,
} from '../../contracts/query.js';
import { CANONICAL_MERCHANT_SPECS } from './executor.js';
import { checkQuestionAnswerability, createDefaultFilters } from './validator.js';

export const MONTH_DAYS_2025 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function getMonthDays(year: number): readonly number[] {
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return isLeap ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] : MONTH_DAYS_2025;
}

export const MONTH_NAMES_FULL = [
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

export const MONTH_NAMES_SHORT = [
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

export const WEEKDAY_NAMES_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

interface CategoryPatternRule {
  category: Category;
  patterns: readonly RegExp[];
}

/**
 * Synonym rules for all 17 categories in order of specificity (Consumer + B2B).
 */
const CATEGORY_RULES: readonly CategoryPatternRule[] = [
  {
    category: 'takeaway',
    patterns: [
      /\b(takeaways?|take-aways?|takeouts?|take-outs?|uber\s*eats|food\s+delivery|deliveries|fast\s+food|catering|on-demand\s+catering|field\s+catering)\b/i,
      /(배달|포장|배민|배달의민족|쿠팡이츠|요기요|야식|패스트푸드)/i,
    ],
  },
  {
    category: 'coffee',
    patterns: [
      /\b(coffees?|cafes?|cafés?|espresso|flat\s+whites?|lattes?|cappuccinos?|barista|roasters?|bagels?|team\s+fuel)\b/i,
      /(커피|카페|스타벅스|블루보틀|아메리카노|라떼|투썸|이디야|메가커피|컴포즈)/i,
    ],
  },
  {
    category: 'eating out',
    patterns: [
      /\b(eating\s+out|eat\s+out|dining\s+out|dining|restaurants?|bars?|pubs?|breweries|brewery|drinks|dinners?|lunches|brunch|hospitality|client\s+dinners?|team\s+dinners?)\b/i,
      /(외식|식당|음식점|회식|식비|점심|저녁|식사|주점)/i,
    ],
  },
  {
    category: 'groceries',
    patterns: [
      /\b(groceries|grocery|supermarkets?|food\s+shopping|food\s+shops?|workplace\s+ops|office\s+ops|office\s+supplies|pantry)\b/i,
      /(식료품|장보기|마트|이마트|홈플러스|롯데마트|마켓컬리|슈퍼|편의점)/i,
    ],
  },
  {
    category: 'travel',
    patterns: [
      /\b(travel|travelling|traveling|flights?|airlines?|holidays?|vacations?|trips?|hotels?|accommodations?|getaways?|touring|executive\s+travel|airfare|lodging)\b/i,
      /(여행|항공|비행기|숙박|호텔|펜션|리조트|휴가|출장)/i,
    ],
  },
  {
    category: 'transport',
    patterns: [
      /\b(transport|transportation|petrol|fuel|gas\s+station|gas|parking|tolls?|buses|bus|ferry|ferries|trains?|transit|tyres?|tires?|scooters?|rideshares?|uber\s+trips?|uber\s+rides?|logistics|fleet|freight|shipping|courier)\b/i,
      /(교통|지하철|버스|택시|주유|기름값|티머니|카카오t|톨게이트|하이패스)/i,
    ],
  },
  {
    category: 'bills',
    patterns: [
      /\b(bills?|utilities|utility|power|electricity|electric|energy\s+bills?|mobile\s+plan|phone\s+bills?|phone|internet|broadband|rates|telecom)\b/i,
      /(공과금|전기세|수도세|가스비|통신비|휴대폰비|인터넷비|관리비)/i,
    ],
  },
  {
    category: 'rent',
    patterns: [
      /\b(rent|rental|landlord|facilities|real\s+estate|office\s+lease|workspace)\b/i,
      /(월세|임대료|사무실\s*임대)/i,
    ],
  },
  {
    category: 'subscriptions',
    patterns: [
      /\b(subscriptions?|memberships?|recurring\s+apps?|streaming|cloud\s*&\s*saas|cloud|saas|software\s+stack|hosting|infrastructure)\b/i,
      /(구독|정기결제|넷플릭스|유튜브|클라우드|saas|소프트웨어)/i,
    ],
  },
  {
    category: 'health',
    patterns: [
      /\b(health|healthcare|medical|physio|physiotherapy|doctors?|pharmacy|pharmacies|chemist|dentist|dental|optometrist|benefits|wellness|workforce\s+wellness)\b/i,
      /(병원|약국|의료|치과|건강|피트니스|헬스장)/i,
    ],
  },
  {
    category: 'fun',
    patterns: [
      /\b(fun|entertainment|concerts?|gigs?|movies?|cinema|tickets?|events?|festivals?|games?|gaming|hobbies|summits?|offsites?|conferences?)\b/i,
      /(영화|콘서트|공연|게임|취미|티켓|문화|여가)/i,
    ],
  },
  {
    category: 'gifts',
    patterns: [
      /\b(gifts?|presents?|charity|donations?|flowers?|florist|gofundme|client\s+gifting|partner\s+gifting)\b/i,
      /(선물|기부|후원|경조사|축의금|부의금)/i,
    ],
  },
  {
    category: 'fees',
    patterns: [
      /\b(fees?|bank\s+fees?|card\s+fees?|tax\s+on\s+interest|withholding\s+tax|irs\s+tax|processing\s+fees?|banking\s+fees?)\b/i,
      /(수수료|환전\s*수수료|세금|부가세|소득세)/i,
    ],
  },
  {
    category: 'savings',
    patterns: [
      /\b(savings?|investments?|investing|invested|401k|fidelity|retirement|fxpay|treasury|capital\s+reserves?|reserves)\b/i,
      /(저축|적금|투자|주식|예금|청약)/i,
    ],
  },
  {
    category: 'transfers',
    patterns: [
      /\b(transfers?|repayments?|card\s+repayments?|roundups?|round-ups?|intercompany|internal\s+transfers?)\b/i,
      /(이체|계좌이체|송금|상환)/i,
    ],
  },
  {
    category: 'income',
    patterns: [
      /\b(income|salary|salaries|wages?|paychecks?|paydays?|earnings?|earned|pacific\s+studio|revenue|inflows?|gross\s+inflows?|arr|mrr|sales|billings|collections)\b/i,
      /\bhow\s+much\s+was\s+i\s+paid\b/i,
      /\bhow\s+much\s+did\s+(i|we)\s+(make|earn|receive)\b/i,
      /(수입|급여|월급|매출|수익|입금|보너스|정산)/i,
    ],
  },
  {
    category: 'shopping',
    patterns: [
      /\b(shopping|retail|clothes|clothing|electronics|hardware|furniture|books?|music\s+gear|studio\s+gear|synths?|synthesizers?|capex|equipment|procurement)\b/i,
      /(쇼핑|구매|의류|옷|신발|전자제품|가전|가구|장비)/i,
    ],
  },
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GENERIC_CATEGORY_STOPWORDS = new Set([
  'coffee',
  'travel',
  'health',
  'shopping',
  'transport',
  'bills',
  'rent',
  'gifts',
  'savings',
  'income',
  'transfers',
  'fees',
  'fun',
  'groceries',
  'takeaway',
  'subscriptions',
  'cloud',
  'saas',
  'revenue',
  'inflows',
  'facilities',
  'capex',
  'logistics',
  'hospitality',
  'catering',
  'benefits',
  'treasury',
]);

/**
 * Detect mentioned canonical merchants and dynamic dataset merchants in the question.
 */
function extractMerchants(question: string, transactions?: readonly Transaction[]): string[] {
  const norm = question.toLowerCase().replace(/\s+/g, ' ').trim();
  const matched: string[] = [];

  // Special explicit check for FX / international transaction fees
  if (
    /\b(fx\s+fees?|foreign\s+(currency|exchange|transaction)\s+fees?|international\s+(transaction\s+)?fees?|intl\s+(transaction\s+)?fees?)\b/i.test(
      norm
    )
  ) {
    return ['FX Fee'];
  }

  // Sort aliases longest-first so "uber eats" matches before "uber", "sightglass coffee" before "sightglass", etc.
  const aliasPairs: Array<{ alias: string; canonical: string }> = [];
  for (const spec of CANONICAL_MERCHANT_SPECS) {
    aliasPairs.push({
      alias: spec.canonical.toLowerCase(),
      canonical: spec.canonical,
    });
    for (const a of spec.aliases) {
      aliasPairs.push({ alias: a.toLowerCase(), canonical: spec.canonical });
    }
  }

  // Also include dynamic merchants from the active dataset
  if (transactions && transactions.length > 0) {
    const uniqueDynamicMerchants = new Set<string>();
    for (const t of transactions) {
      const m = t.merchant?.trim();
      if (m && m.length >= 3) {
        uniqueDynamicMerchants.add(m);
      }
    }
    for (const m of uniqueDynamicMerchants) {
      const lower = m.toLowerCase();
      if (!GENERIC_CATEGORY_STOPWORDS.has(lower)) {
        aliasPairs.push({ alias: lower, canonical: m });
      }
      if (lower === 'aws') {
        aliasPairs.push({ alias: 'amazon web services', canonical: m });
      } else if (lower === 'google cloud') {
        aliasPairs.push({ alias: 'google cloud platform', canonical: m });
        aliasPairs.push({ alias: 'gcp', canonical: m });
      }
      const stripped = m
        .replace(
          /\b(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|co\.?|limited|gmbh|plc|enterprise)\b/gi,
          ''
        )
        .replace(/[.,]+$/g, '')
        .trim();
      if (
        stripped.length >= 3 &&
        stripped.toLowerCase() !== lower &&
        !GENERIC_CATEGORY_STOPWORDS.has(stripped.toLowerCase())
      ) {
        aliasPairs.push({ alias: stripped.toLowerCase(), canonical: m });
      }
    }
  }

  aliasPairs.sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, canonical } of aliasPairs) {
    if (matched.some((existing) => existing.toLowerCase() === canonical.toLowerCase())) continue;
    const re = new RegExp(`(?:^|\\b)${escapeRegex(alias)}(?:\\b|$)`, 'i');
    if (re.test(norm)) {
      matched.push(canonical);
    }
  }

  return matched;
}

/**
 * Detect mentioned categories (including custom `t.category_label`s) in the question.
 */
function extractCategories(question: string, transactions?: readonly Transaction[]): Category[] {
  const matched: Category[] = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(question))) {
      if (!matched.includes(rule.category)) {
        matched.push(rule.category);
      }
    }
  }

  // Also check custom category_label values present in the dataset
  if (transactions && transactions.length > 0) {
    const customLabelMap = new Map<string, Category>();
    for (const [cat, label] of Object.entries(DEFAULT_B2B_CATEGORY_LABELS)) {
      customLabelMap.set(label.toLowerCase(), cat as Category);
    }
    for (const t of transactions) {
      if (t.category_label && t.category_label.trim().length >= 3) {
        customLabelMap.set(t.category_label.trim().toLowerCase(), t.category);
      }
    }
    const qLower = question.toLowerCase();
    for (const [labelLower, cat] of customLabelMap.entries()) {
      if (matched.includes(cat)) continue;
      if (qLower.includes(labelLower)) {
        matched.push(cat);
      }
    }
  }

  return matched;
}

/**
 * Extract date range (`date_from`, `date_to`) from months or quarters in the dataset's year(s).
 */
function extractDateRange(
  question: string,
  year = 2025,
  transactions?: readonly Transaction[]
): {
  date_from: string | null;
  date_to: string | null;
  label: string;
} {
  const q = question.toLowerCase();
  const monthYearMap = new Map<number, number>();
  if (transactions && transactions.length > 0) {
    for (const t of transactions) {
      const y = Number.parseInt(t.date.slice(0, 4), 10);
      const m = Number.parseInt(t.date.slice(5, 7), 10) - 1;
      if (Number.isFinite(y) && m >= 0 && m <= 11 && !monthYearMap.has(m)) {
        monthYearMap.set(m, y);
      }
    }
  }
  const yearForMonth = (m: number): number => monthYearMap.get(m) ?? year;

  // Check quarters first (Q1..Q4 or 1분기..4분기)
  if (/\b(q1|first\s+quarter|quarter\s+1)\b|1분기/i.test(q)) {
    const qYear = yearForMonth(0);
    return {
      date_from: `${qYear}-01-01`,
      date_to: `${qYear}-03-31`,
      label: `Q1 ${qYear} (1 Jan – 31 Mar)`,
    };
  }
  if (/\b(q2|second\s+quarter|quarter\s+2)\b|2분기/i.test(q)) {
    const qYear = yearForMonth(3);
    return {
      date_from: `${qYear}-04-01`,
      date_to: `${qYear}-06-30`,
      label: `Q2 ${qYear} (1 Apr – 30 Jun)`,
    };
  }
  if (/\b(q3|third\s+quarter|quarter\s+3)\b|3분기/i.test(q)) {
    const qYear = yearForMonth(6);
    return {
      date_from: `${qYear}-07-01`,
      date_to: `${qYear}-09-30`,
      label: `Q3 ${qYear} (1 Jul – 30 Sep)`,
    };
  }
  if (/\b(q4|fourth\s+quarter|last\s+quarter|quarter\s+4)\b|4분기/i.test(q)) {
    const qYear = yearForMonth(9);
    return {
      date_from: `${qYear}-10-01`,
      date_to: `${qYear}-12-31`,
      label: `Q4 ${qYear} (1 Oct – 31 Dec)`,
    };
  }

  // Detect months (0..11) - English & Korean
  const mentionedMonths: number[] = [];
  for (let m = 0; m < 12; m++) {
    const full = MONTH_NAMES_FULL[m]!.toLowerCase();
    const short = MONTH_NAMES_SHORT[m]!.toLowerCase();
    const krMonth = `${m + 1}월`;

    if (m === 4) {
      // "May": avoid matching auxiliary verb "may I" at start unless preceded by preposition or capitalized
      const hasMayMonth =
        /\b(in|during|for|from|to|until|through|of|between|and)\s+may\b/i.test(question) ||
        /\bMay\b/.test(question) ||
        /\bmay\s+20\d\d\b/i.test(question) ||
        question.includes(krMonth);
      if (hasMayMonth) {
        mentionedMonths.push(m);
      }
      continue;
    }

    const extraSept = m === 8 ? '|sept' : '';
    const re = new RegExp(`\\b(${full}|${short}${extraSept})\\b|${krMonth}`, 'i');
    if (re.test(question)) {
      mentionedMonths.push(m);
    }
  }

  if (mentionedMonths.length === 1) {
    const m = mentionedMonths[0]!;
    const mYear = yearForMonth(m);
    const monthDays = getMonthDays(mYear);
    const mm = String(m + 1).padStart(2, '0');
    const lastDay = monthDays[m]!;
    return {
      date_from: `${mYear}-${mm}-01`,
      date_to: `${mYear}-${mm}-${String(lastDay).padStart(2, '0')}`,
      label: `1–${lastDay} ${MONTH_NAMES_FULL[m]}`,
    };
  }

  if (mentionedMonths.length >= 2) {
    const first = Math.min(...mentionedMonths);
    const last = Math.max(...mentionedMonths);
    const y1 = yearForMonth(first);
    const y2 = yearForMonth(last);
    const monthDays2 = getMonthDays(y2);
    const mm1 = String(first + 1).padStart(2, '0');
    const mm2 = String(last + 1).padStart(2, '0');
    const lastDay = monthDays2[last]!;
    const fromIso = `${y1}-${mm1}-01`;
    const toIso = `${y2}-${mm2}-${String(lastDay).padStart(2, '0')}`;
    return {
      date_from: fromIso <= toIso ? fromIso : `${year}-${mm1}-01`,
      date_to:
        fromIso <= toIso
          ? toIso
          : `${year}-${mm2}-${String(getMonthDays(year)[last]!).padStart(2, '0')}`,
      label: `1 ${MONTH_NAMES_SHORT[first]} – ${lastDay} ${MONTH_NAMES_SHORT[last]}`,
    };
  }

  return {
    date_from: null,
    date_to: null,
    label: `all of ${year}`,
  };
}

/**
 * Extract weekday filters (`0 = Monday .. 6 = Sunday`).
 */
function extractWeekdays(question: string): {
  weekdays: number[];
  label: string | null;
} {
  const q = question.toLowerCase();

  if (/\b(weekends?|saturdays?\s+and\s+sundays?)\b/i.test(q)) {
    return { weekdays: [5, 6], label: 'weekends' };
  }
  if (
    /\b(weekdays?|workdays?|monday\s+(to|through)\s+friday)\b/i.test(q) &&
    !/\bby\s+weekday\b/i.test(q)
  ) {
    return { weekdays: [0, 1, 2, 3, 4], label: 'weekdays' };
  }

  const dayPatterns: ReadonlyArray<{ idx: number; re: RegExp; name: string }> = [
    { idx: 0, re: /\b(mondays?|mon)\b/i, name: 'Mondays' },
    { idx: 1, re: /\b(tuesdays?|tue|tues)\b/i, name: 'Tuesdays' },
    { idx: 2, re: /\b(wednesdays?|wed)\b/i, name: 'Wednesdays' },
    { idx: 3, re: /\b(thursdays?|thu|thur|thurs)\b/i, name: 'Thursdays' },
    { idx: 4, re: /\b(fridays?|fri)\b/i, name: 'Fridays' },
    { idx: 5, re: /\b(saturdays?|sat)\b/i, name: 'Saturdays' },
    { idx: 6, re: /\b(sundays?)\b/i, name: 'Sundays' },
  ];

  const weekdays: number[] = [];
  const names: string[] = [];
  for (const d of dayPatterns) {
    if (d.re.test(question)) {
      weekdays.push(d.idx);
      names.push(d.name);
    }
  }

  if (weekdays.length > 0) {
    return { weekdays, label: names.join(' & ') };
  }
  return { weekdays: [], label: null };
}

/**
 * Extract amount thresholds (`over $100`, `under $20`).
 */
function extractAmountBounds(question: string): {
  amount_min: number | null;
  amount_max: number | null;
} {
  let amount_min: number | null = null;
  let amount_max: number | null = null;

  const minMatch = question.match(
    /\b(?:over|more\s+than|above|greater\s+than|at\s+least)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i
  );
  if (minMatch && minMatch[1]) {
    amount_min = Math.round(parseFloat(minMatch[1]) * 100);
  }

  const maxMatch = question.match(
    /\b(?:under|less\s+than|below|at\s+most|cheaper\s+than)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i
  );
  if (maxMatch && maxMatch[1]) {
    amount_max = Math.round(parseFloat(maxMatch[1]) * 100);
  }

  return { amount_min, amount_max };
}

/**
 * Extract query `measure` (`sum | count | average | max | min | list`).
 */
function extractMeasure(question: string): QueryMeasure {
  const q = question.toLowerCase();

  if (
    /\b(how\s+many|number\s+of|count\s+of|how\s+often|visits\s+to|times\s+did\s+(?:i|we))\b/i.test(
      q
    ) ||
    (/(몇\s*번|몇\s*건|횟수|건수|방문\s*횟수)/i.test(question)) ||
    (/\b(visits|rides|trips|purchases|transactions|invoices|payments|orders|settlements)\b/i.test(
      q
    ) &&
      /\b(how\s+many|total\s+number|count)\b/i.test(q))
  ) {
    return 'count';
  }
  if (
    /\b(average|avg|typical|mean|per\s+visit|per\s+purchase|per\s+coffee|per\s+trip|per\s+invoice|per\s+order)\b/i.test(
      q
    ) ||
    /(평균|건당|회당)/i.test(question)
  ) {
    return 'average';
  }
  if (
    /\b(biggest|largest|most\s+expensive|highest|priciest|maximum|max|top\s+single|single\s+biggest|costliest)\b/i.test(
      q
    ) ||
    /(가장\s*큰|최대|최고|가장\s*비싼|가장\s*많은)/i.test(question)
  ) {
    return 'max';
  }
  if (
    /\b(smallest|cheapest|lowest|least\s+expensive|minimum|min|tiniest)\b/i.test(q) ||
    /(가장\s*작은|최소|최저|가장\s*저렴|가장\s*적은)/i.test(question)
  ) {
    return 'min';
  }
  if (
    /\b(list\s+all|show\s+all|show\s+me\s+all|every\s+purchase|which\s+transactions)\b/i.test(q) ||
    /(목록|내역|전부\s*보여|모든\s*거래)/i.test(question)
  ) {
    return 'list';
  }
  return 'sum';
}

/**
 * Extract `group_by` (`none | month | weekday | merchant | category`).
 */
function extractGroupBy(question: string): QueryGroupBy {
  const q = question.toLowerCase();

  if (
    /\b(by\s+month|per\s+month|monthly\s+breakdown|each\s+month|month\s+by\s+month|across\s+months|which\s+month)\b/i.test(
      q
    ) ||
    /(월별|월마다|달별)/i.test(question)
  ) {
    return 'month';
  }
  if (
    /\b(by\s+weekday|by\s+day\s+of\s+(?:the\s+)?week|per\s+weekday|weekday\s+breakdown|which\s+day\s+of\s+(?:the\s+)?week)\b/i.test(
      q
    ) ||
    /(요일별|주말|평일)/i.test(question)
  ) {
    return 'weekday';
  }
  if (
    /\b(by\s+category|per\s+category|category\s+breakdown|across\s+categories|each\s+category|by\s+department|by\s+cost\s+center)\b/i.test(
      q
    ) ||
    /(카테고리별|항목별|분류별)/i.test(question)
  ) {
    return 'category';
  }
  if (
    /\b(by\s+merchant|per\s+merchant|top\s+merchants|merchant\s+breakdown|by\s+shop|by\s+store|by\s+place|by\s+vendor|top\s+vendors|by\s+counterparty|top\s+counterparties)\b/i.test(
      q
    ) ||
    /(가맹점별|상점별|업체별|가장\s*자주)/i.test(question)
  ) {
    return 'merchant';
  }
  return 'none';
}

function buildPlainEnglishInterpretation(params: {
  categories: readonly Category[];
  merchants: readonly string[];
  dateLabel: string;
  weekdayLabel: string | null;
  measure: QueryMeasure;
  group_by: QueryGroupBy;
  direction: Direction;
  amount_min: number | null;
  amount_max: number | null;
}): string {
  const {
    categories,
    merchants,
    dateLabel,
    weekdayLabel,
    measure,
    group_by,
    direction,
    amount_min,
    amount_max,
  } = params;

  let subject = 'All spending';
  if (merchants.length > 0) {
    subject = merchants.join(', ');
  } else if (categories.length > 0) {
    subject = categories.map((c) => CATEGORY_LABELS[c] ?? c).join(', ');
  } else if (direction === 'in') {
    subject = 'All income';
  }

  const parts: string[] = [subject];
  if (weekdayLabel) {
    parts.push(`on ${weekdayLabel}`);
  }
  if (amount_min !== null) {
    parts.push(`over $${(amount_min / 100).toFixed(0)}`);
  }
  if (amount_max !== null) {
    parts.push(`under $${(amount_max / 100).toFixed(0)}`);
  }

  const measureLabels: Record<QueryMeasure, string> = {
    sum: direction === 'in' ? 'total received' : 'total spent',
    count:
      merchants.length > 0
        ? 'number of visits'
        : direction === 'in'
          ? 'number of deposits'
          : 'number of purchases',
    average: 'average transaction',
    max: 'single biggest transaction',
    min: 'single smallest transaction',
    list: 'matching transactions',
  };

  const groupLabels: Record<QueryGroupBy, string> = {
    none: '',
    month: ' grouped by month',
    weekday: ' grouped by weekday',
    merchant: ' grouped by merchant',
    category: ' grouped by category',
  };

  return `${parts.join(' ')}, ${dateLabel}, ${measureLabels[measure]}${groupLabels[group_by]}.`;
}

/**
 * Deterministically translate a natural-language question into an `AskQueryDSL`.
 * Supports optional `transactions` so dynamic BYO datasets resolve custom years,
 * vendor/counterparty names, and `category_label`s automatically.
 */
export function parseQuestionToDSL(
  question: string,
  transactions?: readonly Transaction[]
): AskQueryDSL {
  const trimmed = question.trim();
  const availableYears =
    transactions && transactions.length > 0
      ? Array.from(
          new Set(
            transactions
              .map((t) => Number.parseInt(t.date.slice(0, 4), 10))
              .filter((n) => Number.isFinite(n))
          )
        )
      : [2025];
  const primaryYear = availableYears[0] ?? 2025;

  const answerability = checkQuestionAnswerability(trimmed, undefined, availableYears);

  if (!answerability.answerable) {
    return {
      filters: createDefaultFilters(),
      measure: 'sum',
      group_by: 'none',
      interpretation:
        answerability.reason_if_not ?? 'This question cannot be answered from the bank CSV.',
      answerable: false,
      reason_if_not: answerability.reason_if_not,
      suggested_question: answerability.suggested_question,
    };
  }

  const merchants = extractMerchants(trimmed, transactions);
  let categories = extractCategories(trimmed, transactions);

  // If a specific merchant is matched, prefer filtering by the merchant directly
  // unless the user explicitly asked for a category breakdown
  const group_by = extractGroupBy(trimmed);
  if (merchants.length > 0 && group_by !== 'category') {
    categories = [];
  }

  let direction: Direction = 'out';
  const matchedMerchantIsIncomeOnly =
    merchants.length > 0 &&
    transactions &&
    transactions.length > 0 &&
    (() => {
      const mLower = merchants[0]!.toLowerCase();
      const mTxns = transactions.filter((t) => t.merchant.toLowerCase().includes(mLower));
      return mTxns.length > 0 && mTxns.every((t) => t.direction === 'in');
    })();

  if (
    categories.includes('income') ||
    merchants.includes('Pacific Studio Labs') ||
    matchedMerchantIsIncomeOnly ||
    /\b(salary|salaries|wages?|income|earned|earnings|paychecks?|pacific\s+studio|money\s+in|revenue|inflows?|gross\s+inflows?|arr|mrr|sales|collections)\b/i.test(
      trimmed
    )
  ) {
    direction = 'in';
    if (merchants.length === 0 && !categories.includes('income')) {
      categories = ['income'];
    }
  }

  const {
    date_from,
    date_to,
    label: dateLabel,
  } = extractDateRange(trimmed, primaryYear, transactions);
  const { weekdays, label: weekdayLabel } = extractWeekdays(trimmed);
  const { amount_min, amount_max } = extractAmountBounds(trimmed);
  const measure = extractMeasure(trimmed);

  const filters: QueryFilters = {
    categories,
    merchants,
    date_from,
    date_to,
    weekdays,
    time_from: null,
    time_to: null,
    amount_min,
    amount_max,
    direction,
  };

  const interpretation = buildPlainEnglishInterpretation({
    categories,
    merchants,
    dateLabel,
    weekdayLabel,
    measure,
    group_by,
    direction,
    amount_min,
    amount_max,
  });

  return {
    filters,
    measure,
    group_by,
    interpretation,
    answerable: true,
    reason_if_not: null,
    suggested_question: null,
  };
}

export interface StructuredBuilderSelection {
  category?: Category | '' | null;
  merchant?: string | null;
  /** Month index 0 = Jan .. 11 = Dec, or null for all of 2025 */
  month?: number | null;
  weekdayMode?: 'all' | 'weekends' | 'weekdays';
  measure?: QueryMeasure;
  group_by?: QueryGroupBy;
}

/**
 * Build a deterministic `AskQueryDSL` from the structured no-key fallback chip builder.
 */
export function buildQueryFromSelection(selection: StructuredBuilderSelection): {
  question: string;
  query: AskQueryDSL;
} {
  const categories: Category[] = selection.category ? [selection.category] : [];
  const merchants: string[] =
    selection.merchant && selection.merchant.trim().length > 0 ? [selection.merchant.trim()] : [];

  const direction: Direction = categories.includes('income') ? 'in' : 'out';

  let date_from: string | null = null;
  let date_to: string | null = null;
  let dateLabel = 'all of 2025';

  if (typeof selection.month === 'number' && selection.month >= 0 && selection.month <= 11) {
    const m = selection.month;
    const mm = String(m + 1).padStart(2, '0');
    const lastDay = MONTH_DAYS_2025[m]!;
    date_from = `2025-${mm}-01`;
    date_to = `2025-${mm}-${String(lastDay).padStart(2, '0')}`;
    dateLabel = `1–${lastDay} ${MONTH_NAMES_FULL[m]}`;
  }

  let weekdays: number[] = [];
  let weekdayLabel: string | null = null;
  if (selection.weekdayMode === 'weekends') {
    weekdays = [5, 6];
    weekdayLabel = 'weekends';
  } else if (selection.weekdayMode === 'weekdays') {
    weekdays = [0, 1, 2, 3, 4];
    weekdayLabel = 'weekdays';
  }

  const measure: QueryMeasure = selection.measure ?? 'sum';
  const group_by: QueryGroupBy = selection.group_by ?? 'none';

  const interpretation = buildPlainEnglishInterpretation({
    categories,
    merchants,
    dateLabel,
    weekdayLabel,
    measure,
    group_by,
    direction,
    amount_min: null,
    amount_max: null,
  });

  // Synthesize a clean human-readable question string for the input box
  const subjectText =
    merchants[0] ??
    (categories[0]
      ? (CATEGORY_LABELS[categories[0]] ?? categories[0]).toLowerCase()
      : 'everything');
  const monthText =
    typeof selection.month === 'number' && selection.month >= 0 && selection.month <= 11
      ? ` in ${MONTH_NAMES_FULL[selection.month]}`
      : '';
  const wkText = weekdayLabel ? ` on ${weekdayLabel}` : '';
  const grpText = group_by !== 'none' ? ` by ${group_by}` : '';

  let question = `How much did I spend on ${subjectText}${wkText}${monthText}${grpText}?`;
  if (direction === 'in') {
    question = `How much ${subjectText} did I receive${monthText}${grpText}?`;
  } else if (measure === 'count') {
    question = merchants[0]
      ? `How many times did I visit ${merchants[0]}${wkText}${monthText}${grpText}?`
      : `How many ${subjectText} purchases did I make${wkText}${monthText}${grpText}?`;
  } else if (measure === 'average') {
    question = `What was my average spend on ${subjectText}${wkText}${monthText}${grpText}?`;
  } else if (measure === 'max') {
    question = `What was my biggest ${subjectText} purchase${wkText}${monthText}?`;
  } else if (measure === 'min') {
    question = `What was my smallest ${subjectText} purchase${wkText}${monthText}?`;
  }

  return {
    question,
    query: {
      filters: {
        categories,
        merchants,
        date_from,
        date_to,
        weekdays,
        time_from: null,
        time_to: null,
        amount_min: null,
        amount_max: null,
        direction,
      },
      measure,
      group_by,
      interpretation,
      answerable: true,
      reason_if_not: null,
      suggested_question: null,
    },
  };
}
