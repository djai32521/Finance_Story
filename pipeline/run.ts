import fs from 'node:fs';
import path from 'node:path';
import type { Day, Fact, Transaction } from '../contracts/index.js';
import {
  buildOrUpdateMerchantCache,
  buildTransactions,
  computeDays,
  computeFacts,
  parseCsvFile,
  reconcileDataset,
  type ReconciliationResult,
} from './index.js';

export interface PipelineRunOptions {
  csvPath?: string;
  dataDir?: string;
  reportsDir?: string;
  year?: number;
  writeOutputs?: boolean;
}

export interface PipelineRunOutput {
  transactions: Transaction[];
  days: Day[];
  facts: Fact[];
  reconciliation: ReconciliationResult;
}

export async function runPipeline(options: PipelineRunOptions = {}): Promise<PipelineRunOutput> {
  const appRoot = path.resolve(import.meta.dirname, '..');
  const csvPath = options.csvPath ?? path.resolve(appRoot, '..', 'data', 'transactions_2025.csv');
  const dataDir = options.dataDir ?? path.join(appRoot, 'data');
  const reportsDir = options.reportsDir ?? path.join(appRoot, 'reports');
  const year = options.year ?? 2025;
  const writeOutputs = options.writeOutputs ?? true;

  const rawRows = parseCsvFile(csvPath);
  const cachePath = writeOutputs ? path.join(dataDir, 'merchant_cache.json') : undefined;

  if (writeOutputs) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const cache = await buildOrUpdateMerchantCache(rawRows, cachePath);
  const transactions = buildTransactions(rawRows, cache);
  const days = computeDays(transactions, year);
  const facts = computeFacts(transactions, days, year);
  const reconciliation = reconcileDataset(rawRows, transactions, days, facts);

  if (!reconciliation.ok) {
    throw new Error(
      `Reconciliation failed! diffSignedMinor=${reconciliation.diffSignedMinor}, privacyViolations=${reconciliation.privacyViolations.join('; ')}`
    );
  }

  if (writeOutputs) {
    fs.writeFileSync(
      path.join(dataDir, 'transactions.json'),
      JSON.stringify(transactions, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dataDir, 'days.json'), JSON.stringify(days, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(dataDir, 'facts.json'),
      JSON.stringify(facts, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(path.join(reportsDir, 'reconciliation.md'), reconciliation.markdown, 'utf8');
  }

  return { transactions, days, facts, reconciliation };
}

async function main() {
  const result = await runPipeline();
  console.log(
    `Pipeline completed: ${result.transactions.length} transactions, ${result.days.length} days, ${result.facts.length} facts. Reconciliation diff = $0.00 (ok=${result.reconciliation.ok}).`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
