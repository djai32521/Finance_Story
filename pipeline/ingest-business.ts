import {
  CATEGORIES,
  DEFAULT_B2B_CATEGORY_LABELS,
  type BusinessArchetype,
  type BusinessMetadata,
  type Category,
  type DatasetBundle,
  type Fact,
  type GeminiNarrativeOverride,
  type IngestEnrichResponse,
  type RawIngestFile,
  type RawSourceRow,
  type Transaction,
} from '../contracts/index.js';
import { planStory } from '../story/planner.js';
import { buildTransactions } from './categorise.js';
import type { MerchantClassificationEntry } from './clean-merchants.js';
import { computeDays } from './compute-days.js';
import { computeFacts } from './compute-facts.js';
import { parseUniversalBusinessData } from './parse.js';
import { convertXlsxToCsvIngestFiles } from './xlsx.js';

export interface IngestBusinessOptions {
  entityName?: string;
  fiscalYear?: number;
  archetype?: BusinessArchetype;
  isB2B?: boolean;
  selectedChapters?: readonly string[];
}

const ARCHETYPE_METADATA: Record<
  BusinessArchetype,
  {
    archetype_label: string;
    milestone_label: string;
    milestone_singular: string;
    outflow_label: string;
    inflow_label: string;
    counterparty_label: string;
  }
> = {
  saas_arr: {
    archetype_label: 'Cloud & SaaS Operating Ledger',
    milestone_label: 'ARR & Stripe Settlements',
    milestone_singular: 'ARR Settlement',
    outflow_label: 'Cloud, R&D & GTM Outflow',
    inflow_label: 'ARR & Subscription Inflows',
    counterparty_label: 'Cloud / SaaS Vendor',
  },
  ecommerce_gmv: {
    archetype_label: 'Omnichannel Commerce & GMV',
    milestone_label: 'Merchant Payouts',
    milestone_singular: 'Payout',
    outflow_label: 'Inventory, Fulfillment & CAC Outflow',
    inflow_label: 'GMV & Settlement Inflows',
    counterparty_label: 'Supplier / Channel Partner',
  },
  enterprise_pnl: {
    archetype_label: 'Enterprise P&L & Operations',
    milestone_label: 'Settlements & Closes',
    milestone_singular: 'Settlement',
    outflow_label: 'Total Operating Outflow',
    inflow_label: 'Gross Inflows & Revenue',
    counterparty_label: 'Vendor / Counterparty',
  },
  agency_services: {
    archetype_label: 'Professional Services & Client Delivery',
    milestone_label: 'Client Retainer Settlements',
    milestone_singular: 'Retainer Settlement',
    outflow_label: 'Delivery, Talent & OpEx Outflow',
    inflow_label: 'Client Retainers & Billings',
    counterparty_label: 'Subcontractor / Partner',
  },
  ops_supply_chain: {
    archetype_label: 'Supply Chain & Logistics Operations',
    milestone_label: 'Carrier & Warehouse Clears',
    milestone_singular: 'Settlement',
    outflow_label: 'Freight, Fleet & Procurement Outflow',
    inflow_label: 'Distribution & Receivables Inflow',
    counterparty_label: 'Carrier / Supplier',
  },
  general_ledger: {
    archetype_label: 'Corporate General Ledger',
    milestone_label: 'Treasury Settlements',
    milestone_singular: 'Settlement',
    outflow_label: 'Gross Operating Outflow',
    inflow_label: 'Gross Operating Inflow',
    counterparty_label: 'Counterparty',
  },
  consumer_personal: {
    archetype_label: 'Personal Finance Ledger',
    milestone_label: 'Paydays',
    milestone_singular: 'Payday',
    outflow_label: 'Total Outgoing Spend',
    inflow_label: 'Salary & Income',
    counterparty_label: 'Merchant',
  },
};

export function detectBusinessArchetype(
  transactions: readonly Transaction[],
  sourceFiles: readonly string[] = [],
  explicitArchetype?: BusinessArchetype
): BusinessArchetype {
  if (explicitArchetype && ARCHETYPE_METADATA[explicitArchetype]) {
    return explicitArchetype;
  }

  const fileCorpus = sourceFiles.join(' ').toLowerCase();
  if (/saas|arr|cloud/.test(fileCorpus)) return 'saas_arr';
  if (/ecom|gmv|shopify|retail/.test(fileCorpus)) return 'ecommerce_gmv';
  if (/supply|logistics|freight|fleet/.test(fileCorpus)) return 'ops_supply_chain';
  if (/agency|consulting|services/.test(fileCorpus)) return 'agency_services';

  let saasScore = 0;
  let ecomScore = 0;
  let supplyScore = 0;
  let agencyScore = 0;
  let enterpriseScore = 0;

  for (const t of transactions) {
    const text = `${t.merchant} ${t.raw_description} ${t.category_label ?? ''}`;
    if (
      /AWS|Google Cloud|Microsoft Azure|Datadog|Snowflake|OpenAI|Anthropic|Linear|GitHub|Vercel|Cloudflare|ARR|SaaS/i.test(
        text
      )
    ) {
      saasScore += 2;
    }
    if (
      /Shopify|Inventory|Fulfillment|GMV|Merchandise|Meta Ads|Google Ads|TikTok Ads/i.test(text)
    ) {
      ecomScore += 2;
    }
    if (/FedEx|DHL|UPS|Maersk|Flexport|Freight|Customs|Logistics|Carrier|Warehouse/i.test(text)) {
      supplyScore += 2;
    }
    if (/Deloitte|Wilson Sonsini|Retainer|Advisory|Consulting|Agency|Subcontractor/i.test(text)) {
      agencyScore += 2;
    }
    if (/Gusto|Rippling|ADP|WeWork|CBRE|Payroll|Enterprise/i.test(text)) {
      enterpriseScore += 1.5;
    }
  }

  const candidates: Array<{ archetype: BusinessArchetype; score: number }> = [
    { archetype: 'saas_arr', score: saasScore },
    { archetype: 'ecommerce_gmv', score: ecomScore },
    { archetype: 'ops_supply_chain', score: supplyScore },
    { archetype: 'agency_services', score: agencyScore },
    { archetype: 'enterprise_pnl', score: enterpriseScore },
  ];
  candidates.sort((a, b) => b.score - a.score);

  if (candidates[0] && candidates[0].score >= 4) {
    return candidates[0].archetype;
  }
  return transactions.length > 0 ? 'enterprise_pnl' : 'general_ledger';
}

/**
 * Verifies that a narrative template string contains no raw un-sourced numbers
 * outside `{fact:id}` placeholders, and that every referenced `{fact:id}` exists in `factsMap`.
 */
export function verifyFactPlaceholders(
  template: string,
  factsMap: ReadonlyMap<string, Fact>,
  fallbackTemplate: string
): { valid: boolean; reason?: string; sanitized: string } {
  if (!template || typeof template !== 'string') {
    return { valid: false, reason: 'Empty template', sanitized: fallbackTemplate };
  }
  const tokenRegex = /\{fact:([a-zA-Z0-9_]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(template)) !== null) {
    const factId = match[1]!;
    if (!factsMap.has(factId)) {
      return {
        valid: false,
        reason: `Unknown fact placeholder {fact:${factId}}`,
        sanitized: fallbackTemplate,
      };
    }
  }
  // Strip valid {fact:...} tokens and check if raw digits remain
  const stripped = template.replace(/\{fact:[a-zA-Z0-9_]+\}/g, '');
  if (/\d/.test(stripped)) {
    return {
      valid: false,
      reason: 'Template contains raw un-sourced digits outside {fact:id} tokens',
      sanitized: fallbackTemplate,
    };
  }
  return { valid: true, sanitized: template };
}

/**
 * Deterministic Tier 1 ingestion entry point (browser & server compatible).
 * Supports multi-table CSV, TSV, semicolon-separated, and JSON business ledgers.
 */
export function ingestFilesDeterministically(
  files: readonly RawIngestFile[],
  options: IngestBusinessOptions = {}
): DatasetBundle {
  const allRows: RawSourceRow[] = [];
  const mergedCategoryHints: Record<string, string> = {};
  let xlsxEntityHint: string | undefined;

  for (const file of files) {
    if (!file.content) continue;
    const lowerName = file.name.toLowerCase();
    const isExcel =
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      Boolean(file.mimeType && /spreadsheetml|excel/i.test(file.mimeType));

    if (isExcel) {
      const converted = convertXlsxToCsvIngestFiles(file.content, file.name);
      if (converted.entityNameHint && !xlsxEntityHint) {
        xlsxEntityHint = converted.entityNameHint;
      }
      for (const csvFile of converted.files) {
        const parsed = parseUniversalBusinessData(csvFile.content, csvFile.name);
        allRows.push(...parsed.rows);
        Object.assign(mergedCategoryHints, parsed.categoryHints);
      }
      continue;
    }

    if (file.encoding === 'base64') continue;
    const parsed = parseUniversalBusinessData(file.content, file.name);
    allRows.push(...parsed.rows);
    Object.assign(mergedCategoryHints, parsed.categoryHints);
  }

  return buildDatasetBundleFromRows(
    allRows,
    files.map((f) => f.name),
    {},
    {
      ...options,
      entityName: options.entityName?.trim() || xlsxEntityHint,
    },
    mergedCategoryHints
  );
}

export function buildDatasetBundleFromRows(
  rows: readonly RawSourceRow[],
  sourceFiles: string[],
  customCache: Record<string, MerchantClassificationEntry> = {},
  options: IngestBusinessOptions = {},
  categoryHints: Readonly<Record<string, string>> = {}
): DatasetBundle {
  const transactions = buildTransactions(rows, customCache, categoryHints);

  let dominantYear = 2025;
  if (transactions.length > 0) {
    const yearCounts = new Map<number, number>();
    for (const t of transactions) {
      const y = Number.parseInt(t.date.slice(0, 4), 10);
      if (y >= 1990 && y <= 2100) {
        yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
      }
    }
    const sortedYears = [...yearCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedYears[0]) dominantYear = sortedYears[0][0];
  }

  const inferredYear = options.fiscalYear ?? dominantYear;
  const isB2B = options.isB2B ?? true;
  const days = computeDays(transactions, inferredYear);
  const facts = computeFacts(transactions, days, inferredYear, { isB2B });
  const factMap = new Map(facts.map((f) => [f.id, f]));

  const entityName =
    options.entityName?.trim() || inferEntityNameFromFiles(sourceFiles) || 'Enterprise Operations';

  const detectedArchetype = detectBusinessArchetype(transactions, sourceFiles, options.archetype);
  const archetypeMeta = ARCHETYPE_METADATA[detectedArchetype];

  const currencyCode = transactions[0]?.currency || 'USD';
  const currencySymbol =
    currencyCode === 'EUR'
      ? '€'
      : currencyCode === 'GBP'
        ? '£'
        : currencyCode === 'AUD' || currencyCode === 'CAD'
          ? `${currencyCode}$`
          : 'US$';

  const firstDayYear = days[0] ? Number.parseInt(days[0].date.slice(0, 4), 10) : inferredYear;
  const lastDayYear = days[days.length - 1]
    ? Number.parseInt(days[days.length - 1]!.date.slice(0, 4), 10)
    : inferredYear;
  const fiscalPeriodLabel =
    firstDayYear !== lastDayYear
      ? `FY ${firstDayYear}–${String(lastDayYear).slice(-2)}`
      : `FY ${inferredYear}`;

  const businessMeta: BusinessMetadata = {
    entity_name: entityName,
    fiscal_period_label: fiscalPeriodLabel,
    archetype: detectedArchetype,
    archetype_label: archetypeMeta.archetype_label,
    currency_code: currencyCode,
    currency_symbol: currencySymbol,
    milestone_label: archetypeMeta.milestone_label,
    milestone_singular: archetypeMeta.milestone_singular,
    outflow_label: archetypeMeta.outflow_label,
    inflow_label: archetypeMeta.inflow_label,
    counterparty_label: archetypeMeta.counterparty_label,
    source_files: sourceFiles,
    generated_by: 'deterministic',
  };

  const categoryLabels: Record<string, string> = { ...DEFAULT_B2B_CATEGORY_LABELS };
  for (const cat of CATEGORIES) {
    const labelCounts = new Map<string, number>();
    for (const t of transactions) {
      if (t.category === cat && t.category_label) {
        labelCounts.set(t.category_label, (labelCounts.get(t.category_label) ?? 0) + 1);
      }
    }
    const topCustomLabel = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topCustomLabel) {
      categoryLabels[cat] = topCustomLabel;
    }
  }

  const { plan } = planStory({
    personName: entityName,
    year: inferredYear,
    facts,
    days,
    transactions,
    isB2B,
    businessMeta,
    categoryLabels,
    selectedChapters: options.selectedChapters,
  });

  const topVendor = factMap.get('top_merchant_name')?.formatted ?? 'our top vendor';
  const bigOneVendor = factMap.get('big_one_merchant')?.formatted ?? topVendor;
  const topCatSlug = String(factMap.get('top_category_name')?.value ?? 'shopping');
  const topCatLabel = categoryLabels[topCatSlug] ?? topCatSlug;

  plan.business_meta = businessMeta;
  plan.category_labels = categoryLabels;
  plan.sample_questions = [
    `What drove our total spend with ${topVendor} and can you show the underlying invoices?`,
    `How did our Q1 vs Q4 operating outflow compare across ${topCatLabel}?`,
    `Which ledger entries make up our largest single commitment with ${bigOneVendor}?`,
    `What is our net operating cashflow across all settlement cycles in ${fiscalPeriodLabel}?`,
  ];

  return {
    transactions,
    days,
    facts,
    plan,
  };
}

export function applyGeminiEnrichmentToBundle(
  rawRows: readonly RawSourceRow[],
  files: readonly RawIngestFile[],
  enrichment: IngestEnrichResponse,
  entityNameHint?: string
): DatasetBundle {
  const mergedCategoryHints: Record<string, string> = {};
  const fallbackRows: RawSourceRow[] = [...rawRows];
  let xlsxEntityHint: string | undefined;

  for (const file of files) {
    if (!file.content) continue;
    const lowerName = file.name.toLowerCase();
    const isExcel =
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      Boolean(file.mimeType && /spreadsheetml|excel/i.test(file.mimeType));

    if (isExcel) {
      const converted = convertXlsxToCsvIngestFiles(file.content, file.name);
      if (converted.entityNameHint && !xlsxEntityHint) {
        xlsxEntityHint = converted.entityNameHint;
      }
      for (const csvFile of converted.files) {
        const parsed = parseUniversalBusinessData(csvFile.content, csvFile.name);
        if (rawRows.length === 0) {
          fallbackRows.push(...parsed.rows);
        }
        Object.assign(mergedCategoryHints, parsed.categoryHints);
      }
      continue;
    }

    if (file.encoding === 'base64') continue;
    try {
      const parsed = parseUniversalBusinessData(file.content, file.name);
      if (rawRows.length === 0) {
        fallbackRows.push(...parsed.rows);
      }
      Object.assign(mergedCategoryHints, parsed.categoryHints);
    } catch {
      // Ignore unparseable raw files when enrichment rows exist
    }
  }

  const rows =
    enrichment.extracted_rows && enrichment.extracted_rows.length > 0
      ? enrichment.extracted_rows
      : fallbackRows;

  const customCache: Record<string, MerchantClassificationEntry> = {};
  if (enrichment.entity_mappings) {
    for (const item of enrichment.entity_mappings) {
      const validCat = (CATEGORIES as readonly string[]).includes(item.category)
        ? (item.category as Category)
        : 'shopping';
      customCache[item.raw_description] = {
        merchant: item.merchant,
        category: validCat,
        merchant_confidence: 0.95,
        category_confidence: 0.95,
        is_recurring: Boolean(item.is_recurring),
        is_transfer: validCat === 'transfers',
        is_refund: false,
      };
      if (item.category_label) {
        mergedCategoryHints[item.raw_description] = item.category_label;
      }
    }
  }

  const bundle = buildDatasetBundleFromRows(
    rows,
    files.map((f) => f.name),
    customCache,
    {
      entityName: enrichment.narrative?.entity_name || entityNameHint || xlsxEntityHint,
      archetype: enrichment.narrative?.archetype,
      isB2B: true,
      selectedChapters: enrichment.narrative?.selected_chapters,
    },
    mergedCategoryHints
  );

  if (enrichment.narrative) {
    return applyGeminiNarrativeOverrides(bundle, enrichment.narrative);
  }
  return bundle;
}

export function applyGeminiNarrativeOverrides(
  bundle: DatasetBundle,
  overrides: GeminiNarrativeOverride
): DatasetBundle {
  const factsMap = new Map(bundle.facts.map((f) => [f.id, f]));
  const plan = { ...bundle.plan };

  if (overrides.entity_name) {
    plan.person_name = overrides.entity_name;
  }
  if (plan.business_meta) {
    plan.business_meta = {
      ...plan.business_meta,
      ...(overrides.entity_name ? { entity_name: overrides.entity_name } : {}),
      ...(overrides.fiscal_period_label
        ? { fiscal_period_label: overrides.fiscal_period_label }
        : {}),
      ...(overrides.archetype ? { archetype: overrides.archetype } : {}),
      ...(overrides.archetype_label ? { archetype_label: overrides.archetype_label } : {}),
      ...(overrides.currency_code ? { currency_code: overrides.currency_code } : {}),
      ...(overrides.currency_symbol ? { currency_symbol: overrides.currency_symbol } : {}),
      ...(overrides.milestone_label ? { milestone_label: overrides.milestone_label } : {}),
      ...(overrides.milestone_singular ? { milestone_singular: overrides.milestone_singular } : {}),
      ...(overrides.outflow_label ? { outflow_label: overrides.outflow_label } : {}),
      ...(overrides.inflow_label ? { inflow_label: overrides.inflow_label } : {}),
      ...(overrides.counterparty_label ? { counterparty_label: overrides.counterparty_label } : {}),
      ...(overrides.agent_audit_notes ? { agent_audit_notes: overrides.agent_audit_notes } : {}),
      generated_by: overrides.generated_by ?? 'gemini_enriched',
    };
  }

  if (overrides.category_labels) {
    plan.category_labels = {
      ...(plan.category_labels ?? {}),
      ...overrides.category_labels,
    };
  }

  if (overrides.sample_questions && overrides.sample_questions.length > 0) {
    plan.sample_questions = overrides.sample_questions;
  }

  if (overrides.one_line) {
    const check = verifyFactPlaceholders(overrides.one_line, factsMap, plan.one_line);
    plan.one_line = check.sanitized;
  }

  if (overrides.personality_title || overrides.personality_subtitle) {
    plan.personality = {
      ...plan.personality,
      ...(overrides.personality_title ? { title: overrides.personality_title } : {}),
      ...(overrides.personality_subtitle
        ? {
            subtitle: verifyFactPlaceholders(
              overrides.personality_subtitle,
              factsMap,
              plan.personality.subtitle
            ).sanitized,
          }
        : {}),
    };
  }

  if (overrides.chapter_copy) {
    const totalStr = String(plan.chapters.length).padStart(2, '0');
    plan.chapters = plan.chapters.map((ch, idx) => {
      const copy = overrides.chapter_copy?.[ch.id] ?? overrides.chapter_copy?.[ch.type];
      if (!copy) return ch;
      const chNum = String(idx + 1).padStart(2, '0');
      const formattedKicker = copy.kicker
        ? /^\d+/.test(copy.kicker.trim())
          ? copy.kicker.trim()
          : `${chNum} / ${totalStr} · ${copy.kicker.trim().replace(/^·\s*/, '').toUpperCase()}`
        : undefined;
      return {
        ...ch,
        headline: copy.headline
          ? verifyFactPlaceholders(copy.headline, factsMap, ch.headline).sanitized
          : ch.headline,
        body: copy.body ? verifyFactPlaceholders(copy.body, factsMap, ch.body).sanitized : ch.body,
        params: {
          ...ch.params,
          ...(formattedKicker ? { kicker: formattedKicker } : {}),
        },
      };
    });
  }

  return {
    ...bundle,
    plan,
  };
}

function inferEntityNameFromFiles(fileNames: string[]): string {
  const first = fileNames[0];
  if (!first) return 'Enterprise Report';
  const base = first
    .replace(/^.*[/\\]/, '')
    .replace(/\.(csv|tsv|json|txt|xlsx|xls|pdf)$/i, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  const cleaned = base
    .replace(
      /\b(20\d\d(?:\s*2\d)?|fy\s*(?:20)?\d\d|transactions|ledger|export|csv|xlsx|xls|workbook|sheet\d*|tab\d*|sales|trading|log|data|dump|sample|b2b|\d+)\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Enterprise Operations';
  return cleaned
    .split(/\s+/)
    .map((w) =>
      w.toLowerCase() === 'saas'
        ? 'SaaS'
        : /^(ai|arr|gmv|pnl|b2b|llc|inc|ltd|plc|uk|us|eu|hq|cfo)$/i.test(w)
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(' ');
}
