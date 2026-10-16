import fs from 'node:fs';
import path from 'node:path';
import type { Day, Fact, StoryPlan, Transaction } from '../contracts/index.js';
import {
  buildOrUpdateMerchantCache,
  buildTransactions,
  computeDays,
  computeFacts,
  parseRawCsvContent,
  reconcileDataset,
} from '../pipeline/index.js';
import { lintStoryPlanAgainstFacts } from '../scripts/fact-lint.js';
import {
  buildPersonalisationComparisonMarkdown,
  generateAlexSyntheticCsv,
  planStory,
  type StoryPlannerOutput,
} from './planner.js';

export interface GenerateStoryResult {
  samOutput: StoryPlannerOutput;
  samFacts: Fact[];
  alexOutput: StoryPlannerOutput;
  alexFacts: Fact[];
  alexTransactions: Transaction[];
  alexDays: Day[];
}

export async function runStoryGeneration(
  options: { writeOutputs?: boolean } = {}
): Promise<GenerateStoryResult> {
  const writeOutputs = options.writeOutputs ?? true;
  const appRoot = path.resolve(import.meta.dirname, '..');
  const dataDir = path.join(appRoot, 'data');
  const mockDir = path.join(dataDir, 'mock');
  const storyDir = path.join(appRoot, 'story');
  const reportsDir = path.join(appRoot, 'reports');

  // 1. Load Sam's canonical pipeline outputs
  const samFacts = JSON.parse(fs.readFileSync(path.join(dataDir, 'facts.json'), 'utf8')) as Fact[];
  const samDays = JSON.parse(fs.readFileSync(path.join(dataDir, 'days.json'), 'utf8')) as Day[];
  const samTransactions = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'transactions.json'), 'utf8')
  ) as Transaction[];

  // 2. Plan Sam's story and verify fact-lint
  const samOutput = planStory({
    facts: samFacts,
    days: samDays,
    transactions: samTransactions,
    personaName: 'Sam',
    year: 2025,
  });

  const samLint = lintStoryPlanAgainstFacts(samOutput.plan, samFacts);
  if (!samLint.ok) {
    throw new Error(
      `Sam's StoryPlan failed fact-lint (${samLint.errors.length} error(s)):\n${samLint.errors
        .map((e) => `  - ${e}`)
        .join('\n')}`
    );
  }

  // 3. Load or generate Alex's synthetic 2025 CSV and run through the exact same pipeline + planner
  const alexCsvPath = path.join(mockDir, 'alex_2025.csv');
  const alexCsvContent = fs.existsSync(alexCsvPath)
    ? fs.readFileSync(alexCsvPath, 'utf8')
    : generateAlexSyntheticCsv();
  const alexRawRows = parseRawCsvContent(alexCsvContent);
  const alexCache = await buildOrUpdateMerchantCache(alexRawRows);
  const alexTransactions = buildTransactions(alexRawRows, alexCache);
  const alexDays = computeDays(alexTransactions, 2025);
  const alexFacts = computeFacts(alexTransactions, alexDays, 2025);
  const alexReconciliation = reconcileDataset(alexRawRows, alexTransactions, alexDays, alexFacts);

  if (!alexReconciliation.ok) {
    throw new Error(
      `Alex dataset reconciliation failed: diffSignedMinor=${alexReconciliation.diffSignedMinor}, privacyViolations=${alexReconciliation.privacyViolations.join('; ')}`
    );
  }

  const alexOutput = planStory({
    facts: alexFacts,
    days: alexDays,
    transactions: alexTransactions,
    personaName: 'Alex',
    year: 2025,
  });

  const alexLint = lintStoryPlanAgainstFacts(alexOutput.plan, alexFacts);
  if (!alexLint.ok) {
    throw new Error(
      `Alex's StoryPlan failed fact-lint (${alexLint.errors.length} error(s)):\n${alexLint.errors
        .map((e) => `  - ${e}`)
        .join('\n')}`
    );
  }

  // 4. Write all outputs if requested
  if (writeOutputs) {
    fs.mkdirSync(storyDir, { recursive: true });
    fs.mkdirSync(mockDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    const writePlanJson = (targetPath: string, plan: StoryPlan) => {
      fs.writeFileSync(targetPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');
    };

    writePlanJson(path.join(storyDir, 'plan.json'), samOutput.plan);
    fs.writeFileSync(path.join(storyDir, 'rationale.md'), samOutput.rationaleMarkdown, 'utf8');

    if (!fs.existsSync(alexCsvPath)) {
      fs.writeFileSync(alexCsvPath, alexCsvContent, 'utf8');
    }
    writePlanJson(path.join(storyDir, 'alex_plan.json'), alexOutput.plan);

    const personalisationReport = buildPersonalisationComparisonMarkdown(
      samOutput,
      samFacts,
      alexOutput,
      alexFacts
    );
    fs.writeFileSync(path.join(reportsDir, 'personalisation.md'), personalisationReport, 'utf8');
  }

  return {
    samOutput,
    samFacts,
    alexOutput,
    alexFacts,
    alexTransactions,
    alexDays,
  };
}

async function main() {
  const result = await runStoryGeneration({ writeOutputs: true });
  console.log(
    `Story Planner completed:\n` +
      `  - Sam: ${result.samOutput.plan.chapters.length} chapters, personality="${result.samOutput.plan.personality.title}", fact-lint=0 errors\n` +
      `  - Alex: ${result.alexTransactions.length} txns, ${result.alexOutput.plan.chapters.length} chapters, personality="${result.alexOutput.plan.personality.title}", fact-lint=0 errors`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
