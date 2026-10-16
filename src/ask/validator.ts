/**
 * Query DSL Validator (`src/ask/validator.ts`)
 *
 * Validates `AskQueryDSL` schema and enforces dataset answerability rules
 * (e.g., no time-of-day timestamps in the bank CSV, no SKU-level receipt items,
 * no years outside 2025, no account balances or credit scores).
 */

import {
  CATEGORIES,
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

export const VALID_MEASURES: readonly QueryMeasure[] = [
  'sum',
  'count',
  'average',
  'max',
  'min',
  'list',
] as const;

export const VALID_GROUP_BYS: readonly QueryGroupBy[] = [
  'none',
  'month',
  'weekday',
  'merchant',
  'category',
] as const;

const CATEGORY_SET: ReadonlySet<string> = new Set<string>(CATEGORIES);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  query: AskQueryDSL;
}

export interface AnswerabilityCheck {
  answerable: boolean;
  reason_if_not: string | null;
  suggested_question: string | null;
}

export function createDefaultFilters(): QueryFilters {
  return {
    categories: [],
    merchants: [],
    date_from: null,
    date_to: null,
    weekdays: [],
    time_from: null,
    time_to: null,
    amount_min: null,
    amount_max: null,
    direction: 'out',
  };
}

/**
 * Suggest a contextually relevant answerable question when a user question is rejected.
 */
export function buildSuggestedQuestion(question: string, dsl?: Partial<AskQueryDSL>): string {
  const q = question.toLowerCase();
  const cats = dsl?.filters?.categories ?? [];
  const merchants = dsl?.filters?.merchants ?? [];

  if (
    cats.includes('coffee') ||
    merchants.some((m) => /blue bottle|sightglass|coffee/i.test(m)) ||
    /\b(coffees?|cafes?|cafés?|espressos?|lattes?|flat\s+whites?|cappuccinos?|blue bottle|morning)\b/.test(
      q
    )
  ) {
    return 'How much did I spend on coffee across the year?';
  }
  if (
    cats.includes('takeaway') ||
    /\b(takeaways?|takeouts?|uber eats|delivery|deliveries|pizzas?|burgers?)\b/.test(q)
  ) {
    return 'How much did I spend on takeaway in November?';
  }
  if (
    cats.includes('groceries') ||
    /\b(milk|eggs|bread|butter|avocados?|bananas?|apples?|cheese|grocer|groceries|supermarkets?|trader joe|sku|items?)\b/.test(
      q
    )
  ) {
    return "How much did I spend on groceries at Trader Joe's?";
  }
  if (
    cats.includes('savings') ||
    /\b(balance|net worth|credit score|left|saved|invest)\b/.test(q)
  ) {
    return 'How much did I put into savings in 2025?';
  }
  if (/\b(2020|2021|2022|2023|2024|2026|last year)\b/.test(q)) {
    return 'How much did I spend in total in 2025?';
  }
  return 'How much did I spend on eating out on weekends?';
}

/**
 * Inspect a natural-language question and/or partial DSL for dataset constraints
 * that cannot be answered from the 2025 bank CSV.
 */
export function checkQuestionAnswerability(
  question: string,
  dsl?: Partial<AskQueryDSL>,
  availableYears: readonly number[] = [2025]
): AnswerabilityCheck {
  const q = ` ${question.trim().toLowerCase()} `;
  const filters = dsl?.filters;

  // 1. Time-of-day filter in DSL or time-of-day phrasing in question
  const hasTimeFilter =
    (filters?.time_from !== undefined &&
      filters?.time_from !== null &&
      String(filters.time_from).trim() !== '') ||
    (filters?.time_to !== undefined &&
      filters?.time_to !== null &&
      String(filters.time_to).trim() !== '');

  const asksTimeOfDay =
    /\b(time of day|what time|which hour|by hour|hourly|at night|late night|late-night|in the morning|every morning|morning vs|in the afternoon|in the evening|before noon|after noon|after midnight|before midnight|at midnight|lunchtime|dinnertime|breakfast time|o'?clock)\b/i.test(
      q
    ) ||
    /\b(after|before|around|at|between|from|past|until|till)\s+\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/i.test(
      q
    ) ||
    /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/i.test(q);

  if (hasTimeFilter || asksTimeOfDay) {
    return {
      answerable: false,
      reason_if_not:
        'The bank CSV only records transaction dates (YYYY-MM-DD) without time-of-day timestamps, so spending cannot be filtered by hour or time of day.',
      suggested_question: dsl?.suggested_question ?? buildSuggestedQuestion(question, dsl),
    };
  }

  // 2. Year outside loaded dataset (only 2025 is in the active dataset by default)
  const yearSet = new Set(availableYears.map(String));
  const primaryYearStr = String(availableYears[0] ?? 2025);
  if (filters?.date_from && ISO_DATE_RE.test(filters.date_from)) {
    const y = filters.date_from.slice(0, 4);
    if (!yearSet.has(y)) {
      return {
        answerable: false,
        reason_if_not: `This dataset only covers ${availableYears.join(', ')} transactions (1 Jan – 31 Dec ${primaryYearStr}), so dates in ${y} cannot be queried here.`,
        suggested_question: dsl?.suggested_question ?? buildSuggestedQuestion(question, dsl),
      };
    }
  }
  if (filters?.date_to && ISO_DATE_RE.test(filters.date_to)) {
    const y = filters.date_to.slice(0, 4);
    if (!yearSet.has(y)) {
      return {
        answerable: false,
        reason_if_not: `This dataset only covers ${availableYears.join(', ')} transactions (1 Jan – 31 Dec ${primaryYearStr}), so dates in ${y} cannot be queried here.`,
        suggested_question: dsl?.suggested_question ?? buildSuggestedQuestion(question, dsl),
      };
    }
  }

  const mentionedYears = Array.from(q.matchAll(/\b(201\d|202\d)\b/g)).map((m) => m[1]!);
  const outOfRangeYear = mentionedYears.find((y) => !yearSet.has(y));
  if (outOfRangeYear || /\b(last year|previous year|prior year)\b/i.test(q)) {
    const labelYear = outOfRangeYear ?? 'previous years';
    const isSingleYear2025 = availableYears.length === 1 && yearSet.has('2025');
    return {
      answerable: false,
      reason_if_not: `This view only contains ${isSingleYear2025 ? "Sam's 2025" : availableYears.join(', ')} bank transactions (1 Jan – 31 Dec ${primaryYearStr}), so questions about ${labelYear} cannot be answered here.`,
      suggested_question:
        dsl?.suggested_question ?? `How much did I spend in total in ${primaryYearStr}?`,
    };
  }

  // 3. Itemized supermarket receipt / SKU-level breakdown
  const isHarvestCheeseMerchant = /\bharvest cheese\b/i.test(q);
  const asksItemizedSku =
    !isHarvestCheeseMerchant &&
    /\b(milk|eggs|bread|butter|avocados?|bananas?|apples?|toilet paper|toothpaste|shampoo|individual items|itemized|itemised|sku|receipt line items|what items did i buy)\b/i.test(
      q
    );
  if (asksItemizedSku) {
    return {
      answerable: false,
      reason_if_not:
        'Bank transactions only record the total paid to each merchant at checkout, not individual supermarket basket items or receipt SKUs.',
      suggested_question:
        dsl?.suggested_question ?? "How much did I spend on groceries at Trader Joe's?",
    };
  }

  // 4. Cash tips, wallet cash, credit score, or account balance / net worth
  const asksBalanceOrScore =
    /\b(cash tips?|cash in hand|wallet cash|physical cash|credit score|credit rating|net worth|bank balance|account balance|closing balance|opening balance|how much money do i have left)\b/i.test(
      q
    );
  if (asksBalanceOrScore) {
    return {
      answerable: false,
      reason_if_not:
        'The bank CSV only records transaction movements in and out, not running account balances, credit scores, net worth, or cash tips.',
      suggested_question: dsl?.suggested_question ?? 'How much did I put into savings in 2025?',
    };
  }

  // 5. Explicitly flagged unanswerable by upstream DSL
  if (dsl?.answerable === false) {
    return {
      answerable: false,
      reason_if_not:
        dsl.reason_if_not && dsl.reason_if_not.trim().length > 0
          ? dsl.reason_if_not.trim()
          : 'This question cannot be answered from the fields available in the bank transaction CSV.',
      suggested_question: dsl.suggested_question ?? buildSuggestedQuestion(question, dsl),
    };
  }

  return {
    answerable: true,
    reason_if_not: null,
    suggested_question: null,
  };
}

/**
 * Validate and normalize an arbitrary input into a strict `AskQueryDSL` object,
 * checking both schema validity and dataset answerability rules.
 */
export function validateAskQueryDSL(
  input: unknown,
  originalQuestion = '',
  transactions?: readonly Transaction[]
): ValidationResult {
  const errors: string[] = [];
  const defaults = createDefaultFilters();

  if (typeof input !== 'object' || input === null) {
    errors.push('Query DSL must be a non-null object.');
    const fallbackCheck = checkQuestionAnswerability(originalQuestion);
    return {
      valid: false,
      errors,
      query: {
        filters: defaults,
        measure: 'sum',
        group_by: 'none',
        interpretation: fallbackCheck.reason_if_not ?? 'Unable to parse query.',
        answerable: false,
        reason_if_not: fallbackCheck.reason_if_not ?? 'Invalid query structure.',
        suggested_question:
          fallbackCheck.suggested_question ?? 'How much did I spend on eating out on weekends?',
      },
    };
  }

  const raw = input as Record<string, unknown>;
  const rawFilters =
    typeof raw.filters === 'object' && raw.filters !== null
      ? (raw.filters as Record<string, unknown>)
      : {};

  if (typeof raw.filters !== 'object' || raw.filters === null) {
    errors.push('Missing or invalid `filters` object.');
  }

  // Normalize categories
  const categories: Category[] = [];
  if (Array.isArray(rawFilters.categories)) {
    for (const c of rawFilters.categories) {
      if (typeof c === 'string') {
        const lower = c.trim().toLowerCase();
        if (CATEGORY_SET.has(lower)) {
          categories.push(lower as Category);
        } else {
          errors.push(`Unknown category "${c}".`);
        }
      } else {
        errors.push('Category filter entry must be a string.');
      }
    }
  } else if (rawFilters.categories !== undefined) {
    errors.push('`filters.categories` must be an array.');
  }

  // Normalize merchants
  const merchants: string[] = [];
  if (Array.isArray(rawFilters.merchants)) {
    for (const m of rawFilters.merchants) {
      if (typeof m === 'string' && m.trim().length > 0) {
        merchants.push(m.trim());
      }
    }
  } else if (rawFilters.merchants !== undefined) {
    errors.push('`filters.merchants` must be an array.');
  }

  // Normalize date_from and date_to
  let date_from: string | null = null;
  if (rawFilters.date_from !== null && rawFilters.date_from !== undefined) {
    if (typeof rawFilters.date_from === 'string' && ISO_DATE_RE.test(rawFilters.date_from.trim())) {
      date_from = rawFilters.date_from.trim();
    } else {
      errors.push('`filters.date_from` must be YYYY-MM-DD or null.');
    }
  }

  let date_to: string | null = null;
  if (rawFilters.date_to !== null && rawFilters.date_to !== undefined) {
    if (typeof rawFilters.date_to === 'string' && ISO_DATE_RE.test(rawFilters.date_to.trim())) {
      date_to = rawFilters.date_to.trim();
    } else {
      errors.push('`filters.date_to` must be YYYY-MM-DD or null.');
    }
  }

  if (date_from && date_to && date_from > date_to) {
    const tmp = date_from;
    date_from = date_to;
    date_to = tmp;
  }

  // Normalize weekdays (0 = Monday .. 6 = Sunday)
  const weekdays: number[] = [];
  if (Array.isArray(rawFilters.weekdays)) {
    for (const w of rawFilters.weekdays) {
      const n = Number(w);
      if (Number.isInteger(n) && n >= 0 && n <= 6) {
        if (!weekdays.includes(n)) {
          weekdays.push(n);
        }
      } else {
        errors.push(`Invalid weekday index "${String(w)}" (expected integer 0..6).`);
      }
    }
  } else if (rawFilters.weekdays !== undefined) {
    errors.push('`filters.weekdays` must be an array of integers 0..6.');
  }

  // Normalize time_from and time_to
  const time_from =
    typeof rawFilters.time_from === 'string' && rawFilters.time_from.trim().length > 0
      ? rawFilters.time_from.trim()
      : null;
  const time_to =
    typeof rawFilters.time_to === 'string' && rawFilters.time_to.trim().length > 0
      ? rawFilters.time_to.trim()
      : null;

  // Normalize amount_min and amount_max
  let amount_min: number | null = null;
  if (rawFilters.amount_min !== null && rawFilters.amount_min !== undefined) {
    const n = Number(rawFilters.amount_min);
    if (Number.isFinite(n) && n >= 0) {
      amount_min = Math.round(n);
    } else {
      errors.push('`filters.amount_min` must be a non-negative integer (cents) or null.');
    }
  }

  let amount_max: number | null = null;
  if (rawFilters.amount_max !== null && rawFilters.amount_max !== undefined) {
    const n = Number(rawFilters.amount_max);
    if (Number.isFinite(n) && n >= 0) {
      amount_max = Math.round(n);
    } else {
      errors.push('`filters.amount_max` must be a non-negative integer (cents) or null.');
    }
  }

  // Normalize direction
  let direction: Direction = 'out';
  if (rawFilters.direction === 'in' || rawFilters.direction === 'out') {
    direction = rawFilters.direction;
  } else if (rawFilters.direction !== undefined) {
    errors.push('`filters.direction` must be "out" or "in".');
  }
  if (categories.includes('income') && rawFilters.direction === undefined) {
    direction = 'in';
  }

  // Normalize measure
  let measure: QueryMeasure = 'sum';
  if (
    typeof raw.measure === 'string' &&
    (VALID_MEASURES as readonly string[]).includes(raw.measure)
  ) {
    measure = raw.measure as QueryMeasure;
  } else {
    errors.push(
      `Invalid measure "${String(raw.measure)}". Expected one of: ${VALID_MEASURES.join(', ')}.`
    );
  }

  // Normalize group_by
  let group_by: QueryGroupBy = 'none';
  if (
    typeof raw.group_by === 'string' &&
    (VALID_GROUP_BYS as readonly string[]).includes(raw.group_by)
  ) {
    group_by = raw.group_by as QueryGroupBy;
  } else if (raw.group_by !== undefined) {
    errors.push(
      `Invalid group_by "${String(raw.group_by)}". Expected one of: ${VALID_GROUP_BYS.join(', ')}.`
    );
  }

  // Normalize interpretation
  const interpretation =
    typeof raw.interpretation === 'string' && raw.interpretation.trim().length > 0
      ? raw.interpretation.trim()
      : 'All matching transactions in 2025';

  // Determine available years from dataset if passed
  const availableYears =
    transactions && transactions.length > 0
      ? Array.from(
          new Set(
            transactions.map((t) => Number(t.date.slice(0, 4))).filter((n) => Number.isFinite(n))
          )
        )
      : [2025];

  const partialDsl: AskQueryDSL = {
    filters: {
      categories,
      merchants,
      date_from,
      date_to,
      weekdays,
      time_from,
      time_to,
      amount_min,
      amount_max,
      direction,
    },
    measure,
    group_by,
    interpretation,
    answerable: typeof raw.answerable === 'boolean' ? raw.answerable : true,
    reason_if_not:
      typeof raw.reason_if_not === 'string' && raw.reason_if_not.trim().length > 0
        ? raw.reason_if_not.trim()
        : null,
    suggested_question:
      typeof raw.suggested_question === 'string' && raw.suggested_question.trim().length > 0
        ? raw.suggested_question.trim()
        : null,
  };

  const answerability = checkQuestionAnswerability(originalQuestion, partialDsl, availableYears);

  const normalizedQuery: AskQueryDSL = {
    ...partialDsl,
    answerable: answerability.answerable,
    reason_if_not: answerability.reason_if_not,
    suggested_question: answerability.suggested_question,
    interpretation: answerability.answerable
      ? partialDsl.interpretation
      : (answerability.reason_if_not ?? partialDsl.interpretation),
  };

  return {
    valid: errors.length === 0,
    errors,
    query: normalizedQuery,
  };
}
