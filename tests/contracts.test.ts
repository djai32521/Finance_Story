import { describe, expect, it } from 'vitest';
import { CATEGORIES, formatMoneyMinor, isDiscretionaryCategory } from '../contracts/index.js';
import { buildMockDataset } from '../data/mock/index.js';
import { lintStoryPlanAgainstFacts } from '../scripts/fact-lint.js';

describe('Contracts & Mock Dataset (M0)', () => {
  it('defines the 17 standard categories and discretionary filter accurately', () => {
    expect(CATEGORIES.length).toBe(17);
    expect(isDiscretionaryCategory('coffee')).toBe(true);
    expect(isDiscretionaryCategory('groceries')).toBe(true);
    expect(isDiscretionaryCategory('rent')).toBe(false);
    expect(isDiscretionaryCategory('bills')).toBe(false);
    expect(isDiscretionaryCategory('fees')).toBe(false);
    expect(isDiscretionaryCategory('savings')).toBe(false);
    expect(isDiscretionaryCategory('transfers')).toBe(false);
    expect(isDiscretionaryCategory('income')).toBe(false);
  });

  it('formats minor money units deterministically', () => {
    expect(formatMoneyMinor(218400)).toBe('$2,184');
    expect(formatMoneyMinor(57280)).toBe('$572.80');
    expect(formatMoneyMinor(71)).toBe('$0.71');
  });

  it('generates a valid 365-day mock dataset and passes fact-lint', () => {
    const { transactions, days, facts, plan } = buildMockDataset();
    expect(days.length).toBe(365);
    expect(days[0]?.date).toBe('2025-01-01');
    expect(days[364]?.date).toBe('2025-12-31');
    expect(transactions.length).toBeGreaterThan(300);
    expect(facts.length).toBeGreaterThanOrEqual(8);

    const lint = lintStoryPlanAgainstFacts(plan, facts);
    expect(lint.errors).toEqual([]);
    expect(lint.ok).toBe(true);
  });

  it('catches raw digits in copy via fact-lint', () => {
    const { facts, plan } = buildMockDataset();
    const badPlan = structuredClone(plan);
    badPlan.one_line = 'You visited Blue Bottle Coffee 72 times in {fact:year_number}.';
    const lint = lintStoryPlanAgainstFacts(badPlan, facts);
    expect(lint.ok).toBe(false);
    expect(lint.errors[0]).toContain('raw un-sourced digit');
  });
});
