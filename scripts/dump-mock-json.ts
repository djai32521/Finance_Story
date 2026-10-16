import fs from 'node:fs';
import path from 'node:path';
import { buildMockDataset } from '../data/mock/index.js';

function main() {
  const mockDir = path.resolve(import.meta.dirname, '..', 'data', 'mock');
  fs.mkdirSync(mockDir, { recursive: true });
  const { transactions, days, facts, plan } = buildMockDataset();

  fs.writeFileSync(path.join(mockDir, 'transactions.json'), JSON.stringify(transactions, null, 2));
  fs.writeFileSync(path.join(mockDir, 'days.json'), JSON.stringify(days, null, 2));
  fs.writeFileSync(path.join(mockDir, 'facts.json'), JSON.stringify(facts, null, 2));
  fs.writeFileSync(path.join(mockDir, 'plan.json'), JSON.stringify(plan, null, 2));

  console.log(
    `Wrote mock dataset to ${mockDir}: ${transactions.length} transactions, ${days.length} days, ${facts.length} facts, ${plan.chapters.length} chapters.`
  );
}

main();
