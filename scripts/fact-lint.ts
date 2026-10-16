import fs from 'node:fs';
import path from 'node:path';
import type { Fact, StoryPlan } from '../contracts/index.js';
import { buildMockDataset } from '../data/mock/index.js';

/**
 * Rule 1 Fact Lint:
 * Fails if any copy template in StoryPlan (headline, body, one_line, personality.subtitle,
 * or sublabel_template) contains raw digits outside of `{fact:id}` placeholders, or if any
 * referenced `{fact:id}` does not exist in the computed facts list or lacks backing `txn_ids`.
 */
export function lintStoryPlanAgainstFacts(
  plan: StoryPlan,
  facts: readonly Fact[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const factMap = new Map<string, Fact>(facts.map((f) => [f.id, f]));

  const checkCopyString = (label: string, copyText: string, allowedFactIds?: string[]) => {
    // Extract all {fact:xyz} placeholders
    const placeholderRegex = /\{fact:([a-zA-Z0-9_]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = placeholderRegex.exec(copyText)) !== null) {
      const factId = match[1]!;
      const fact = factMap.get(factId);
      if (!fact) {
        errors.push(`${label}: references unknown fact "{fact:${factId}}"`);
      } else if (!Array.isArray(fact.txn_ids) || fact.txn_ids.length === 0) {
        errors.push(`${label}: fact "${factId}" has no traceable txn_ids`);
      }
      if (allowedFactIds && !allowedFactIds.includes(factId)) {
        errors.push(
          `${label}: references "{fact:${factId}}" which is not listed in chapter.fact_ids`
        );
      }
    }

    // Strip all {fact:xyz} placeholders and check if any digit [0-9] remains!
    const stripped = copyText.replace(placeholderRegex, '');
    if (/\d/.test(stripped)) {
      errors.push(
        `${label}: contains raw un-sourced digit(s) outside {fact:...} placeholder -> "${copyText}"`
      );
    }
  };

  if (!factMap.has(plan.year_fact_id)) {
    errors.push(`plan.year_fact_id "${plan.year_fact_id}" is not in facts`);
  }

  checkCopyString('plan.one_line', plan.one_line);
  checkCopyString('plan.personality.title', plan.personality.title);
  checkCopyString('plan.personality.subtitle', plan.personality.subtitle);

  for (const ch of plan.chapters) {
    checkCopyString(`chapter[${ch.id}].headline`, ch.headline, ch.fact_ids);
    checkCopyString(`chapter[${ch.id}].body`, ch.body, ch.fact_ids);
    if (ch.params.subheadline) {
      checkCopyString(`chapter[${ch.id}].params.subheadline`, ch.params.subheadline, ch.fact_ids);
    }
    if (ch.params.blocks) {
      for (const blk of ch.params.blocks) {
        if (!factMap.has(blk.fact_id)) {
          errors.push(
            `chapter[${ch.id}] block "${blk.label}" references missing fact "${blk.fact_id}"`
          );
        }
        if (blk.sublabel_template) {
          checkCopyString(
            `chapter[${ch.id}] block "${blk.label}" sublabel_template`,
            blk.sublabel_template,
            blk.sublabel_fact_ids ?? ch.fact_ids
          );
        }
      }
    }
    for (const fid of ch.fact_ids) {
      if (!factMap.has(fid)) {
        errors.push(`chapter[${ch.id}].fact_ids includes unknown fact "${fid}"`);
      }
    }
    if (!Array.isArray(ch.txn_ids) || ch.txn_ids.length === 0) {
      errors.push(`chapter[${ch.id}] has empty txn_ids (Rule 2 requires traceable receipts)`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const rootDir = path.resolve(import.meta.dirname, '..');
  const realPlanPath = path.join(rootDir, 'story', 'plan.json');
  const realFactsPath = path.join(rootDir, 'data', 'facts.json');

  // Always check mock dataset first
  const mock = buildMockDataset();
  const mockResult = lintStoryPlanAgainstFacts(mock.plan, mock.facts);
  if (!mockResult.ok) {
    console.error('Fact lint failed on mock dataset:');
    for (const err of mockResult.errors) console.error('  -', err);
    process.exit(1);
  }

  // If real story/plan.json and data/facts.json exist, check them too
  if (fs.existsSync(realPlanPath) && fs.existsSync(realFactsPath)) {
    const plan = JSON.parse(fs.readFileSync(realPlanPath, 'utf8')) as StoryPlan;
    const facts = JSON.parse(fs.readFileSync(realFactsPath, 'utf8')) as Fact[];
    const realResult = lintStoryPlanAgainstFacts(plan, facts);
    if (!realResult.ok) {
      console.error('Fact lint failed on story/plan.json:');
      for (const err of realResult.errors) console.error('  -', err);
      process.exit(1);
    }
    console.log(
      `Fact lint passed: mock plan (${mock.plan.chapters.length} chapters) + real story/plan.json (${plan.chapters.length} chapters, ${facts.length} facts).`
    );
  } else {
    console.log(
      `Fact lint passed: mock plan (${mock.plan.chapters.length} chapters, ${mock.facts.length} facts).`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
