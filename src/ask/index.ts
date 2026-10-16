/**
 * Barrel exports for "Ask your year" (`src/ask/index.ts`).
 */

import type { Transaction } from '../../contracts/data.js';
import type { AskQueryResult } from '../../contracts/query.js';
import { executeAskQuery } from './executor.js';
import { parseQuestionToDSL } from './nl-parser.js';

export * from './validator.js';
export * from './executor.js';
export * from './nl-parser.js';
export * from './ask-view.js';

/**
 * Convenience helper: parse a natural-language question deterministically into
 * `AskQueryDSL` and execute it against `transactions`.
 */
export function answerQuestionDeterministically(
  question: string,
  transactions: readonly Transaction[]
): AskQueryResult {
  const dsl = parseQuestionToDSL(question);
  return executeAskQuery(dsl, transactions, {
    question,
    source: 'deterministic',
  });
}
