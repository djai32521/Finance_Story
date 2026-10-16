/**
 * Gemini Natural-Language -> `AskQueryDSL` Translator & Tier 2 B2B Ingestion Enricher (`server/gemini.ts`)
 *
 * 1. `translateQuestionToDSL`: Dynamically builds the system prompt from the active `Transaction[]`
 *    (date range, active categories + B2B `category_label`s, top 45 merchants/counterparties)
 *    so natural-language queries work for ANY uploaded business dataset as well as Sam's 2025 dataset.
 * 2. `enrichDatasetWithGemini`: Tier 2 Gemini structured JSON enrichment for unstructured file extraction,
 *    entity/vendor/counterparty normalization across the 17 canonical category slots, and executive
 *    narrative generation strictly bound to `{fact:<id>}` placeholders.
 *
 * Rule 1: The model NEVER computes numeric answers — it only produces `AskQueryDSL` or `{fact:id}` templates.
 */

import {
  CATEGORIES,
  DEFAULT_B2B_CATEGORY_LABELS,
  type BusinessArchetype,
  type Category,
  type GeminiEntityMapping,
  type GeminiNarrativeOverride,
  type IngestEnrichRequest,
  type IngestEnrichResponse,
  type RawSourceRow,
  type Transaction,
} from '../contracts/index.js';
import type { AskQueryDSL } from '../contracts/query.js';
import { CANONICAL_MERCHANT_SPECS } from '../src/ask/executor.js';
import { parseQuestionToDSL } from '../src/ask/nl-parser.js';
import { validateAskQueryDSL } from '../src/ask/validator.js';
import { CANDIDATE_MODELS, loadServerConfig, type ServerConfig } from './config.js';

const KNOWN_MERCHANT_NAMES = CANONICAL_MERCHANT_SPECS.map((s) => s.canonical);

const VALID_ARCHETYPES: ReadonlySet<BusinessArchetype> = new Set<BusinessArchetype>([
  'saas_arr',
  'ecommerce_gmv',
  'enterprise_pnl',
  'agency_services',
  'ops_supply_chain',
  'general_ledger',
  'consumer_personal',
]);

/**
 * Build a dataset-aware system prompt for `translateQuestionToDSL`.
 * Extracts actual date range, active categories + custom B2B `category_label`s,
 * and top 45 merchant/counterparty names by spend/count.
 */
export function buildDynamicAskSystemPrompt(transactions?: readonly Transaction[]): string {
  let minDate = '2025-01-01';
  let maxDate = '2025-12-31';
  let yearsLabel = '2025';
  let categorySummary = CATEGORIES.join(', ');
  let merchantList = KNOWN_MERCHANT_NAMES;

  if (transactions && transactions.length > 0) {
    const dates = transactions
      .map((t) => t.date)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    if (dates.length > 0) {
      minDate = dates[0]!;
      maxDate = dates[dates.length - 1]!;
      const distinctYears = Array.from(new Set(dates.map((d) => d.slice(0, 4))));
      yearsLabel = distinctYears.join(', ');
    }

    // Collect distinct categories and any custom B2B category_label mappings
    const catLabels = new Map<Category, string>();
    for (const t of transactions) {
      if (!catLabels.has(t.category)) {
        catLabels.set(t.category, t.category_label ?? '');
      } else if (t.category_label && !catLabels.get(t.category)) {
        catLabels.set(t.category, t.category_label);
      }
    }
    categorySummary = CATEGORIES.map((c) => {
      const custom = catLabels.get(c);
      return custom && custom.toLowerCase() !== c ? `${c} (also called "${custom}")` : c;
    }).join(', ');

    // Rank top 45 merchants/counterparties by total spend and frequency
    const merchantStats = new Map<string, { spend: number; count: number }>();
    for (const t of transactions) {
      const m = t.merchant?.trim();
      if (!m) continue;
      const prev = merchantStats.get(m) ?? { spend: 0, count: 0 };
      prev.spend += t.amount_minor;
      prev.count += 1;
      merchantStats.set(m, prev);
    }

    const topMerchants = Array.from(merchantStats.entries())
      .sort((a, b) => b[1].spend - a[1].spend || b[1].count - a[1].count)
      .slice(0, 45)
      .map(([name]) => name);

    if (topMerchants.length > 0) {
      merchantList = Array.from(new Set([...topMerchants, ...KNOWN_MERCHANT_NAMES])).slice(0, 60);
    }
  }

  return `You are the natural-language query translator for "Finance Story — Ask Your Ledger".
Your ONLY job is to translate a user's plain-English question into a strict JSON object matching the AskQueryDSL schema below.
NEVER compute dollar totals or transaction counts yourself — deterministic code executes your JSON query against the transactions.

### Dataset Capabilities & Strict Constraints
1. Calendar range: ${minDate} through ${maxDate} (years: ${yearsLabel}). Questions about years outside ${yearsLabel} are NOT answerable.
2. NO TIME OF DAY: The ledger CSV has transaction dates (YYYY-MM-DD) ONLY — there are NO timestamps or hours of the day. If the user asks about time of day (e.g., "after 9pm", "after 10pm", "in the morning", "late night", "before noon", "what time of day"), you MUST set "answerable": false, explain plainly in "reason_if_not" that the CSV only records dates without time-of-day timestamps, and provide a close answerable "suggested_question".
3. NO ITEMIZED RECEIPT SKUs OR BALANCES: The ledger records counterparty/merchant settlement totals, not individual grocery/line-item SKUs (milk, eggs, avocados) or running bank balances / credit scores. Mark those "answerable": false with a clear "reason_if_not" and "suggested_question".
4. Categories (exact lowercase strings): ${categorySummary}.
   - Always output the canonical lowercase category key in "filters.categories" even if the user refers to its B2B department label (e.g., "Cloud & SaaS Stack" -> "subscriptions", "Facilities & Real Estate" -> "rent", "CapEx, Hardware & Equipment" -> "shopping", "Revenue & Gross Inflows" -> "income").
5. Known merchants / counterparties in active dataset: ${merchantList.join(', ')}.
   - If the user asks about a specific merchant, vendor, or customer (e.g. "Blue Bottle Coffee", "Trader Joe's", "Uber Eats", "Monarch Acoustic", "B&H Photo", "Shell", "Brightpath", "FX Fee", or any counterparty listed above), set "filters.merchants" to ["<Merchant Name>"] and leave "filters.categories" as [] unless a category breakdown is requested.
   - For FX / international transaction fees, set "filters.merchants": ["FX Fee"].
6. Weekdays convention: 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday.
   - Weekends = [5, 6]
   - Weekdays (Mon–Fri) = [0, 1, 2, 3, 4]
7. Amounts ("amount_min", "amount_max") are integer minor units / US cents (e.g. $100 = 10000).
8. Direction: "out" for spending/operating outflows/purchases/fees/savings, "in" for income/revenue/inflows/salary/wages.

### Output Schema (AskQueryDSL JSON only)
{
  "filters": {
    "categories": [],
    "merchants": [],
    "date_from": null,
    "date_to": null,
    "weekdays": [],
    "time_from": null,
    "time_to": null,
    "amount_min": null,
    "amount_max": null,
    "direction": "out"
  },
  "measure": "sum" | "count" | "average" | "max" | "min" | "list",
  "group_by": "none" | "month" | "weekday" | "merchant" | "category",
  "interpretation": "One plain-English line describing the query",
  "answerable": true,
  "reason_if_not": null,
  "suggested_question": null
}`;
}

export const ASK_SYSTEM_PROMPT = buildDynamicAskSystemPrompt();

export interface TranslatedDSLResult {
  query: AskQueryDSL;
  source: 'model' | 'deterministic';
  modelName: string;
}

/**
 * Augment deterministic DSL with dynamic merchant/category_label matching when a custom B2B dataset is active.
 */
function augmentDeterministicDslForDataset(
  dsl: AskQueryDSL,
  question: string,
  transactions?: readonly Transaction[]
): AskQueryDSL {
  if (!dsl.answerable || !transactions || transactions.length === 0) {
    return dsl;
  }
  if (dsl.filters.merchants.length > 0 || dsl.filters.categories.length > 0) {
    return dsl;
  }

  const lowerQ = question.toLowerCase();

  // Check if any custom merchant in `transactions` is explicitly mentioned in `question`
  const distinctMerchants = Array.from(
    new Set(
      transactions
        .map((t) => t.merchant?.trim())
        .filter((m): m is string => Boolean(m && m.length >= 3))
    )
  ).sort((a, b) => b.length - a.length);

  for (const merchant of distinctMerchants) {
    if (lowerQ.includes(merchant.toLowerCase())) {
      const sampleTxn = transactions.find((t) => t.merchant === merchant);
      const direction = sampleTxn?.direction === 'in' ? 'in' : dsl.filters.direction;
      return {
        ...dsl,
        filters: {
          ...dsl.filters,
          merchants: [merchant],
          direction,
        },
        interpretation: `${merchant}, ${dsl.interpretation}`,
      };
    }
  }

  // Check if any custom B2B category_label is mentioned in `question`
  for (const t of transactions) {
    if (t.category_label && t.category_label.length >= 4) {
      if (lowerQ.includes(t.category_label.toLowerCase())) {
        return {
          ...dsl,
          filters: {
            ...dsl.filters,
            categories: [t.category],
            direction: t.category === 'income' ? 'in' : dsl.filters.direction,
          },
        };
      }
    }
  }

  return dsl;
}

function parseJsonResponseSafely(rawText: string): unknown {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Invalid JSON output from Gemini');
  }
}

/**
 * Translate a natural-language question into `AskQueryDSL` using Gemini if an API key
 * is configured, falling back deterministically to `parseQuestionToDSL` if offline or unset.
 */
export async function translateQuestionToDSL(
  question: string,
  configInput?: ServerConfig,
  transactions?: readonly Transaction[]
): Promise<TranslatedDSLResult> {
  const config = configInput ?? loadServerConfig();
  const trimmed = question.trim();

  // Always compute the deterministic parse first (also enforces unanswerable rules)
  const baseDeterministicDsl = parseQuestionToDSL(trimmed, transactions);
  const deterministicDsl = augmentDeterministicDslForDataset(
    baseDeterministicDsl,
    trimmed,
    transactions
  );

  if (!deterministicDsl.answerable || !config.apiKey) {
    return {
      query: deterministicDsl,
      source: 'deterministic',
      modelName: config.modelName,
    };
  }

  const systemPrompt = buildDynamicAskSystemPrompt(transactions);
  const candidateModels = Array.from(
    new Set(
      [config.modelName, 'gemini-4-argon', ...CANDIDATE_MODELS].filter(
        (m): m is string =>
          Boolean(m) &&
          (m === 'gemini-4-argon' || !m.startsWith('barium-')) &&
          !m.toLowerCase().includes('flash')
      )
    )
  );

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: trimmed }],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 400) {
          continue;
        }
        return {
          query: deterministicDsl,
          source: 'deterministic',
          modelName: config.modelName,
        };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      if (!rawText) {
        continue;
      }

      const parsedJson = parseJsonResponseSafely(rawText);
      const validated = validateAskQueryDSL(parsedJson, trimmed, transactions);
      if (!validated.valid) {
        return {
          query: deterministicDsl,
          source: 'deterministic',
          modelName: model,
        };
      }

      return {
        query: validated.query,
        source: 'model',
        modelName: model,
      };
    } catch {
      // Try next fallback model or fall back to deterministic
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    query: deterministicDsl,
    source: 'deterministic',
    modelName: config.modelName,
  };
}

/**
 * Sanitize narrative copy so no raw digits appear outside `{fact:<id>}` placeholders.
 */
function sanitizeFactTemplateString(
  raw: unknown,
  allowedFactIds: ReadonlySet<string>
): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim();

  // Verify every {fact:id} token is in allowedFactIds (if allowedFactIds is non-empty)
  const tokenRegex = /\{fact:([a-zA-Z0-9_]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(trimmed)) !== null) {
    const id = match[1]!;
    if (allowedFactIds.size > 0 && !allowedFactIds.has(id)) {
      return undefined;
    }
  }

  // Check if any raw digits remain outside {fact:id} tokens
  const stripped = trimmed.replace(/\{fact:[a-zA-Z0-9_]+\}/g, '');
  if (/\d/.test(stripped)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Tier 2 Gemini Ingestion Enrichment (`POST /api/ingest/enrich`):
 * - Extracts structured `RawSourceRow[]` if unstructured text/PDF/JSON files were uploaded with no `raw_rows`
 * - Normalizes `unclassified_descriptions` into `GeminiEntityMapping[]` across the 17 canonical `Category` slots
 * - Synthesizes `GeminiNarrativeOverride` with strict `{fact:<id>}` placeholder discipline
 */
export async function enrichDatasetWithGemini(
  req: IngestEnrichRequest,
  configInput?: ServerConfig
): Promise<IngestEnrichResponse> {
  const config = configInput ?? loadServerConfig();
  if (!config.apiKey) {
    return {
      source: 'deterministic',
    };
  }

  const needsRowExtraction = Boolean(
    req.files && req.files.length > 0 && (!req.raw_rows || req.raw_rows.length === 0)
  );
  const unclassified = (req.unclassified_descriptions ?? []).slice(0, 60);
  const factsSummary = (req.facts_summary ?? []).slice(0, 80);
  const allowedFactIds = new Set(factsSummary.map((f) => f.id));

  const systemInstruction = `You are the Principal Financial Data Architect and Executive Narrative Editor for "Finance Story".
You receive a business or financial ingestion request and return a strict JSON object conforming to IngestEnrichResponse.

### Strict Rules
1. Canonical Categories (17 slots): ${CATEGORIES.join(', ')}.
   - Every "category" in "entity_mappings" MUST be one of those exact 17 lowercase strings.
   - Provide a crisp B2B "category_label" (e.g. "Cloud & Infrastructure", "Enterprise ARR", "Payroll & Contractors", "Facilities & Real Estate", "CapEx & Hardware", "Growth & Marketing").
2. Entity Normalization:
   - Clean messy ERP/bank descriptions into clean counterparty/vendor/customer names in "merchant" (never include bank account numbers, wire IDs, or card suffixes).
3. Executive Narrative ("narrative"):
   - Choose "archetype" from: "saas_arr", "ecommerce_gmv", "enterprise_pnl", "agency_services", "ops_supply_chain", "general_ledger", "consumer_personal".
   - Choose "selected_chapters" (6 to 13 chapter IDs) from ["pour", "year_as_squares", "your_place", "rivalry", "subscription_garden", "getaway", "studio_session", "streak", "heartbeat", "shatter", "big_one", "personality", "one_line", "share_card"] that have the strongest financial signal in this dataset.
   - Keep every "headline" under 12 words and every "body" to a single, direct 1-sentence takeaway with zero filler or corporate jargon.
   - CRITICAL FACT-LINT RULE: Every single number, dollar amount, count, percentage, ratio, or year in "one_line", "personality_subtitle", and "chapter_copy" ("headline" and "body") MUST use a "{fact:<id>}" placeholder from the provided "facts_summary" list!
   - NEVER write raw digits (0-9) anywhere in "one_line", "personality_subtitle", or "chapter_copy.[chapter].headline" / "body"! Even "1" or "2025" or "12" is forbidden unless written as "{fact:year_number}" or another valid "{fact:<id>}" token.
   - Provide 6 tailored B2B natural-language questions in "sample_questions" that an executive or operator can ask about this dataset.`;

  const promptPayload: Record<string, unknown> = {
    entity_name_hint: req.entity_name_hint ?? 'Enterprise Operations',
    chapter_ids: req.chapter_ids ?? [
      'pour',
      'year_as_squares',
      'your_place',
      'rivalry',
      'subscription_garden',
      'getaway',
      'studio_session',
      'streak',
      'heartbeat',
      'shatter',
      'big_one',
      'personality',
      'one_line',
      'share_card',
    ],
    default_b2b_category_labels: DEFAULT_B2B_CATEGORY_LABELS,
  };

  if (needsRowExtraction && req.files) {
    promptPayload.unstructured_files = req.files.slice(0, 6).map((f) => ({
      name: f.name,
      mimeType: f.mimeType,
      encoding: f.encoding ?? 'utf8',
      contentSnippet: f.encoding === 'base64' ? '[binary attachment]' : f.content.slice(0, 12000),
    }));
  }

  if (unclassified.length > 0) {
    promptPayload.unclassified_descriptions = unclassified;
  }

  if (factsSummary.length > 0) {
    promptPayload.facts_summary = factsSummary;
  }

  const userParts: Array<Record<string, unknown>> = [];

  if (needsRowExtraction && req.files) {
    for (const file of req.files.slice(0, 3)) {
      if (file.encoding === 'base64' && file.content) {
        userParts.push({
          inlineData: {
            mimeType: file.mimeType || 'application/pdf',
            data: file.content,
          },
        });
      }
    }
  }

  userParts.push({
    text: `Return a JSON object with keys:
- "extracted_rows": ${
      needsRowExtraction
        ? 'Array of { "id": string, "date": "YYYY-MM-DD", "posted_date": "YYYY-MM-DD", "account": string, "tran_type": string, "description": string, "amount": string (signed decimal e.g. "-450.00" for outflow or "12500.00" for inflow), "currency": "USD" }'
        : '[]'
    }
- "entity_mappings": Array of { "raw_description": string, "merchant": string, "category": one of [${CATEGORIES.join(', ')}], "category_label": string, "is_recurring": boolean }
- "narrative": {
    "entity_name": string,
    "fiscal_period_label": string,
    "archetype": "saas_arr" | "ecommerce_gmv" | "enterprise_pnl" | "agency_services" | "ops_supply_chain" | "general_ledger" | "consumer_personal",
    "archetype_label": string,
    "milestone_label": string,
    "milestone_singular": string,
    "outflow_label": string,
    "inflow_label": string,
    "counterparty_label": string,
    "selected_chapters": ["6 to 13 chapter IDs chosen from chapter_ids based on dataset signal"],
    "one_line": "1 concise sentence using ONLY {fact:id} tokens for numbers (NO raw digits!)",
    "personality_title": "string (NO raw digits!)",
    "personality_subtitle": "1 concise sentence using ONLY {fact:id} tokens for numbers (NO raw digits!)",
    "chapter_copy": {
      "<chapter_id>": { "kicker": "string (no digits)", "headline": "concise headline with {fact:id} only", "body": "1 concise sentence with {fact:id} only" }
    },
    "category_labels": { "<category>": "<B2B label>" },
    "sample_questions": ["6 natural-language questions about the dataset"]
  }

Input Context:
${JSON.stringify(promptPayload, null, 2)}`,
  });

  const candidateModels = Array.from(
    new Set(
      [config.modelName, 'gemini-4-argon', ...CANDIDATE_MODELS].filter(
        (m): m is string =>
          Boolean(m) &&
          (m === 'gemini-4-argon' || !m.startsWith('barium-')) &&
          !m.toLowerCase().includes('flash')
      )
    )
  );

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: userParts,
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      if (!rawText) continue;

      const parsed = parseJsonResponseSafely(rawText) as Record<string, unknown>;

      // 1. Normalize extracted_rows
      let extracted_rows: RawSourceRow[] | undefined;
      if (Array.isArray(parsed.extracted_rows) && parsed.extracted_rows.length > 0) {
        extracted_rows = parsed.extracted_rows
          .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
          .map((r, idx) => ({
            id: typeof r.id === 'string' && r.id ? r.id : `ext_${idx + 1}`,
            date: typeof r.date === 'string' ? r.date : '2025-01-15',
            posted_date:
              typeof r.posted_date === 'string'
                ? r.posted_date
                : typeof r.date === 'string'
                  ? r.date
                  : '2025-01-15',
            account: typeof r.account === 'string' ? r.account : 'Operating Ledger',
            tran_type: typeof r.tran_type === 'string' ? r.tran_type : 'ACH',
            description: typeof r.description === 'string' ? r.description : 'Ledger Entry',
            amount:
              typeof r.amount === 'string' || typeof r.amount === 'number'
                ? String(r.amount)
                : '0.00',
            currency: typeof r.currency === 'string' ? r.currency : 'USD',
          }));
      }

      // 2. Normalize entity_mappings
      let entity_mappings: GeminiEntityMapping[] | undefined;
      if (Array.isArray(parsed.entity_mappings) && parsed.entity_mappings.length > 0) {
        entity_mappings = parsed.entity_mappings
          .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
          .map((m) => {
            const rawCat =
              typeof m.category === 'string' ? m.category.trim().toLowerCase() : 'shopping';
            const category: Category = (CATEGORIES as readonly string[]).includes(rawCat)
              ? (rawCat as Category)
              : 'shopping';
            return {
              raw_description: typeof m.raw_description === 'string' ? m.raw_description : '',
              merchant:
                typeof m.merchant === 'string' && m.merchant.trim() ? m.merchant.trim() : 'Vendor',
              category,
              category_label:
                typeof m.category_label === 'string' && m.category_label.trim()
                  ? m.category_label.trim()
                  : DEFAULT_B2B_CATEGORY_LABELS[category],
              is_recurring: Boolean(m.is_recurring),
            };
          })
          .filter((m) => m.raw_description.length > 0);
      }

      // 3. Normalize narrative with strict {fact:id} verification
      let narrative: GeminiNarrativeOverride | undefined;
      if (typeof parsed.narrative === 'object' && parsed.narrative !== null) {
        const rawN = parsed.narrative as Record<string, unknown>;
        const rawArch = typeof rawN.archetype === 'string' ? rawN.archetype : '';
        const archetype: BusinessArchetype | undefined = VALID_ARCHETYPES.has(
          rawArch as BusinessArchetype
        )
          ? (rawArch as BusinessArchetype)
          : undefined;

        const chapter_copy: Record<string, { kicker?: string; headline?: string; body?: string }> =
          {};
        if (typeof rawN.chapter_copy === 'object' && rawN.chapter_copy !== null) {
          for (const [chId, chVal] of Object.entries(
            rawN.chapter_copy as Record<string, unknown>
          )) {
            if (typeof chVal === 'object' && chVal !== null) {
              const cv = chVal as Record<string, unknown>;
              const kicker = sanitizeFactTemplateString(cv.kicker, allowedFactIds);
              const headline = sanitizeFactTemplateString(cv.headline, allowedFactIds);
              const body = sanitizeFactTemplateString(cv.body, allowedFactIds);
              if (kicker || headline || body) {
                chapter_copy[chId] = {
                  ...(kicker ? { kicker } : {}),
                  ...(headline ? { headline } : {}),
                  ...(body ? { body } : {}),
                };
              }
            }
          }
        }

        const category_labels: Record<string, string> = {};
        if (typeof rawN.category_labels === 'object' && rawN.category_labels !== null) {
          for (const [k, v] of Object.entries(rawN.category_labels as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) {
              category_labels[k] = v.trim();
            }
          }
        }

        const sample_questions = Array.isArray(rawN.sample_questions)
          ? rawN.sample_questions
              .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
              .slice(0, 6)
          : undefined;

        const selected_chapters = Array.isArray(rawN.selected_chapters)
          ? rawN.selected_chapters
              .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
              .map((c) => c.trim())
              .slice(0, 13)
          : undefined;

        narrative = {
          ...(typeof rawN.entity_name === 'string' && rawN.entity_name.trim()
            ? { entity_name: rawN.entity_name.trim() }
            : {}),
          ...(typeof rawN.fiscal_period_label === 'string' && rawN.fiscal_period_label.trim()
            ? { fiscal_period_label: rawN.fiscal_period_label.trim() }
            : {}),
          ...(archetype ? { archetype } : {}),
          ...(typeof rawN.archetype_label === 'string' && rawN.archetype_label.trim()
            ? { archetype_label: rawN.archetype_label.trim() }
            : {}),
          ...(typeof rawN.milestone_label === 'string' && rawN.milestone_label.trim()
            ? { milestone_label: rawN.milestone_label.trim() }
            : {}),
          ...(typeof rawN.milestone_singular === 'string' && rawN.milestone_singular.trim()
            ? { milestone_singular: rawN.milestone_singular.trim() }
            : {}),
          ...(typeof rawN.outflow_label === 'string' && rawN.outflow_label.trim()
            ? { outflow_label: rawN.outflow_label.trim() }
            : {}),
          ...(typeof rawN.inflow_label === 'string' && rawN.inflow_label.trim()
            ? { inflow_label: rawN.inflow_label.trim() }
            : {}),
          ...(typeof rawN.counterparty_label === 'string' && rawN.counterparty_label.trim()
            ? { counterparty_label: rawN.counterparty_label.trim() }
            : {}),
          ...(sanitizeFactTemplateString(rawN.one_line, allowedFactIds)
            ? { one_line: sanitizeFactTemplateString(rawN.one_line, allowedFactIds) }
            : {}),
          ...(sanitizeFactTemplateString(rawN.personality_title, allowedFactIds)
            ? {
                personality_title: sanitizeFactTemplateString(
                  rawN.personality_title,
                  allowedFactIds
                ),
              }
            : {}),
          ...(sanitizeFactTemplateString(rawN.personality_subtitle, allowedFactIds)
            ? {
                personality_subtitle: sanitizeFactTemplateString(
                  rawN.personality_subtitle,
                  allowedFactIds
                ),
              }
            : {}),
          ...(Object.keys(chapter_copy).length > 0 ? { chapter_copy } : {}),
          ...(Object.keys(category_labels).length > 0 ? { category_labels } : {}),
          ...(sample_questions && sample_questions.length > 0 ? { sample_questions } : {}),
          ...(selected_chapters && selected_chapters.length >= 6 ? { selected_chapters } : {}),
          generated_by: 'gemini_enriched',
        };
      }

      return {
        ...(extracted_rows ? { extracted_rows } : {}),
        ...(entity_mappings ? { entity_mappings } : {}),
        ...(narrative ? { narrative } : {}),
        source: 'gemini_enriched',
        model_used: model,
      };
    } catch {
      // Try next candidate model
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    source: 'deterministic',
  };
}
