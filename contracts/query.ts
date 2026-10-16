/**
 * Query DSL contracts for "Ask your year" (Section 6.3).
 */

import type { Category, Transaction } from './data.js';

export type QueryMeasure = 'sum' | 'count' | 'average' | 'max' | 'min' | 'list';
export type QueryGroupBy = 'none' | 'month' | 'weekday' | 'merchant' | 'category';

export interface QueryFilters {
  categories: Category[];
  merchants: string[];
  date_from: string | null; // ISO YYYY-MM-DD
  date_to: string | null; // ISO YYYY-MM-DD
  /**
   * Weekday indices: 0 = Monday .. 6 = Sunday.
   */
  weekdays: number[];
  time_from: string | null;
  time_to: string | null;
  /** Minimum transaction amount in minor units (integer cents), or null */
  amount_min: number | null;
  /** Maximum transaction amount in minor units (integer cents), or null */
  amount_max: number | null;
  direction: 'out' | 'in';
}

export interface AskQueryDSL {
  filters: QueryFilters;
  measure: QueryMeasure;
  group_by: QueryGroupBy;
  interpretation: string;
  answerable: boolean;
  reason_if_not: string | null;
  suggested_question?: string | null;
}

export interface GroupedQueryBucket {
  key: string;
  label: string;
  value_minor: number;
  count: number;
  formatted_value: string;
  txn_ids: string[];
}

export interface AskQueryResult {
  question: string;
  query: AskQueryDSL;
  answerable: boolean;
  reason_if_not: string | null;
  suggested_question: string | null;
  /**
   * Primary numeric answer in minor units (cents) for money measures (sum/average/max/min)
   * or integer count for "count" / "list".
   */
  value_minor: number;
  /**
   * Deterministic display string for the giant answer slam (e.g. "$218.40", "72", "14").
   */
  formatted_answer: string;
  unit_label: string; // e.g. "US$", "purchases", "visits"
  interpretation: string;
  matching_dates: string[];
  matching_txn_ids: string[];
  receipts: Transaction[];
  breakdown: GroupedQueryBucket[];
  source: 'model' | 'deterministic' | 'builder';
}
