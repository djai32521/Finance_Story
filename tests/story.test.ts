import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Day, Fact, StoryPlan, Transaction } from '../contracts/index.js';
import { isDiscretionaryCategory } from '../contracts/index.js';
import {
  buildOrUpdateMerchantCache,
  buildTransactions,
  computeDays,
  computeFacts,
  parseCsvFile,
  reconcileDataset,
} from '../pipeline/index.js';
import { lintStoryPlanAgainstFacts } from '../scripts/fact-lint.js';
import { runStoryGeneration } from '../story/generate.js';
import {
  buildPersonalisationComparisonMarkdown,
  deriveOneLineTemplate,
  derivePersonalityProfile,
  planStory,
  scoreCandidateChapters,
} from '../story/planner.js';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(APP_ROOT, 'data');
const STORY_DIR = path.join(APP_ROOT, 'story');
const REPORTS_DIR = path.join(APP_ROOT, 'reports');

function loadSamDataset(): {
  facts: Fact[];
  days: Day[];
  transactions: Transaction[];
} {
  const facts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'facts.json'), 'utf8')) as Fact[];
  const days = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'days.json'), 'utf8')) as Day[];
  const transactions = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8')
  ) as Transaction[];
  return { facts, days, transactions };
}

describe('Story Planner & Personalisation (Workstream D)', () => {
  it('scores all candidate chapters and selects Sam’s 9 middle chapters while rejecting non-matching archetypes', () => {
    const { facts, days, transactions } = loadSamDataset();
    const scores = scoreCandidateChapters(facts, days, transactions);

    expect(scores.length).toBe(11);
    const byId = new Map(scores.map((s) => [s.id, s]));

    // Selected for Sam
    expect(byId.get('your_place')?.selected).toBe(true);
    expect(byId.get('bespoke_studio')?.selected).toBe(true);
    expect(byId.get('streak')?.selected).toBe(true);
    expect(byId.get('getaway')?.selected).toBe(true);
    expect(byId.get('bespoke_coffee')?.selected).toBe(true);
    expect(byId.get('heartbeat')?.selected).toBe(true);
    expect(byId.get('big_one')?.selected).toBe(true);
    expect(byId.get('shatter')?.selected).toBe(true);
    expect(byId.get('personality')?.selected).toBe(true);

    // Rejected for Sam
    expect(byId.get('bespoke_wellness')?.selected).toBe(false);
    expect(byId.get('bespoke_home_pantry')?.selected).toBe(false);
  });

  it('generates Sam’s 13-chapter StoryPlan passing fact-lint with 0 errors and full receipt traceability', () => {
    const { facts, days, transactions } = loadSamDataset();
    const output = planStory({
      personName: 'Sam',
      year: 2025,
      facts,
      days,
      transactions,
    });

    const { plan, rationaleMarkdown } = output;
    const lintResult = lintStoryPlanAgainstFacts(plan, facts);
    expect(lintResult).toEqual({ ok: true, errors: [] });

    // Exact 13-chapter sequence
    expect(plan.chapters.map((c) => c.id)).toEqual([
      'pour',
      'year_as_squares',
      'your_place',
      'bespoke_0',
      'streak',
      'getaway',
      'bespoke_1',
      'heartbeat',
      'big_one',
      'shatter',
      'personality',
      'one_line',
      'share_card',
    ]);

    // Verify bespoke chapters
    const studioChapter = plan.chapters.find((c) => c.id === 'bespoke_0')!;
    expect(studioChapter.type).toBe('bespoke');
    expect(studioChapter.bespoke_module).toBe('studio');
    expect(studioChapter.palette_id).toBe('paper_studio');
    expect(studioChapter.params.badge).toBe('only in your app');

    const coffeeChapter = plan.chapters.find((c) => c.id === 'bespoke_1')!;
    expect(coffeeChapter.type).toBe('bespoke');
    expect(coffeeChapter.bespoke_module).toBe('coffee');
    expect(coffeeChapter.palette_id).toBe('solar_ember');
    expect(coffeeChapter.params.badge).toBe('only in your app');

    // Verify positional fact_ids required by Core chapter renderers
    const streakChapter = plan.chapters.find((c) => c.id === 'streak')!;
    expect(streakChapter.fact_ids.slice(0, 3)).toEqual([
      'longest_spend_streak_days',
      'no_spend_days_count',
      'longest_coffee_streak_days',
    ]);
    expect((streakChapter.params.highlight_dates ?? []).length).toBe(34);

    const getawayChapter = plan.chapters.find((c) => c.id === 'getaway')!;
    expect(getawayChapter.fact_ids.slice(0, 3)).toEqual([
      'getaway_spend_usd',
      'getaway_days_count',
      'getaway_location_name',
    ]);

    const bigOneChapter = plan.chapters.find((c) => c.id === 'big_one')!;
    expect(bigOneChapter.fact_ids.slice(0, 2)).toEqual([
      'big_one_spend',
      'big_one_weeks_equivalent',
    ]);

    const yourPlaceChapter = plan.chapters.find((c) => c.id === 'your_place')!;
    expect(yourPlaceChapter.txn_ids.length).toBe(72);

    // Verify personality & Rule 3 discretionary categories only
    expect(plan.personality.title).toBe('The Studio-Building Regular');
    expect(plan.personality.shape_seed).toBe(2025);
    expect(plan.personality.dominant_categories.every((cat) => isDiscretionaryCategory(cat))).toBe(
      true
    );

    // Verify every chapter has non-empty txn_ids existing in transactions.json and a clear Takeaway for Sam
    const validTxnIds = new Set(transactions.map((t) => t.id));
    for (const ch of plan.chapters) {
      expect(ch.txn_ids.length).toBeGreaterThan(0);
      expect(ch.txn_ids.every((id) => validTxnIds.has(id))).toBe(true);
      expect(ch.body).toContain('Takeaway for Sam —');
    }

    // Verify rationale.md content
    expect(rationaleMarkdown).toContain("Sam's 2025 in Money");
    expect(rationaleMarkdown).toContain('Room to Make Noise');
    expect(rationaleMarkdown).toContain('The Morning Rivalry');

    // Verify story/plan.json on disk matches planner output
    const diskPlan = JSON.parse(
      fs.readFileSync(path.join(STORY_DIR, 'plan.json'), 'utf8')
    ) as StoryPlan;
    expect(diskPlan.chapters.map((c) => c.id)).toEqual(plan.chapters.map((c) => c.id));
    expect(lintStoryPlanAgainstFacts(diskPlan, facts)).toEqual({ ok: true, errors: [] });
  });

  it('runs second persona Alex (data/mock/alex_2025.csv) through the exact same pipeline and planner with genuine divergence and 0 fact-lint errors', async () => {
    const alexCsvPath = path.join(DATA_DIR, 'mock', 'alex_2025.csv');
    expect(fs.existsSync(alexCsvPath)).toBe(true);

    const alexRawRows = parseCsvFile(alexCsvPath);
    const alexCache = await buildOrUpdateMerchantCache(alexRawRows);
    const alexTransactions = buildTransactions(alexRawRows, alexCache);
    const alexDays = computeDays(alexTransactions, 2025);
    const alexFacts = computeFacts(alexTransactions, alexDays, 2025);
    const alexRecon = reconcileDataset(alexRawRows, alexTransactions, alexDays, alexFacts);

    expect(alexRecon.ok).toBe(true);
    expect(alexRecon.diffSignedMinor).toBe(0);
    expect(alexRecon.privacyViolations).toEqual([]);

    const alexOutput = planStory({
      personName: 'Alex',
      year: 2025,
      facts: alexFacts,
      days: alexDays,
      transactions: alexTransactions,
    });

    // Fact-lint on Alex's StoryPlan must pass with 0 errors
    const alexLint = lintStoryPlanAgainstFacts(alexOutput.plan, alexFacts);
    expect(alexLint).toEqual({ ok: true, errors: [] });

    // Compare Sam's plan vs Alex's plan to prove genuine personalisation
    const samPlan = JSON.parse(
      fs.readFileSync(path.join(STORY_DIR, 'plan.json'), 'utf8')
    ) as StoryPlan;
    const diskAlexPlan = JSON.parse(
      fs.readFileSync(path.join(STORY_DIR, 'alex_plan.json'), 'utf8')
    ) as StoryPlan;
    expect(diskAlexPlan.chapters.map((c) => c.id)).toEqual(
      alexOutput.plan.chapters.map((c) => c.id)
    );

    // 1. Different chapter count & sequence (13 vs 11; Alex omits heartbeat & big_one)
    expect(samPlan.chapters.length).toBe(13);
    expect(alexOutput.plan.chapters.length).toBe(11);
    expect(alexOutput.plan.chapters.some((c) => c.id === 'heartbeat')).toBe(false);
    expect(alexOutput.plan.chapters.some((c) => c.id === 'big_one')).toBe(false);

    // 2. Different bespoke modules (studio + coffee vs wellness_log + home_pantry)
    const samBespokeModules = samPlan.chapters
      .filter((c) => c.type === 'bespoke')
      .map((c) => c.bespoke_module);
    const alexBespokeModules = alexOutput.plan.chapters
      .filter((c) => c.type === 'bespoke')
      .map((c) => c.bespoke_module);
    expect(samBespokeModules).toEqual(['studio', 'coffee']);
    expect(alexBespokeModules).toEqual(['wellness_log', 'home_pantry']);

    // 3. Different anchor merchant & palette in Your Place
    const samYourPlace = samPlan.chapters.find((c) => c.id === 'your_place')!;
    const alexYourPlace = alexOutput.plan.chapters.find((c) => c.id === 'your_place')!;
    expect(samYourPlace.params.focus_merchant).toBe('Blue Bottle Coffee');
    expect(alexYourPlace.params.focus_merchant).toBe('Whole Foods Market');
    expect(samYourPlace.palette_id).toBe('solar_ember');
    expect(alexYourPlace.palette_id).toBe('olive_lime');
    expect(alexYourPlace.txn_ids.length).toBe(88);

    // 4. Different Money Personality & dominant categories
    expect(samPlan.personality.title).toBe('The Studio-Building Regular');
    expect(alexOutput.plan.personality.title).toBe('The Trail-Running Home Chef');
    expect(samPlan.personality.shape_seed).not.toBe(alexOutput.plan.personality.shape_seed);
    expect(samPlan.personality.dominant_categories[0]).toBe('shopping');
    expect(alexOutput.plan.personality.dominant_categories[0]).toBe('groceries');

    // 5. Verify reports/personalisation.md exists and documents both personas
    const { facts: samFacts, days: samDays, transactions: samTransactions } = loadSamDataset();
    const samOutput = planStory({
      personName: 'Sam',
      year: 2025,
      facts: samFacts,
      days: samDays,
      transactions: samTransactions,
    });
    const reportMd = buildPersonalisationComparisonMarkdown(
      samOutput,
      samFacts,
      alexOutput,
      alexFacts
    );
    expect(reportMd).toContain('The Studio-Building Regular');
    expect(reportMd).toContain('The Trail-Running Home Chef');
    expect(fs.existsSync(path.join(REPORTS_DIR, 'personalisation.md'))).toBe(true);
  });

  it('supports runStoryGeneration in-memory without writing files and covers fallback personality branches', async () => {
    const genResult = await runStoryGeneration({ writeOutputs: false });
    expect(genResult.samOutput.plan.chapters.length).toBe(13);
    expect(genResult.alexOutput.plan.chapters.length).toBe(11);

    // Verify fallback branches of derivePersonalityProfile & deriveOneLineTemplate
    const minimalFacts: Fact[] = [
      {
        id: 'year_number',
        label: 'Year',
        value: 2025,
        unit: 'count',
        formatted: '2025',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'total_transactions_count',
        label: 'Txns',
        value: 100,
        unit: 'count',
        formatted: '100',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'discretionary_spend_usd',
        label: 'Spend',
        value: 500000,
        unit: 'usd_cents',
        formatted: '$5,000',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'top_merchant_name',
        label: 'Top Merchant',
        value: 'Local Cafe',
        unit: 'text',
        formatted: 'Local Cafe',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'visits_top_merchant',
        label: 'Visits',
        value: 25,
        unit: 'count',
        formatted: '25',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'spend_top_merchant',
        label: 'Spend Top',
        value: 15000,
        unit: 'usd_cents',
        formatted: '$150',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'savings_invest_total_usd',
        label: 'Savings',
        value: 100000,
        unit: 'usd_cents',
        formatted: '$1,000',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'no_spend_days_count',
        label: 'No Spend Days',
        value: 200,
        unit: 'days',
        formatted: '200',
        txn_ids: ['T1'],
        computation: 'test',
      },
      {
        id: 'longest_spend_streak_days',
        label: 'Streak',
        value: 10,
        unit: 'days',
        formatted: '10',
        txn_ids: ['T1'],
        computation: 'test',
      },
    ];
    const map = new Map(minimalFacts.map((f) => [f.id, f]));
    const fallbackProfile = derivePersonalityProfile(map, 2025);
    expect(fallbackProfile.title).toBe('The Intentional Rhythm Maker');
    const fallbackOneLine = deriveOneLineTemplate(map);
    expect(fallbackOneLine).toContain('anchored your routine {fact:visits_top_merchant} times');
  });
});
