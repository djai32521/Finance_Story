/**
 * Data contracts for "An app just for me" — a year in money.
 * Single source of truth for Pipeline, Story Planner, UI, and Ask Your Year.
 */

export const CATEGORIES = [
  'rent',
  'bills',
  'groceries',
  'eating out',
  'takeaway',
  'coffee',
  'transport',
  'travel',
  'shopping',
  'subscriptions',
  'health',
  'fun',
  'gifts',
  'fees',
  'savings',
  'transfers',
  'income',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Per Section 6.1: "Discretionary" means everything except rent, bills, fees, savings and transfers (and income).
 */
export const NON_DISCRETIONARY_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'rent',
  'bills',
  'fees',
  'savings',
  'transfers',
  'income',
]);

export const DISCRETIONARY_CATEGORIES: readonly Category[] = CATEGORIES.filter(
  (c) => !NON_DISCRETIONARY_CATEGORIES.has(c)
);

export function isDiscretionaryCategory(category: Category): boolean {
  return !NON_DISCRETIONARY_CATEGORIES.has(category);
}

export type Direction = 'out' | 'in';

export interface RawSourceRow {
  id: string;
  date: string;
  posted_date: string;
  account: string;
  tran_type: string;
  description: string;
  amount: string;
  currency: string;
}

export interface Transaction {
  id: string;
  date: string; // ISO YYYY-MM-DD
  posted_date?: string; // ISO YYYY-MM-DD
  time?: string; // Optional HH:MM (undefined when CSV has no times)
  account?: 'Credit card' | 'Savings' | string;
  tran_type?: string;
  /**
   * Magnitude in minor units (integer US cents, always >= 0).
   * Direction ("out" | "in") indicates whether money left or entered the account.
   */
  amount_minor: number;
  currency: 'USD' | string;
  direction: Direction;
  raw_description: string;
  /**
   * Privacy-safe, cleaned display merchant/counterparty name (never contains account numbers,
   * card numbers, references, or unmasked full names of individuals).
   */
  merchant: string;
  merchant_confidence: number;
  category: Category;
  /**
   * Optional human-readable B2B department, cost center, or custom category label
   * discovered from the uploaded dataset (e.g. "Cloud & Infrastructure", "R&D", "Enterprise ARR").
   */
  category_label?: string;
  category_confidence: number;
  is_recurring: boolean;
  is_transfer: boolean;
  is_refund: boolean;
  /**
   * Optional foreign currency metadata parsed from inline description.
   */
  fx?: {
    foreign_amount_minor: number;
    foreign_currency: string;
    rate: number;
  };
  source_row: RawSourceRow;
}

export type BusinessArchetype =
  | 'saas_arr'
  | 'ecommerce_gmv'
  | 'enterprise_pnl'
  | 'agency_services'
  | 'ops_supply_chain'
  | 'general_ledger'
  | 'consumer_personal';

export interface BusinessMetadata {
  entity_name: string;
  fiscal_period_label: string;
  archetype: BusinessArchetype;
  archetype_label: string;
  currency_code: string;
  currency_symbol: string;
  milestone_label: string;
  milestone_singular: string;
  outflow_label: string;
  inflow_label: string;
  counterparty_label: string;
  source_files: string[];
  generated_by: 'deterministic' | 'gemini_enriched' | 'managed_agent';
  agent_audit_notes?: string[];
}

export const DEFAULT_B2B_CATEGORY_LABELS: Record<Category, string> = {
  rent: 'Facilities & Real Estate',
  bills: 'Core Utilities & Telecom',
  groceries: 'Workplace & Office Ops',
  'eating out': 'Client & Team Hospitality',
  takeaway: 'Field & On-Demand Catering',
  coffee: 'Daily Team Fuel & Perks',
  transport: 'Logistics & Fleet',
  travel: 'Global Ops & Executive Travel',
  shopping: 'CapEx, Hardware & Equipment',
  subscriptions: 'Cloud & SaaS Stack',
  health: 'Benefits & Workforce Wellness',
  fun: 'Events, Summits & Offsites',
  gifts: 'Client & Partner Gifting',
  fees: 'Payment Processing & Banking Fees',
  savings: 'Treasury & Capital Reserves',
  transfers: 'Intercompany & Internal Transfers',
  income: 'Revenue & Gross Inflows',
};

export function getCategoryDisplayLabel(
  category: string,
  customLabels?: Record<string, string>,
  isB2B = false
): string {
  if (customLabels && customLabels[category]) {
    return customLabels[category]!;
  }
  if (isB2B && category in DEFAULT_B2B_CATEGORY_LABELS) {
    return DEFAULT_B2B_CATEGORY_LABELS[category as Category];
  }
  return category;
}

export interface Day {
  date: string; // ISO YYYY-MM-DD (2025-01-01 .. 2025-12-31)
  weekday: number; // 0 = Monday .. 6 = Sunday
  week_index: number; // 0 .. 52 (column in 53x7 grid)
  discretionary_out_minor: number; // Integer cents of discretionary spending ("out", non-refund, non-transfer)
  all_out_minor: number; // Integer cents of all non-transfer "out" transactions
  in_minor: number; // Integer cents of all non-transfer, non-refund "in" transactions
  txn_ids: string[];
  is_payday: boolean;
}

export type FactUnit =
  | 'usd_cents'
  | 'usd'
  | 'count'
  | 'days'
  | 'percent'
  | 'ratio'
  | 'year'
  | 'date'
  | 'text';

export interface Fact {
  id: string;
  label: string;
  value: number | string;
  unit: FactUnit;
  /**
   * Deterministic pre-formatted display string (e.g. "$2,184", "$572.80", "72", "3.1×", "2025")
   * produced by the pipeline so UI code never performs arithmetic on money.
   */
  formatted: string;
  txn_ids: string[];
  computation: string;
}

/**
 * Deterministic money formatting helper (integer cents -> display string).
 * Placed in contracts so pipeline, query executor, and tests use identical formatting.
 */
export function formatMoneyMinor(
  amountMinor: number,
  options: { showCents?: boolean; prefix?: string } = {}
): string {
  const absMinor = Math.abs(Math.round(amountMinor));
  const prefix = options.prefix ?? '$';
  const showCents = options.showCents ?? absMinor % 100 !== 0;
  const dollars = Math.floor(absMinor / 100);
  const cents = absMinor % 100;
  const dollarsFormatted = dollars.toLocaleString('en-US');
  if (showCents) {
    return `${prefix}${dollarsFormatted}.${String(cents).padStart(2, '0')}`;
  }
  return `${prefix}${dollarsFormatted}`;
}
