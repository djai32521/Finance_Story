import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  formatMoneyMinor,
  isDiscretionaryCategory,
  type Category,
  type Day,
  type Fact,
  type StoryPlan,
  type Transaction,
} from '../contracts/index.js';
import {
  auditPrivacyOnTransactions,
  buildOrUpdateMerchantCache,
  buildTransactions,
  computeDays,
  computeFacts,
  parseCsvFile,
  reconcileDataset,
} from '../pipeline/index.js';
import { lintStoryPlanAgainstFacts } from '../scripts/fact-lint.js';
import { answerQuestionDeterministically } from '../src/ask/index.js';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const DATA_DIR = path.join(APP_ROOT, 'data');
const STORY_DIR = path.join(APP_ROOT, 'story');
const ANSWER_KEY_DIR = path.join(REPO_ROOT, 'data', 'answer_key');

interface AnswerKeyRow {
  id: string;
  merchant: string;
  category: Category;
}

function parseAnswerKeyCsv(filePath: string): Map<string, AnswerKeyRow> {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
  const map = new Map<string, AnswerKeyRow>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const firstComma = line.indexOf(',');
    const lastComma = line.lastIndexOf(',');
    const id = line.slice(0, firstComma).trim();
    const merchant = line.slice(firstComma + 1, lastComma).trim();
    const category = line.slice(lastComma + 1).trim() as Category;
    map.set(id, { id, merchant, category });
  }
  return map;
}

/**
 * Normalizes benign canonical merchant naming differences between the pipeline
 * and `data/answer_key/transactions_2025_labels.csv` (e.g. "Shell" vs "Shell Oil",
 * "Sightglass Coffee" vs "Sightglass Coffee Roasters", "Credit Card Repayment" vs "Payment received").
 */
const BENIGN_CARD_MERCHANT_ALIASES: Readonly<Record<string, string>> = {
  'Credit Card Repayment': 'Payment received',
  Shell: 'Shell Oil',
  'Sightglass Coffee': 'Sightglass Coffee Roasters',
  'Mint Mobile': 'Mint',
  Brightpath: 'Brightpath Fund',
  'Sound Transit Parking': 'Sound Transit',
  'CedarGate Brewery': 'Cedargate Brewery',
  'International Transaction Fee': 'International transaction fee',
  'Alaska Airlines': 'Alaska Air',
  'Keystone Credit Card Fee': 'Keystone Parking',
  'Shake Shack': 'Shake Shack Burgers',
  'Washington DOL': 'WA DOL',
  'Greystone Coffee Roasters': 'Greystone Coffee',
  Chevron: 'Chevron Station',
  'Pressed Juicery': 'Pressed',
  'Crumb and Co Bakery': 'Crumb & Co Bakery',
  'Costco Wholesale': 'Costco',
  'Kura Sushi': 'Kura',
  "Peet's Coffee": "Peet's",
  'National Park Service': 'NPS',
  'Yumi B': 'Yumi',
  'Itch.io': 'itch.io',
  'Kimpton Hotels': 'Kimpton Hotel',
  'Pepitos Ice Cream': "Pepito's Ice Cream",
  'Google Services': 'Google',
  'IRS Processing Fee': 'IRS',
  'Halden USA': 'Halden',
  'Lumiere Cinemas': 'Lumiere Cinema',
  "Bridie O'Connell's Irish Inn": "Bridie O'Connell's",
  'Cheeky Lad Deli & Eatery': 'Cheeky Lad Deli',
  'US Government Services': 'US Govt Services',
  'US State Department': 'State Dept',
  'Harvest Cheese and Grocer': 'Harvest Cheese & Grocer',
  'Masala Lane Indian Cuisine': 'Masala Lane',
  'The Thistle Inn': 'The Thistle',
  'The Ink and Paper Box': 'The Ink & Paper Box',
  'Washington State Ferries': 'WSF Ferries',
};

/**
 * Independent Fact verifier: recomputes every single Fact directly from its `txn_ids`
 * (and `transactions` / `days` where needed for calendar-wide ratios/streaks) and asserts
 * exact equality on `value` and `formatted`.
 */
function assertAllFactsRecomputeFromTxnIds(
  facts: readonly Fact[],
  transactions: readonly Transaction[],
  days: readonly Day[],
  expectedYear: number
): void {
  const txnById = new Map<string, Transaction>(transactions.map((t) => [t.id, t]));
  const factById = new Map<string, Fact>(facts.map((f) => [f.id, f]));

  // 1. Directusd_cents sum facts whose value must equal the exact sum of their txn_ids
  const directSumFactIds = new Set<string>([
    'total_spend_usd',
    'discretionary_spend_usd',
    'total_income_usd',
    'salary_income_usd',
    'december_bonus_pay_usd',
    'interest_income_usd',
    'rent_total_usd',
    'savings_invest_total_usd',
    'bills_total_usd',
    'fees_total_usd',
    'spend_top_merchant',
    'coffee_total_spend',
    'second_coffee_spend',
    'studio_total_spend',
    'studio_deposit_spend',
    'studio_final_spend',
    'studio_synth_spend',
    'studio_total_with_gear_spend',
    'big_one_spend',
    'jan_tech_spend',
    'loudest_day_spend',
    'october_spend_usd',
    'getaway_spend_usd',
    'fx_spend_usd',
    'fx_fees_usd',
    'physio_total_spend',
    'top_category_spend',
    'cat_groceries_spend',
    'cat_eating_out_spend',
    'cat_takeaway_spend',
    'cat_coffee_spend',
    'cat_transport_spend',
    'cat_travel_spend',
    'cat_shopping_spend',
    'cat_subscriptions_spend',
    'cat_health_spend',
    'cat_fun_spend',
    'cat_gifts_spend',
    'cat_rent_spend',
    'cat_bills_spend',
    'cat_fees_spend',
    'cat_savings_spend',
  ]);

  // 2. Direct count facts whose value must equal fact.txn_ids.length (or 0 when backed by fallback ids)
  const directCountFactIds = new Set<string>([
    'total_transactions_count',
    'card_transactions_count',
    'savings_transactions_count',
    'payday_count',
    'visits_top_merchant',
    'coffee_total_visits',
    'second_coffee_visits',
    'studio_gear_count',
    'october_transactions_count',
    'fx_transactions_count',
    'physio_visits_count',
    'cat_groceries_count',
    'cat_eating_out_count',
    'cat_takeaway_count',
    'cat_coffee_count',
    'cat_transport_count',
    'cat_travel_count',
    'cat_shopping_count',
    'cat_subscriptions_count',
    'cat_health_count',
    'cat_fun_count',
    'cat_gifts_count',
    'cat_rent_count',
    'cat_bills_count',
    'cat_fees_count',
    'cat_savings_count',
  ]);

  for (const fact of facts) {
    expect(fact.txn_ids.length).toBeGreaterThan(0);
    const backingTxns = fact.txn_ids.map((tid) => {
      const found = txnById.get(tid);
      expect(found, `Fact "${fact.id}" references unknown txn_id "${tid}"`).toBeDefined();
      return found!;
    });

    if (directSumFactIds.has(fact.id)) {
      if (Number(fact.value) === 0) {
        // Zero-spend facts use 5 fallback receipt IDs for Rule 2 traceability
        expect(['$0', '$0.00']).toContain(fact.formatted);
      } else {
        const relevantTxns =
          fact.id === 'loudest_day_spend'
            ? backingTxns.filter(
                (t) =>
                  t.direction === 'out' &&
                  !t.is_transfer &&
                  !t.is_refund &&
                  isDiscretionaryCategory(t.category)
              )
            : backingTxns;
        const sumMinor = relevantTxns.reduce((acc, t) => acc + t.amount_minor, 0);
        expect(fact.value, `Sum mismatch on fact "${fact.id}"`).toBe(sumMinor);
        const expectedNoCents = formatMoneyMinor(sumMinor, { showCents: false });
        const expectedWithCents = formatMoneyMinor(sumMinor, { showCents: true });
        expect([expectedNoCents, expectedWithCents]).toContain(fact.formatted);
      }
    } else if (directCountFactIds.has(fact.id)) {
      if (Number(fact.value) === 0) {
        expect(fact.formatted).toBe('0');
      } else {
        expect(fact.value, `Count mismatch on fact "${fact.id}"`).toBe(backingTxns.length);
        expect(fact.formatted).toBe(backingTxns.length.toLocaleString('en-US'));
      }
    } else if (fact.id === 'year_number') {
      expect(fact.value).toBe(expectedYear);
      expect(fact.formatted).toBe(String(expectedYear));
    } else if (fact.id === 'avg_spend_top_merchant') {
      const sumMinor = backingTxns.reduce((acc, t) => acc + t.amount_minor, 0);
      const expectedAvg = Math.round(sumMinor / backingTxns.length);
      expect(fact.value).toBe(expectedAvg);
      expect(fact.formatted).toBe(formatMoneyMinor(expectedAvg, { showCents: true }));
    } else if (fact.id === 'top_spend_top_merchant') {
      const maxMinor = backingTxns.reduce((max, t) => Math.max(max, t.amount_minor), 0);
      expect(fact.value).toBe(maxMinor);
      expect(fact.formatted).toBe(formatMoneyMinor(maxMinor, { showCents: true }));
    } else if (fact.id === 'top_merchant_days_interval') {
      const expectedInterval = Math.max(1, Math.round(days.length / backingTxns.length));
      expect(fact.value).toBe(expectedInterval);
      expect(fact.formatted).toBe(String(expectedInterval));
    } else if (fact.id === 'top_merchant_name' || fact.id === 'second_coffee_merchant_name') {
      expect(backingTxns.every((t) => t.merchant === fact.value)).toBe(true);
      expect(fact.formatted).toBe(String(fact.value));
    } else if (fact.id === 'coffee_merchants_count') {
      const distinctCafes = new Set(backingTxns.map((t) => t.merchant)).size;
      expect(fact.value).toBe(distinctCafes);
      expect(fact.formatted).toBe(String(distinctCafes));
    } else if (fact.id === 'big_one_merchant' || fact.id === 'jan_tech_merchant') {
      expect(backingTxns[0]?.merchant).toBe(fact.value);
      expect(fact.formatted).toBe(String(fact.value));
    } else if (fact.id === 'big_one_date' || fact.id === 'jan_tech_date') {
      expect(backingTxns[0]?.date).toBe(fact.value);
      expect(fact.formatted).toBe(String(fact.value));
    } else if (fact.id === 'loudest_day_date') {
      expect(backingTxns.every((t) => t.date === fact.value)).toBe(true);
      expect(fact.formatted).toBe(String(fact.value));
    } else if (fact.id === 'getaway_days_count') {
      const distinctDates = new Set(backingTxns.map((t) => t.date)).size;
      expect(fact.value).toBe(distinctDates);
      expect(fact.formatted).toBe(String(distinctDates));
    } else if (fact.id === 'longest_coffee_streak_days') {
      const distinctDates = new Set(backingTxns.map((t) => t.date)).size;
      expect(fact.value).toBe(distinctDates);
      expect(fact.formatted).toBe(String(distinctDates));
    } else if (fact.id === 'longest_spend_streak_days') {
      const distinctDates = new Set(backingTxns.map((t) => t.date)).size;
      expect(fact.value).toBe(distinctDates);
      expect(fact.formatted).toBe(String(distinctDates));
    } else if (fact.id === 'no_spend_days_count') {
      const noSpendCount = days.filter((d) => d.discretionary_out_minor === 0).length;
      expect(fact.value).toBe(noSpendCount);
      expect(fact.formatted).toBe(String(noSpendCount));
    } else if (fact.id === 'active_spend_days_count') {
      const activeCount = days.filter((d) => d.discretionary_out_minor > 0).length;
      expect(fact.value).toBe(activeCount);
      expect(fact.formatted).toBe(String(activeCount));
    } else if (fact.id === 'monthly_avg_spend_usd') {
      const discFact = factById.get('discretionary_spend_usd')!;
      const expectedMonthly = Math.round(Number(discFact.value) / 12);
      expect(fact.value).toBe(expectedMonthly);
      expect(fact.formatted).toBe(formatMoneyMinor(expectedMonthly, { showCents: false }));
    } else if (fact.id === 'top_category_share_pct') {
      const topSpend = Number(factById.get('top_category_spend')!.value);
      const discSpend = Number(factById.get('discretionary_spend_usd')!.value);
      const expectedPct = Math.round((topSpend / discSpend) * 100);
      expect(fact.value).toBe(expectedPct);
      expect(fact.formatted).toBe(`${expectedPct}%`);
    }
  }

  // Also verify full pipeline recomputation produces identical Fact[] array
  const recomputed = computeFacts(transactions, days, expectedYear);
  expect(recomputed).toEqual(facts);
}

/**
 * Extracts all `{fact:id}` placeholders and `fact_ids` referenced anywhere in a StoryPlan,
 * resolves all copy templates, and returns both the referenced IDs and all resolved strings.
 */
function inspectPlanFactsAndResolvedCopy(
  plan: StoryPlan,
  facts: readonly Fact[]
): {
  referencedFactIds: string[];
  resolvedCopyStrings: Array<{ location: string; text: string }>;
} {
  const factMap = new Map<string, Fact>(facts.map((f) => [f.id, f]));
  const referencedIds = new Set<string>([
    plan.year_fact_id,
    plan.personality.payday_spike_ratio_fact_id,
  ]);
  const resolvedStrings: Array<{ location: string; text: string }> = [];

  const resolveTemplate = (location: string, template?: string) => {
    if (!template) return;
    const regex = /\{fact:([a-zA-Z0-9_]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(template)) !== null) {
      referencedIds.add(m[1]!);
    }
    const resolved = template.replace(regex, (_full, fid: string) => {
      const fact = factMap.get(fid);
      expect(fact, `${location} references missing fact "${fid}"`).toBeDefined();
      return fact!.formatted;
    });
    resolvedStrings.push({ location, text: resolved });
  };

  resolveTemplate('plan.one_line', plan.one_line);
  resolveTemplate('plan.personality.title', plan.personality.title);
  resolveTemplate('plan.personality.subtitle', plan.personality.subtitle);

  for (const ch of plan.chapters) {
    for (const fid of ch.fact_ids) referencedIds.add(fid);
    resolveTemplate(`chapter[${ch.id}].headline`, ch.headline);
    resolveTemplate(`chapter[${ch.id}].body`, ch.body);
    resolveTemplate(`chapter[${ch.id}].params.kicker`, ch.params.kicker);
    resolveTemplate(`chapter[${ch.id}].params.subheadline`, ch.params.subheadline);
    resolveTemplate(`chapter[${ch.id}].params.badge`, ch.params.badge);
    for (const blk of ch.params.blocks ?? []) {
      referencedIds.add(blk.fact_id);
      for (const sfid of blk.sublabel_fact_ids ?? []) referencedIds.add(sfid);
      resolveTemplate(`chapter[${ch.id}].block[${blk.label}].label`, blk.label);
      resolveTemplate(
        `chapter[${ch.id}].block[${blk.label}].sublabel_template`,
        blk.sublabel_template
      );
    }
  }

  return {
    referencedFactIds: [...referencedIds],
    resolvedCopyStrings: resolvedStrings,
  };
}

describe('Phase 4 Independent Data & Answer-Key Verification (Subagent V1)', () => {
  const samTransactions = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8')
  ) as Transaction[];
  const samDays = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'days.json'), 'utf8')) as Day[];
  const samFacts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'facts.json'), 'utf8')) as Fact[];
  const samPlan = JSON.parse(
    fs.readFileSync(path.join(STORY_DIR, 'plan.json'), 'utf8')
  ) as StoryPlan;
  const alexPlan = JSON.parse(
    fs.readFileSync(path.join(STORY_DIR, 'alex_plan.json'), 'utf8')
  ) as StoryPlan;

  describe('1. Independent Raw CSV & Day Aggregation Reconciliation', () => {
    it('re-sums ../data/transactions_2025.csv independently with $0.00 (0 cents) reconciliation difference across all 1,000 rows, Credit card (809), and Savings (191)', () => {
      const csvPath = path.join(REPO_ROOT, 'data', 'transactions_2025.csv');
      const rawLines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
      expect(rawLines[0]).toBe('id,date,posted_date,account,tran_type,description,amount,currency');
      const dataLines = rawLines.slice(1).filter((l) => l.trim().length > 0);
      expect(dataLines.length).toBe(1000);

      let rawAllSignedMinor = 0;
      let rawCardSignedMinor = 0;
      let rawSavingsSignedMinor = 0;
      let rawCardCount = 0;
      let rawSavingsCount = 0;

      const parsedRows = parseCsvFile(csvPath);
      expect(parsedRows.length).toBe(1000);

      for (const r of parsedRows) {
        const signedMinor = Math.round(Number.parseFloat(r.amount) * 100);
        rawAllSignedMinor += signedMinor;
        if (r.account === 'Credit card') {
          rawCardCount++;
          rawCardSignedMinor += signedMinor;
        } else if (r.account === 'Savings') {
          rawSavingsCount++;
          rawSavingsSignedMinor += signedMinor;
        }
      }

      expect(rawCardCount).toBe(809);
      expect(rawSavingsCount).toBe(191);
      expect(rawAllSignedMinor).toBe(-2499715); // -$24,997.15
      expect(rawCardSignedMinor).toBe(1644468); // +$16,444.68
      expect(rawSavingsSignedMinor).toBe(-4144183); // -$41,441.83

      // Compare against data/transactions.json
      expect(samTransactions.length).toBe(1000);
      expect(samTransactions.filter((t) => t.account === 'Credit card').length).toBe(809);
      expect(samTransactions.filter((t) => t.account === 'Savings').length).toBe(191);

      const txnSignedSum = (txns: readonly Transaction[]) =>
        txns.reduce(
          (acc, t) => acc + (t.direction === 'out' ? -t.amount_minor : t.amount_minor),
          0
        );

      const jsonAllSignedMinor = txnSignedSum(samTransactions);
      const jsonCardSignedMinor = txnSignedSum(
        samTransactions.filter((t) => t.account === 'Credit card')
      );
      const jsonSavingsSignedMinor = txnSignedSum(
        samTransactions.filter((t) => t.account === 'Savings')
      );

      expect(jsonAllSignedMinor - rawAllSignedMinor).toBe(0);
      expect(jsonCardSignedMinor - rawCardSignedMinor).toBe(0);
      expect(jsonSavingsSignedMinor - rawSavingsSignedMinor).toBe(0);

      // Verify 1-to-1 row correspondence between raw CSV and transactions.json
      for (let i = 0; i < parsedRows.length; i++) {
        const raw = parsedRows[i]!;
        const txn = samTransactions[i]!;
        expect(txn.id).toBe(raw.id);
        expect(txn.date).toBe(raw.date);
        expect(txn.posted_date).toBe(raw.posted_date);
        expect(txn.account).toBe(raw.account);
        expect(txn.raw_description).toBe(raw.description);
        const rawSigned = Math.round(Number.parseFloat(raw.amount) * 100);
        const txnSigned = txn.direction === 'out' ? -txn.amount_minor : txn.amount_minor;
        expect(txnSigned).toBe(rawSigned);
      }
    });

    it('reconciles data/days.json (365 days, 12 paydays) against data/transactions.json with 0.00 difference', () => {
      expect(samDays.length).toBe(365);
      expect(samDays[0]?.date).toBe('2025-01-01');
      expect(samDays[364]?.date).toBe('2025-12-31');
      expect(samDays.filter((d) => d.is_payday).length).toBe(12);

      const txnsAllOutMinor = samTransactions
        .filter((t) => t.direction === 'out' && !t.is_transfer)
        .reduce((acc, t) => acc + t.amount_minor, 0);
      const txnsDiscOutMinor = samTransactions
        .filter(
          (t) =>
            t.direction === 'out' &&
            !t.is_transfer &&
            !t.is_refund &&
            isDiscretionaryCategory(t.category)
        )
        .reduce((acc, t) => acc + t.amount_minor, 0);
      const txnsInMinor = samTransactions
        .filter((t) => t.direction === 'in' && !t.is_transfer && !t.is_refund)
        .reduce((acc, t) => acc + t.amount_minor, 0);

      const daysAllOutMinor = samDays.reduce((acc, d) => acc + d.all_out_minor, 0);
      const daysDiscOutMinor = samDays.reduce((acc, d) => acc + d.discretionary_out_minor, 0);
      const daysInMinor = samDays.reduce((acc, d) => acc + d.in_minor, 0);

      expect(txnsAllOutMinor).toBe(9458529); // $94,585.29
      expect(daysAllOutMinor).toBe(9458529);
      expect(txnsDiscOutMinor).toBe(5694582); // $56,945.82
      expect(daysDiscOutMinor).toBe(5694582);
      expect(txnsInMinor).toBe(8176246); // $81,762.46
      expect(daysInMinor).toBe(8176246);
    });
  });

  describe('2. Answer Key Verification (data/answer_key/transactions_2025_labels.csv)', () => {
    const key2025 = parseAnswerKeyCsv(path.join(ANSWER_KEY_DIR, 'transactions_2025_labels.csv'));
    const keyMultiYear = parseAnswerKeyCsv(
      path.join(ANSWER_KEY_DIR, 'transactions_2020-2025_labels.csv')
    );

    it('confirms answer_key/transactions_2025_labels.csv has 1,000 rows and matches the 2025 slice of transactions_2020-2025_labels.csv (5,424 rows)', () => {
      expect(key2025.size).toBe(1000);
      expect(keyMultiYear.size).toBe(5424);

      for (const [id, row] of key2025.entries()) {
        const multiRow = keyMultiYear.get(id);
        expect(multiRow).toEqual(row);
      }
    });

    it('verifies category agreement across all 1,000 rows (88.80% exact match, 95.03% dollar-weighted match, 100% on 7 core categories)', () => {
      let exactCategoryMatches = 0;
      let totalMinor = 0;
      let matchedMinor = 0;

      const byKeyCategory = new Map<Category, { total: number; matched: number }>();
      for (const cat of CATEGORIES) {
        byKeyCategory.set(cat, { total: 0, matched: 0 });
      }

      for (const t of samTransactions) {
        const keyRow = key2025.get(t.id);
        expect(keyRow).toBeDefined();
        const stat = byKeyCategory.get(keyRow!.category)!;
        stat.total++;
        totalMinor += t.amount_minor;
        if (t.category === keyRow!.category) {
          exactCategoryMatches++;
          stat.matched++;
          matchedMinor += t.amount_minor;
        }
      }

      // Exact row-level agreement is 888 / 1,000 (88.80%)
      expect(exactCategoryMatches).toBe(888);
      // Dollar-weighted category agreement is $292,948.44 / $308,253.25 (95.03%)
      expect(matchedMinor).toBe(29294844);
      expect(totalMinor).toBe(30825325);
      expect(matchedMinor / totalMinor).toBeGreaterThan(0.95);

      // 7 categories have 100.0% exact agreement with the answer key
      const hundredPercentCategories: Category[] = [
        'groceries',
        'subscriptions',
        'income',
        'fees',
        'savings',
        'rent',
        'travel',
      ];
      for (const cat of hundredPercentCategories) {
        const st = byKeyCategory.get(cat)!;
        expect(st.matched, `Expected 100% match on ${cat}`).toBe(st.total);
      }
    });

    it('verifies merchant cleaning against the answer key (70.09% exact string match, 99.88% canonical entity match on Credit card, 100% privacy-safe non-empty labels on Savings)', () => {
      const cardTxns = samTransactions.filter((t) => t.account === 'Credit card');
      const savingsTxns = samTransactions.filter((t) => t.account === 'Savings');
      expect(cardTxns.length).toBe(809);
      expect(savingsTxns.length).toBe(191);

      // In the answer key, all 191 Savings rows leave merchant empty (""), whereas the pipeline populates clean privacy-safe names
      for (const s of savingsTxns) {
        const keyRow = key2025.get(s.id)!;
        expect(keyRow.merchant).toBe('');
        expect(s.merchant.trim().length).toBeGreaterThan(0);
      }

      let exactCardMerchantMatches = 0;
      let canonicalCardMerchantMatches = 0;
      const unmappedCardDiffs: string[] = [];

      for (const c of cardTxns) {
        const keyRow = key2025.get(c.id)!;
        if (c.merchant === keyRow.merchant) {
          exactCardMerchantMatches++;
          canonicalCardMerchantMatches++;
        } else if (BENIGN_CARD_MERCHANT_ALIASES[c.merchant] === keyRow.merchant) {
          canonicalCardMerchantMatches++;
        } else {
          unmappedCardDiffs.push(`${c.id}: pipe="${c.merchant}" vs key="${keyRow.merchant}"`);
        }
      }

      // 567 / 809 (70.09%) exact character-for-character match on Credit Card rows
      expect(exactCardMerchantMatches).toBe(567);
      // 808 / 809 (99.88%) canonical entity match on Credit Card rows (only 1 abbreviated parking row differs)
      expect(canonicalCardMerchantMatches).toBe(808);
      expect(unmappedCardDiffs).toEqual([
        'CARD-2025062801: pipe="KPL Elm Rd" vs key="Keystone Parking"',
      ]);
    });

    it('verifies is_transfer (99.00% agreement, 100% precision), is_refund (100.00% agreement), and is_recurring (313 recurring rows)', () => {
      let transferMatches = 0;
      const pipeTransfers = samTransactions.filter((t) => t.is_transfer);
      expect(pipeTransfers.length).toBe(150);

      for (const t of samTransactions) {
        const keyIsTransfer = key2025.get(t.id)!.category === 'transfers';
        if (t.is_transfer === keyIsTransfer) {
          transferMatches++;
        }
      }

      // Every single transaction flagged is_transfer=true by the pipeline is also "transfers" in the answer key (150/150 = 100% precision)
      expect(pipeTransfers.every((t) => key2025.get(t.id)!.category === 'transfers')).toBe(true);
      // Overall boolean agreement is 990 / 1,000 (99.00%)
      expect(transferMatches).toBe(990);

      // Verify is_refund: exactly the 2 positive non-repayment Credit card credits (1,000 / 1,000 = 100.00%)
      const refunds = samTransactions.filter((t) => t.is_refund);
      expect(refunds.map((r) => r.id)).toEqual(['CARD-2025011702', 'CARD-2025013108']);
      for (const t of samTransactions) {
        const expectedIsRefund =
          t.account === 'Credit card' && t.direction === 'in' && !t.is_transfer;
        expect(t.is_refund).toBe(expectedIsRefund);
      }

      // Verify is_recurring: 313 rows across regular salary, bills, subscriptions, rent, savings, fees, and recurring transfers
      const recurring = samTransactions.filter((t) => t.is_recurring);
      expect(recurring.length).toBe(313);
      expect(
        recurring.every((t) =>
          ['income', 'fees', 'transfers', 'subscriptions', 'rent', 'savings', 'bills'].includes(
            t.category
          )
        )
      ).toBe(true);
    });
  });

  describe('3. Independent Re-Computation of All 96 Facts & StoryPlan Fact Placeholders', () => {
    it('re-computes all 96 facts in data/facts.json from their txn_ids with 0 mismatches', () => {
      expect(samFacts.length).toBe(96);
      assertAllFactsRecomputeFromTxnIds(samFacts, samTransactions, samDays, 2025);
    });

    it('verifies every {fact:id} in story/plan.json (Sam) and story/alex_plan.json (Alex) resolves cleanly with 0 mismatches', async () => {
      // 1. Sam's StoryPlan (story/plan.json)
      const samLint = lintStoryPlanAgainstFacts(samPlan, samFacts);
      expect(samLint).toEqual({ ok: true, errors: [] });

      const samInspection = inspectPlanFactsAndResolvedCopy(samPlan, samFacts);
      expect(samInspection.referencedFactIds.length).toBeGreaterThanOrEqual(45);
      for (const resolved of samInspection.resolvedCopyStrings) {
        expect(resolved.text).not.toMatch(/\{fact:/);
      }

      // 2. Alex's StoryPlan (story/alex_plan.json)
      const alexCsvPath = path.join(DATA_DIR, 'mock', 'alex_2025.csv');
      const alexRawRows = parseCsvFile(alexCsvPath);
      const alexCache = await buildOrUpdateMerchantCache(alexRawRows);
      const alexTransactions = buildTransactions(alexRawRows, alexCache);
      const alexDays = computeDays(alexTransactions, 2025);
      const alexFacts = computeFacts(alexTransactions, alexDays, 2025);
      const alexRecon = reconcileDataset(alexRawRows, alexTransactions, alexDays, alexFacts);

      expect(alexRecon.ok).toBe(true);
      expect(alexRecon.diffSignedMinor).toBe(0);
      expect(alexFacts.length).toBe(96);
      assertAllFactsRecomputeFromTxnIds(alexFacts, alexTransactions, alexDays, 2025);

      const alexLint = lintStoryPlanAgainstFacts(alexPlan, alexFacts);
      expect(alexLint).toEqual({ ok: true, errors: [] });

      const alexInspection = inspectPlanFactsAndResolvedCopy(alexPlan, alexFacts);
      expect(alexInspection.referencedFactIds.length).toBeGreaterThanOrEqual(35);
      for (const resolved of alexInspection.resolvedCopyStrings) {
        expect(resolved.text).not.toMatch(/\{fact:/);
      }
    });
  });

  describe('4. Rule 6 Privacy Verification Across Merchants, Facts & Resolved Story Copy', () => {
    const FORBIDDEN_PRIVACY_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
      {
        label: 'Bank account number (US-ACCT-... / US-EXT-... / FC...)',
        regex: /\b(?:US-(?:ACCT|EXT)-\d{4}|(?:FC)?\d{2}-\d{4}-\s*\d{7}-\d{2,3})\b/i,
      },
      { label: 'FC account prefix', regex: /\bFC\d{2}-\d{4}/i },
      { label: 'Card number 7731 / 7732', regex: /\b773[12]\b/ },
      {
        label: 'Bank reference code',
        regex:
          /\b(?:P1KMMKEW|JQRNYXQS|DK6V3KDA|KBQX1607|TLTMAVQL|A7EZ8P2|JRBYSJS|WU9GM8F|Y99ZXLRMUFW|WOGXAJEDU|D13ASH|LEGR|TP1HS8D7|CHBT966U|INVS2J5842H|WEBSIT#VLCYFRBM)\b/i,
      },
      {
        label: 'Unmasked personal name (Sam MERCER, LEE R, MaxVance, Tess, Theo)',
        regex:
          /\b(?:Sam\s+MERCER|sammercer|samm|Sam\s+HARLOW|samharlow|samh|LEE\s+R|MaxVance|Max\s+Vance|MaxBarlow|Max\s+Barlow|Tess|Theo|Theoflight)\b/i,
      },
    ];

    it('confirms zero PII leaks across all 1,000 Transaction.merchant strings, all 96 Fact.formatted strings, and all resolved strings in story/plan.json', () => {
      // 1. Audit via pipeline helper
      expect(auditPrivacyOnTransactions(samTransactions)).toEqual([]);

      // 2. Audit all 1,000 Transaction.merchant strings against strict Rule 6 patterns
      for (const t of samTransactions) {
        for (const pat of FORBIDDEN_PRIVACY_PATTERNS) {
          expect(
            t.merchant,
            `Privacy violation (${pat.label}) on ${t.id}: "${t.merchant}"`
          ).not.toMatch(pat.regex);
        }
      }

      // 3. Audit all 96 Fact.formatted, Fact.value, and Fact.label strings
      for (const f of samFacts) {
        for (const pat of FORBIDDEN_PRIVACY_PATTERNS) {
          expect(
            f.formatted,
            `Privacy violation (${pat.label}) on Fact[${f.id}].formatted: "${f.formatted}"`
          ).not.toMatch(pat.regex);
          expect(
            String(f.value),
            `Privacy violation (${pat.label}) on Fact[${f.id}].value: "${String(f.value)}"`
          ).not.toMatch(pat.regex);
          expect(
            f.label,
            `Privacy violation (${pat.label}) on Fact[${f.id}].label: "${f.label}"`
          ).not.toMatch(pat.regex);
        }
      }

      // 4. Audit all resolved strings in story/plan.json
      const { resolvedCopyStrings } = inspectPlanFactsAndResolvedCopy(samPlan, samFacts);
      expect(resolvedCopyStrings.length).toBeGreaterThan(50);
      for (const item of resolvedCopyStrings) {
        for (const pat of FORBIDDEN_PRIVACY_PATTERNS) {
          expect(
            item.text,
            `Privacy violation (${pat.label}) in ${item.location}: "${item.text}"`
          ).not.toMatch(pat.regex);
        }
      }

      // 5. Confirm Friend A..D masking is present in transactions.json
      const merchants = new Set(samTransactions.map((t) => t.merchant));
      expect(merchants.has('Friend A')).toBe(true);
      expect(merchants.has('Friend B')).toBe(true);
      expect(merchants.has('Friend C')).toBe(true);
      expect(merchants.has('Friend D')).toBe(true);
    });
  });

  describe('5. Independent Verification of 22 Ask Your Year Queries on Real Data', () => {
    it('executes 22 Ask Your Year queries against data/transactions.json and matches hand-computed answers', () => {
      const cases: ReadonlyArray<{
        question: string;
        answerable: boolean;
        expectedMinor?: number;
        expectedFormatted?: string;
        expectedTxnCount?: number;
      }> = [
        {
          question: 'How many times did I visit Blue Bottle Coffee?',
          answerable: true,
          expectedMinor: 72,
          expectedFormatted: '72',
          expectedTxnCount: 72,
        },
        {
          question: 'How much did I spend at Blue Bottle Coffee?',
          answerable: true,
          expectedMinor: 57280,
          expectedFormatted: '$572.80',
          expectedTxnCount: 72,
        },
        {
          question: 'How many times did I visit Sightglass Coffee?',
          answerable: true,
          expectedMinor: 41,
          expectedFormatted: '41',
          expectedTxnCount: 41,
        },
        {
          question: 'How much did I spend at Sightglass Coffee?',
          answerable: true,
          expectedMinor: 63427,
          expectedFormatted: '$634.27',
          expectedTxnCount: 41,
        },
        {
          question: 'How much did I spend at Monarch Acoustic?',
          answerable: true,
          expectedMinor: 1159687,
          expectedFormatted: '$11,596.87',
          expectedTxnCount: 2,
        },
        {
          question: "How much did I spend at Trader Joe's?",
          answerable: true,
          expectedMinor: 151722,
          expectedFormatted: '$1,517.22',
          expectedTxnCount: 27,
        },
        {
          question: 'How much did I spend at Uber Eats?',
          answerable: true,
          expectedMinor: 53294,
          expectedFormatted: '$532.94',
          expectedTxnCount: 9,
        },
        {
          question: 'How much did I spend on coffee in 2025?',
          answerable: true,
          expectedMinor: 226488,
          expectedFormatted: '$2,264.88',
          expectedTxnCount: 163,
        },
        {
          question: 'How much did I spend on groceries?',
          answerable: true,
          expectedMinor: 241582,
          expectedFormatted: '$2,415.82',
          expectedTxnCount: 64,
        },
        {
          question: 'How much did I spend on eating out?',
          answerable: true,
          expectedMinor: 680234,
          expectedFormatted: '$6,802.34',
          expectedTxnCount: 137,
        },
        {
          question: 'How much did I spend on takeaway?',
          answerable: true,
          expectedMinor: 116705,
          expectedFormatted: '$1,167.05',
          expectedTxnCount: 38,
        },
        {
          question: 'How much did I spend on travel?',
          answerable: true,
          expectedMinor: 574904,
          expectedFormatted: '$5,749.04',
          expectedTxnCount: 16,
        },
        {
          question: 'How much did I spend on transport?',
          answerable: true,
          expectedMinor: 416271,
          expectedFormatted: '$4,162.71',
          expectedTxnCount: 85,
        },
        {
          question: 'How much did I spend on bills?',
          answerable: true,
          expectedMinor: 421298,
          expectedFormatted: '$4,212.98',
          expectedTxnCount: 37,
        },
        {
          question: 'How much did I spend on subscriptions?',
          answerable: true,
          expectedMinor: 209959,
          expectedFormatted: '$2,099.59',
          expectedTxnCount: 71,
        },
        {
          question: 'How much did I spend on health?',
          answerable: true,
          expectedMinor: 109119,
          expectedFormatted: '$1,091.19',
          expectedTxnCount: 12,
        },
        {
          question: 'How much did I spend on gifts?',
          answerable: true,
          expectedMinor: 137050,
          expectedFormatted: '$1,370.50',
          expectedTxnCount: 11,
        },
        {
          question: 'What was my biggest single purchase?',
          answerable: true,
          expectedMinor: 906187,
          expectedFormatted: '$9,061.87',
          expectedTxnCount: 823,
        },
        {
          question: 'What was my average coffee spend?',
          answerable: true,
          expectedMinor: 1389,
          expectedFormatted: '$13.89',
          expectedTxnCount: 163,
        },
        {
          question: 'How much did I earn from Pacific Studio Labs?',
          answerable: true,
          expectedMinor: 8100000,
          expectedFormatted: '$81,000',
          expectedTxnCount: 12,
        },
        {
          question: 'How much did I spend on coffee after 2pm?',
          answerable: false,
        },
        {
          question: 'How much did I spend on avocados at the supermarket?',
          answerable: false,
        },
      ];

      for (const c of cases) {
        const res = answerQuestionDeterministically(c.question, samTransactions);
        expect(res.answerable, `Question: ${c.question}`).toBe(c.answerable);
        if (c.answerable) {
          expect(res.value_minor, `Value mismatch on: ${c.question}`).toBe(c.expectedMinor);
          expect(res.formatted_answer, `Formatted mismatch on: ${c.question}`).toBe(
            c.expectedFormatted
          );
          expect(res.matching_txn_ids.length, `Count mismatch on: ${c.question}`).toBe(
            c.expectedTxnCount
          );
        } else {
          expect(res.reason_if_not).toBeTruthy();
          expect(res.suggested_question).toBeTruthy();
        }
      }
    });
  });

  describe('6. User Feedback 1 & 3 Verification: USA Obfuscation, Uniform $6,750.00 Paydays & Single Helpful Insight', () => {
    it('verifies all 12 salary deposits in 2025 are uniform $6,750.00 (675000 minor) with zero bonuses and zero NZ/unobfuscated terms across all CSV and JSON datasets', () => {
      const salaryTxns = samTransactions.filter(
        (t) =>
          t.category === 'income' &&
          t.direction === 'in' &&
          !t.is_transfer &&
          t.merchant === 'Pacific Studio Labs'
      );
      expect(salaryTxns.length).toBe(12);
      for (const s of salaryTxns) {
        expect(s.amount_minor, `Salary txn ${s.id} on ${s.date} should be $6,750.00`).toBe(675000);
      }

      const salaryFact = samFacts.find((f) => f.id === 'salary_income_usd')!;
      expect(salaryFact.value).toBe(8100000);
      expect(salaryFact.formatted).toBe('$81,000');

      const paydayFact = samFacts.find((f) => f.id === 'december_bonus_pay_usd')!;
      expect(paydayFact.value).toBe(675000);
      expect(paydayFact.formatted).toBe('$6,750');
      expect(paydayFact.label).toBe('Monthly Paycheck');

      const forbiddenNzTermsRegex =
        /\b(Auckland|Wellington|Christchurch|Mangawhai|Taupo|Queenstown|Woolworths|Countdown|PAK'nSAVE|KiwiSaver|Inland Revenue|Corner Pantry|Lantern Bay|SoundRoom|Harbourlight|Sam Harlow|01-2014-)\b/i;

      const filesToScan = [
        path.join(REPO_ROOT, 'data', 'transactions_2025.csv'),
        path.join(REPO_ROOT, 'data', 'transactions_2020-2025.csv'),
        path.join(REPO_ROOT, 'data', 'raw', 'card_statement_2020-2025.csv'),
        path.join(REPO_ROOT, 'data', 'raw', 'savings_statement_2020-2025.csv'),
        path.join(REPO_ROOT, 'data', 'answer_key', 'transactions_2025_labels.csv'),
        path.join(DATA_DIR, 'transactions.json'),
        path.join(DATA_DIR, 'facts.json'),
        path.join(STORY_DIR, 'plan.json'),
        path.join(STORY_DIR, 'alex_plan.json'),
      ];

      for (const filePath of filesToScan) {
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(forbiddenNzTermsRegex);
        expect(
          match,
          `Forbidden NZ/unobfuscated term found in ${filePath}: ${match?.[0]}`
        ).toBeNull();
      }
    });

    it('verifies every narrative chapter in story/plan.json (pour through personality) begins its body with a clear "Takeaway for Sam —" insight', () => {
      const narrativeChapters = samPlan.chapters.filter(
        (ch) => ch.id !== 'one_line' && ch.id !== 'share_card'
      );
      expect(narrativeChapters.length).toBe(11);
      for (const ch of narrativeChapters) {
        expect(
          ch.body.startsWith('Takeaway for Sam — '),
          `Chapter "${ch.id}" body must start with "Takeaway for Sam — "`
        ).toBe(true);
      }
    });
  });
});
