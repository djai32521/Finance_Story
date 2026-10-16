import { describe, expect, it } from 'vitest';
import { formatMoneyMinor, type Transaction } from '../contracts/data.js';
import { buildMockDataset } from '../data/mock/index.js';
import { loadServerConfig } from '../server/config.js';
import { translateQuestionToDSL } from '../server/gemini.js';
import { createAskHttpServer, loadRealOrFallbackTransactions } from '../server/index.js';
import {
  answerQuestionDeterministically,
  BUILDER_CATEGORIES,
  BUILDER_MERCHANTS,
  buildQueryFromSelection,
  buildSuggestedQuestion,
  checkQuestionAnswerability,
  createDefaultFilters,
  executeAskQuery,
  getIsoWeekday,
  matchesMerchantFilter,
  parseQuestionToDSL,
  PRESET_QUESTIONS,
  sanitizeMerchantDisplay,
  validateAskQueryDSL,
} from '../src/ask/index.js';

const realTransactions: readonly Transaction[] = loadRealOrFallbackTransactions();
const mockTransactions: readonly Transaction[] = buildMockDataset().transactions;

/**
 * Privacy assertion helper: ensures no raw bank account numbers, card suffixes,
 * or unmasked personal names leak into `receipts[].merchant`.
 */
function assertPrivacySafeReceipts(receipts: readonly Transaction[]): void {
  for (const r of receipts) {
    expect(r.merchant.length).toBeGreaterThan(0);
    // No bank account numbers like US-ACCT-1001 or 02-0155-0842911-00
    expect(r.merchant).not.toMatch(/\bUS-ACCT-\d+\b/i);
    expect(r.merchant).not.toMatch(/\b\d{2}-\d{4}-\s*\d{7}-\d{2}\b/);
    expect(r.merchant).not.toMatch(/\bFC\d{2}-\d{4}/i);
    // No raw CARD 4821 suffixes
    expect(r.merchant).not.toMatch(/\bCARD\s+\d{4}\b/i);
    // No unmasked personal names
    expect(r.merchant).not.toMatch(/\b(Sam\s+MERCER|sammercer|Max\s*Vance|LEE\s+R)\b/i);
  }
}

describe('Ask Your Year — Real 2025 Dataset Verification (30+ diverse questions)', () => {
  it('loads the real 2025 transaction dataset with 1,000 rows', () => {
    expect(realTransactions.length).toBe(1000);
  });

  describe('1. Merchant visit counts & total spend against real data/transactions.json', () => {
    it('Case 1: "How many times did I visit Blue Bottle Coffee?" -> 72 visits', () => {
      const res = answerQuestionDeterministically(
        'How many times did I visit Blue Bottle Coffee?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('count');
      expect(res.query.filters.merchants).toContain('Blue Bottle Coffee');
      expect(res.value_minor).toBe(72);
      expect(res.formatted_answer).toBe('72');
      expect(res.unit_label).toBe('visits');
      expect(res.matching_txn_ids).toHaveLength(72);
      expect(res.receipts).toHaveLength(72);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 2: "How much did I spend at Blue Bottle Coffee?" -> $572.80 across 72 visits', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend at Blue Bottle Coffee?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('sum');
      expect(res.value_minor).toBe(57280);
      expect(res.formatted_answer).toBe('$572.80');
      expect(res.matching_txn_ids).toHaveLength(72);
      expect(res.receipts).toHaveLength(72);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 3: "How many times did I visit Sightglass Coffee?" -> 41 visits', () => {
      const res = answerQuestionDeterministically(
        'How many times did I visit Sightglass Coffee?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('count');
      expect(res.query.filters.merchants).toContain('Sightglass Coffee');
      expect(res.value_minor).toBe(41);
      expect(res.formatted_answer).toBe('41');
      expect(res.matching_txn_ids).toHaveLength(41);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 4: "How much did I spend at Sightglass Coffee?" -> $634.27 across 41 visits', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend at Sightglass Coffee?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('sum');
      expect(res.value_minor).toBe(63427);
      expect(res.formatted_answer).toBe('$634.27');
      expect(res.matching_txn_ids).toHaveLength(41);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 5: "How much did I spend at Monarch Acoustic?" -> $11,596.87 across 2 payments', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend at Monarch Acoustic?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.merchants).toContain('Monarch Acoustic');
      expect(res.value_minor).toBe(1159687);
      expect(res.formatted_answer).toBe('$11,596.87');
      expect(res.matching_txn_ids).toHaveLength(2);
      expect(res.receipts).toHaveLength(2);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 6: "How much did I spend at Trader Joe\'s?" -> $1,517.22 across 27 purchases', () => {
      const res = answerQuestionDeterministically(
        "How much did I spend at Trader Joe's?",
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.merchants).toContain("Trader Joe's");
      expect(res.value_minor).toBe(151722);
      expect(res.formatted_answer).toBe('$1,517.22');
      expect(res.matching_txn_ids).toHaveLength(27);
      expect(res.receipts.every((r) => r.merchant === "Trader Joe's")).toBe(true);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 7: "How much did I spend at Uber Eats?" -> $532.94 across 9 orders', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend at Uber Eats?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.merchants).toContain('Uber Eats');
      expect(res.value_minor).toBe(53294);
      expect(res.formatted_answer).toBe('$532.94');
      expect(res.matching_txn_ids).toHaveLength(9);
      expect(res.receipts.every((r) => r.merchant === 'Uber Eats')).toBe(true);
      assertPrivacySafeReceipts(res.receipts);
    });
  });

  describe('2. Category totals & counts against real data/transactions.json', () => {
    it('Case 8: "How much did I spend on coffee in 2025?" -> $2,264.88 (163 visits)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on coffee in 2025?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['coffee']);
      expect(res.value_minor).toBe(226488);
      expect(res.formatted_answer).toBe('$2,264.88');
      expect(res.matching_txn_ids).toHaveLength(163);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 9: "How much did I spend on groceries?" -> $2,415.82 (64 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on groceries?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['groceries']);
      expect(res.value_minor).toBe(241582);
      expect(res.formatted_answer).toBe('$2,415.82');
      expect(res.matching_txn_ids).toHaveLength(64);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 10: "How much did I spend on eating out?" -> $6,802.34 (137 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on eating out?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['eating out']);
      expect(res.value_minor).toBe(680234);
      expect(res.formatted_answer).toBe('$6,802.34');
      expect(res.matching_txn_ids).toHaveLength(137);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 11: "How much did I spend on takeaway?" -> $1,167.05 (38 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on takeaway?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['takeaway']);
      expect(res.value_minor).toBe(116705);
      expect(res.formatted_answer).toBe('$1,167.05');
      expect(res.matching_txn_ids).toHaveLength(38);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 12: "How much did I spend on travel?" -> $5,749.04 (16 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on travel?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['travel']);
      expect(res.value_minor).toBe(574904);
      expect(res.formatted_answer).toBe('$5,749.04');
      expect(res.matching_txn_ids).toHaveLength(16);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 13: "How much did I spend on transport?" -> $4,162.71 (85 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on transport?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['transport']);
      expect(res.value_minor).toBe(416271);
      expect(res.formatted_answer).toBe('$4,162.71');
      expect(res.matching_txn_ids).toHaveLength(85);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 14: "How much did I spend on bills?" -> $4,212.98 (37 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on bills?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['bills']);
      expect(res.value_minor).toBe(421298);
      expect(res.formatted_answer).toBe('$4,212.98');
      expect(res.matching_txn_ids).toHaveLength(37);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 15: "How much did I spend on subscriptions?" -> $2,099.59 (71 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on subscriptions?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['subscriptions']);
      expect(res.value_minor).toBe(209959);
      expect(res.formatted_answer).toBe('$2,099.59');
      expect(res.matching_txn_ids).toHaveLength(71);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 16: "How much did I spend on health?" -> $1,091.19 (12 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on health?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['health']);
      expect(res.value_minor).toBe(109119);
      expect(res.formatted_answer).toBe('$1,091.19');
      expect(res.matching_txn_ids).toHaveLength(12);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 17: "How much did I spend on gifts?" -> $1,370.50 (11 purchases)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on gifts?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['gifts']);
      expect(res.value_minor).toBe(137050);
      expect(res.formatted_answer).toBe('$1,370.50');
      expect(res.matching_txn_ids).toHaveLength(11);
      assertPrivacySafeReceipts(res.receipts);
    });
  });

  describe('3. Date & weekday filters', () => {
    it('Case 18: "How much did I spend on eating out on weekends?" filters to Sat/Sun (weekdays [5, 6])', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on eating out on weekends?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['eating out']);
      expect(res.query.filters.weekdays).toEqual([5, 6]);
      expect(res.value_minor).toBeGreaterThan(0);
      expect(res.receipts.length).toBeGreaterThan(0);
      for (const r of res.receipts) {
        const wk = getIsoWeekday(r.date);
        expect([5, 6]).toContain(wk);
      }
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 19: "How much did I spend on coffee in October?" filters to 2025-10-01..2025-10-31', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on coffee in October?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['coffee']);
      expect(res.query.filters.date_from).toBe('2025-10-01');
      expect(res.query.filters.date_to).toBe('2025-10-31');
      expect(res.value_minor).toBeGreaterThan(0);
      expect(res.receipts.every((r) => r.date.startsWith('2025-10-'))).toBe(true);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 20: "How much did I spend on shopping in August?" filters to August 2025 shopping', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on shopping in August?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.categories).toEqual(['shopping']);
      expect(res.query.filters.date_from).toBe('2025-08-01');
      expect(res.query.filters.date_to).toBe('2025-08-31');
      // August includes the Monarch Acoustic $9,061.87 payment
      expect(res.value_minor).toBeGreaterThan(906187);
      expect(res.receipts.every((r) => r.date.startsWith('2025-08-'))).toBe(true);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 21: "How much did I spend in January?" filters to 2025-01-01..2025-01-31', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend in January?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.date_from).toBe('2025-01-01');
      expect(res.query.filters.date_to).toBe('2025-01-31');
      expect(res.value_minor).toBeGreaterThan(0);
      expect(res.receipts.every((r) => r.date.startsWith('2025-01-'))).toBe(true);
      assertPrivacySafeReceipts(res.receipts);
    });
  });

  describe('4. Measures (average, max, min, list) & Group-By (month, weekday, category, merchant)', () => {
    it('Case 22: "What was my biggest single purchase?" -> Monarch Acoustic ($9,061.87 on 2025-08-11)', () => {
      const res = answerQuestionDeterministically(
        'What was my biggest single purchase?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('max');
      expect(res.value_minor).toBe(906187);
      expect(res.formatted_answer).toBe('$9,061.87');
      expect(res.receipts[0]?.merchant).toBe('Monarch Acoustic');
      expect(res.receipts[0]?.date).toBe('2025-08-11');
      expect(res.interpretation).toContain('Monarch Acoustic');
      expect(res.interpretation).toContain('2025-08-11');
      expect(res.matching_dates).toEqual(['2025-08-11']);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 23: "What was my average coffee spend?" -> $13.89 (Math.round(226488 / 163) = 1389 minor units)', () => {
      const res = answerQuestionDeterministically(
        'What was my average coffee spend?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('average');
      expect(res.query.filters.categories).toEqual(['coffee']);
      expect(res.value_minor).toBe(Math.round(226488 / 163));
      expect(res.value_minor).toBe(1389);
      expect(res.formatted_answer).toBe('$13.89');
      expect(res.matching_txn_ids).toHaveLength(163);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 24: "Show my spending by month" -> group_by: "month" with 12 monthly buckets', () => {
      const res = answerQuestionDeterministically('Show my spending by month', realTransactions);
      expect(res.answerable).toBe(true);
      expect(res.query.group_by).toBe('month');
      expect(res.breakdown).toHaveLength(12);
      expect(res.breakdown[0]?.key).toBe('2025-01');
      expect(res.breakdown[11]?.key).toBe('2025-12');
      const sumOfMonths = res.breakdown.reduce((acc, b) => acc + b.value_minor, 0);
      expect(sumOfMonths).toBe(res.value_minor);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 25: "Show my spending by category" -> group_by: "category" sorted descending', () => {
      const res = answerQuestionDeterministically('Show my spending by category', realTransactions);
      expect(res.answerable).toBe(true);
      expect(res.query.group_by).toBe('category');
      expect(res.breakdown.length).toBeGreaterThanOrEqual(12);
      // Sorted descending by value_minor
      for (let i = 1; i < res.breakdown.length; i++) {
        expect(res.breakdown[i - 1]!.value_minor).toBeGreaterThanOrEqual(
          res.breakdown[i]!.value_minor
        );
      }
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 26: "Show my spending by weekday" -> group_by: "weekday" with 7 Mon..Sun buckets', () => {
      const res = answerQuestionDeterministically('Show my spending by weekday', realTransactions);
      expect(res.answerable).toBe(true);
      expect(res.query.group_by).toBe('weekday');
      expect(res.breakdown).toHaveLength(7);
      expect(res.breakdown.map((b) => b.label)).toEqual([
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
        'Sun',
      ]);
      const sumOfWeekdays = res.breakdown.reduce((acc, b) => acc + b.value_minor, 0);
      expect(sumOfWeekdays).toBe(res.value_minor);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 27: "What are my top merchants?" -> group_by: "merchant" sorted descending', () => {
      const res = answerQuestionDeterministically('What are my top merchants?', realTransactions);
      expect(res.answerable).toBe(true);
      expect(res.query.group_by).toBe('merchant');
      expect(res.breakdown.length).toBeGreaterThan(20);
      expect(res.breakdown[0]!.value_minor).toBeGreaterThanOrEqual(res.breakdown[1]!.value_minor);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 28: "How much salary income did I earn?" -> direction: "in", categories: ["income"]', () => {
      const res = answerQuestionDeterministically(
        'How much salary income did I earn?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.filters.direction).toBe('in');
      expect(res.query.filters.categories).toContain('income');
      expect(res.value_minor).toBe(8176246);
      expect(res.formatted_answer).toBe('$81,762.46');
      expect(res.matching_txn_ids).toHaveLength(25);
      assertPrivacySafeReceipts(res.receipts);

      // Also check Pacific Studio Labs specifically (12 uniform monthly salary paydays = $81,000.00)
      const salaryRes = answerQuestionDeterministically(
        'How much did I earn from Pacific Studio Labs?',
        realTransactions
      );
      expect(salaryRes.answerable).toBe(true);
      expect(salaryRes.query.filters.direction).toBe('in');
      expect(salaryRes.value_minor).toBe(8100000);
      expect(salaryRes.formatted_answer).toBe('$81,000');
      expect(salaryRes.matching_txn_ids).toHaveLength(12);
    });

    it('Case 29: "What was my smallest coffee purchase?" -> measure: "min"', () => {
      const res = answerQuestionDeterministically(
        'What was my smallest coffee purchase?',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('min');
      expect(res.query.filters.categories).toEqual(['coffee']);
      expect(res.value_minor).toBeGreaterThan(0);
      expect(res.receipts[0]?.amount_minor).toBe(res.value_minor);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('Case 30: "List all my travel purchases over $100" -> measure: "list" with amount_min: 10000', () => {
      const res = answerQuestionDeterministically(
        'List all my travel purchases over $100',
        realTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.query.measure).toBe('list');
      expect(res.query.filters.categories).toEqual(['travel']);
      expect(res.query.filters.amount_min).toBe(10000);
      expect(res.receipts.every((r) => r.amount_minor >= 10000)).toBe(true);
      assertPrivacySafeReceipts(res.receipts);
    });
  });

  describe('5. Unanswerable questions (graceful rejection with reason & suggested_question)', () => {
    it('Case 31: "How much did I spend on coffee after 2pm?" -> answerable: false (no time-of-day timestamps)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on coffee after 2pm?',
        realTransactions
      );
      expect(res.answerable).toBe(false);
      expect(res.formatted_answer).toBe('Can’t tell');
      expect(res.reason_if_not).toBeTruthy();
      expect(res.reason_if_not?.toLowerCase()).toMatch(/time|date|hour/);
      expect(res.suggested_question).toBeTruthy();
      expect(res.matching_txn_ids).toEqual([]);
      expect(res.receipts).toEqual([]);
    });

    it('Case 32: "What time of day do I usually buy takeaway?" -> answerable: false', () => {
      const res = answerQuestionDeterministically(
        'What time of day do I usually buy takeaway?',
        realTransactions
      );
      expect(res.answerable).toBe(false);
      expect(res.reason_if_not).toBeTruthy();
      expect(res.suggested_question).toBe('How much did I spend on takeaway in November?');
    });

    it('Case 33: "How much did I spend late at night?" -> answerable: false', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend late at night?',
        realTransactions
      );
      expect(res.answerable).toBe(false);
      expect(res.reason_if_not).toBeTruthy();
      expect(res.suggested_question).toBeTruthy();
    });

    it('Case 34: "How much did I spend in 2023?" -> answerable: false (out-of-range year)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend in 2023?',
        realTransactions
      );
      expect(res.answerable).toBe(false);
      expect(res.reason_if_not).toContain('2025');
      expect(res.reason_if_not).toContain('2023');
      expect(res.suggested_question).toBe('How much did I spend in total in 2025?');
    });

    it('Case 35: "How much did I spend on avocados at the supermarket?" -> answerable: false (item-level SKU)', () => {
      const res = answerQuestionDeterministically(
        'How much did I spend on avocados at the supermarket?',
        realTransactions
      );
      expect(res.answerable).toBe(false);
      expect(res.reason_if_not?.toLowerCase()).toMatch(/merchant|checkout|item|sku/);
      expect(res.suggested_question).toBe("How much did I spend on groceries at Trader Joe's?");
    });

    it('Case 36: "What is my credit score and closing bank balance?" -> answerable: false', () => {
      const res = answerQuestionDeterministically(
        'What is my credit score and closing bank balance?',
        realTransactions
      );
      expect(res.answerable).toBe(false);
      expect(res.reason_if_not?.toLowerCase()).toMatch(/balance|credit score/);
      expect(res.suggested_question).toBe('How much did I put into savings in 2025?');
    });
  });

  describe('6. Validator, Structured Builder, Mock Dataset & Server Verification', () => {
    it('validates and normalizes arbitrary AskQueryDSL objects and swaps reversed date ranges', () => {
      const parsed = parseQuestionToDSL('How much did I spend on coffee in Q3?');
      expect(parsed.filters.date_from).toBe('2025-07-01');
      expect(parsed.filters.date_to).toBe('2025-09-30');

      const v = validateAskQueryDSL(
        {
          filters: {
            categories: ['COFFEE', 'unknown_cat'],
            merchants: [' Blue Bottle Coffee '],
            date_from: '2025-11-30',
            date_to: '2025-11-01',
            weekdays: [5, 6, 99],
            amount_min: 500,
            direction: 'out',
          },
          measure: 'sum',
          group_by: 'month',
          interpretation: 'November weekend coffee',
          answerable: true,
          reason_if_not: null,
        },
        'How much did I spend on coffee in November?'
      );
      expect(v.valid).toBe(false);
      expect(v.errors.length).toBeGreaterThanOrEqual(2);
      expect(v.query.filters.categories).toEqual(['coffee']);
      expect(v.query.filters.date_from).toBe('2025-11-01');
      expect(v.query.filters.date_to).toBe('2025-11-30');
      expect(v.query.filters.weekdays).toEqual([5, 6]);
    });

    it('builds valid queries from the structured no-key fallback chip builder', () => {
      expect(PRESET_QUESTIONS.length).toBeGreaterThanOrEqual(5);
      expect(BUILDER_CATEGORIES.length).toBeGreaterThanOrEqual(10);
      expect(BUILDER_MERCHANTS.length).toBeGreaterThanOrEqual(8);

      const built = buildQueryFromSelection({
        category: 'takeaway',
        month: 10, // November (0-indexed)
        weekdayMode: 'all',
        measure: 'sum',
        group_by: 'none',
      });
      expect(built.question).toBe('How much did I spend on takeaway in November?');
      const res = executeAskQuery(built.query, realTransactions, {
        question: built.question,
        source: 'builder',
      });
      expect(res.answerable).toBe(true);
      expect(res.source).toBe('builder');
      expect(res.value_minor).toBeGreaterThan(0);
      assertPrivacySafeReceipts(res.receipts);
    });

    it('executes queries cleanly against the mock dataset as well', () => {
      const res = answerQuestionDeterministically(
        'How many times did I visit Blue Bottle Coffee?',
        mockTransactions
      );
      expect(res.answerable).toBe(true);
      expect(res.value_minor).toBe(69);
      expect(res.formatted_answer).toBe('69');
      assertPrivacySafeReceipts(res.receipts);
    });

    it('sanitizes any raw account numbers, card numbers, or personal names in merchant strings', () => {
      const dirty = 'PAYMENT RECEIVED US-ACCT-1001 CARD 4821 Sam MERCER Max Vance';
      const cleaned = sanitizeMerchantDisplay(dirty);
      expect(cleaned).not.toContain('US-ACCT-1001');
      expect(cleaned).not.toContain('4821');
      expect(cleaned).not.toContain('Sam MERCER');
      expect(cleaned).not.toContain('Max Vance');
    });

    it('handles helper functions (createDefaultFilters, buildSuggestedQuestion, matchesMerchantFilter, formatMoneyMinor)', () => {
      const def = createDefaultFilters();
      expect(def.direction).toBe('out');
      expect(buildSuggestedQuestion('How much did I spend on lattes at 8am?')).toContain('coffee');
      expect(checkQuestionAnswerability('How much did I spend after 10pm?').answerable).toBe(false);
      expect(formatMoneyMinor(1159687)).toBe('$11,596.87');
      expect(matchesMerchantFilter(realTransactions[0]!, realTransactions[0]!.merchant)).toBe(true);
    });

    it('translates questions deterministically when no API key is configured', async () => {
      const cfg = {
        ...loadServerConfig(),
        apiKey: null,
        hasApiKey: false,
      };
      const translated = await translateQuestionToDSL(
        'How much did I spend on coffee in 2025?',
        cfg
      );
      expect(translated.source).toBe('deterministic');
      expect(translated.query.filters.categories).toEqual(['coffee']);
    });

    it('serves /api/health and /api/ask (GET and POST) over HTTP with real transaction answers', async () => {
      const cfg = {
        ...loadServerConfig(),
        apiKey: null,
        hasApiKey: false,
      };
      const server = createAskHttpServer({
        transactions: realTransactions,
        config: cfg,
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. GET /api/health
        const healthRes = await fetch(`${baseUrl}/api/health`);
        expect(healthRes.status).toBe(200);
        const healthJson = (await healthRes.json()) as {
          ok: boolean;
          transactionCount: number;
        };
        expect(healthJson.ok).toBe(true);
        expect(healthJson.transactionCount).toBe(1000);

        // 2. GET /api/ask?q=...
        const getAskRes = await fetch(
          `${baseUrl}/api/ask?q=${encodeURIComponent('How many times did I visit Blue Bottle Coffee?')}`
        );
        expect(getAskRes.status).toBe(200);
        const getAskJson = (await getAskRes.json()) as {
          answerable: boolean;
          value_minor: number;
          formatted_answer: string;
        };
        expect(getAskJson.answerable).toBe(true);
        expect(getAskJson.value_minor).toBe(72);
        expect(getAskJson.formatted_answer).toBe('72');

        // 3. POST /api/ask with question
        const postAskRes = await fetch(`${baseUrl}/api/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 'How much did I spend on coffee after 2pm?',
          }),
        });
        expect(postAskRes.status).toBe(200);
        const postAskJson = (await postAskRes.json()) as {
          answerable: boolean;
          reason_if_not: string | null;
          suggested_question: string | null;
        };
        expect(postAskJson.answerable).toBe(false);
        expect(postAskJson.reason_if_not).toBeTruthy();
        expect(postAskJson.suggested_question).toBeTruthy();

        // 4. GET / with Cloud Run IAP cross-site redirect headers -> 200 OK
        const iapNavRes = await fetch(`${baseUrl}/`, {
          headers: {
            Host: 'demo-spend-20833501260.us-central1.run.app',
            Referer: 'https://accounts.google.com/',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': 'navigate',
          },
        });
        expect(iapNavRes.status).toBe(200);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        );
      }
    });
  });
});
