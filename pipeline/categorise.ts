import {
  CATEGORIES,
  type Category,
  type RawSourceRow,
  type Transaction,
} from '../contracts/index.js';
import {
  classifyRowDeterministically,
  makeCacheKey,
  mapBusinessCategoryToSlot,
  sanitizeMerchantForPrivacy,
  type MerchantCacheFile,
  type MerchantClassificationEntry,
} from './clean-merchants.js';
import { getNodeFs } from './node-io.js';
import { parseNumericAndFx } from './parse.js';

const VALID_CATEGORIES = new Set<string>(CATEGORIES);

/**
 * Loads `data/merchant_cache.json` if present, or returns an empty entry map.
 */
export function loadMerchantCache(
  cacheFilePath?: string
): Record<string, MerchantClassificationEntry> {
  const fs = getNodeFs();
  if (!fs || !cacheFilePath || !fs.existsSync(cacheFilePath)) {
    return {};
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8')) as MerchantCacheFile;
    if (raw && typeof raw.entries === 'object' && raw.entries !== null) {
      return raw.entries;
    }
  } catch {
    // Fallback to deterministic classification if cache is unreadable
  }
  return {};
}

/**
 * Persists the merchant classification cache to `data/merchant_cache.json`.
 */
export function saveMerchantCache(
  cacheFilePath: string,
  entries: Record<string, MerchantClassificationEntry>,
  modelName = 'gemini-4-argon'
): void {
  const fs = getNodeFs();
  if (!fs) return;
  const sortedKeys = Object.keys(entries).sort();
  const sortedEntries: Record<string, MerchantClassificationEntry> = {};
  for (const k of sortedKeys) {
    sortedEntries[k] = entries[k]!;
  }
  const payload: MerchantCacheFile = {
    version: '1.0.0',
    model: modelName,
    generated_at: '2025-12-31T23:59:59.000Z',
    entries: sortedEntries,
  };
  fs.writeFileSync(cacheFilePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

/**
 * Optional live batch enrichment via Gemini API when `PROCESS_LIVE_GEMINI=1` and `MODEL_API_KEY` is set.
 * By default, uses pre-verified `data/merchant_cache.json` + deterministic rules for offline determinism.
 */
export async function buildOrUpdateMerchantCache(
  rows: readonly RawSourceRow[],
  cacheFilePath?: string
): Promise<Record<string, MerchantClassificationEntry>> {
  const existing = loadMerchantCache(cacheFilePath);
  const cache: Record<string, MerchantClassificationEntry> = {};

  const missingRows: RawSourceRow[] = [];
  const seenKeys = new Set<string>();
  for (const row of rows) {
    const key = makeCacheKey(row);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const deterministic = classifyRowDeterministically(row);
    const cached = existing[key];
    // Always ensure every unique row is populated in the cache
    if (!cached || deterministic.merchant_confidence >= 0.95) {
      cache[key] = deterministic;
    } else {
      cache[key] = cached;
    }
    if (cache[key]!.merchant_confidence < 0.9) {
      missingRows.push(row);
    }
  }

  const apiKey = process.env.MODEL_API_KEY || process.env.GEMINI_API_KEY;
  const modelName = process.env.MODEL_NAME || 'gemini-4-argon';
  if (process.env.PROCESS_LIVE_GEMINI === '1' && apiKey && missingRows.length > 0) {
    try {
      const promptLines = missingRows.map(
        (r, i) => `${i + 1}. account="${r.account}", type="${r.tran_type}", desc="${r.description}"`
      );
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: [
                    'Clean each bank transaction description into a privacy-safe merchant name and assign one category from:',
                    CATEGORIES.join(', '),
                    'Return JSON array of { index, merchant, category, is_recurring }.',
                    ...promptLines,
                  ].join('\n'),
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text) as Array<{
            index: number;
            merchant: string;
            category: string;
            is_recurring?: boolean;
          }>;
          for (const item of parsed) {
            const targetRow = missingRows[item.index - 1];
            if (targetRow && VALID_CATEGORIES.has(item.category)) {
              const key = makeCacheKey(targetRow);
              cache[key] = {
                merchant: sanitizeMerchantForPrivacy(item.merchant),
                category: item.category as Category,
                merchant_confidence: 0.92,
                category_confidence: 0.92,
                is_recurring: Boolean(item.is_recurring),
                is_transfer: item.category === 'transfers',
                is_refund:
                  targetRow.account === 'Credit card' &&
                  targetRow.tran_type === 'CREDIT' &&
                  item.category !== 'transfers',
              };
            }
          }
        }
      }
    } catch {
      // Offline / network error fallback: deterministic entries already populate `cache`
    }
  }

  if (cacheFilePath) {
    saveMerchantCache(cacheFilePath, cache, modelName);
  }
  return cache;
}

/**
 * Transforms RawSourceRow[] into complete, privacy-masked Transaction[] conforming to contracts/data.ts.
 */
export function buildTransactions(
  rows: readonly RawSourceRow[],
  cache: Record<string, MerchantClassificationEntry> = {},
  categoryHints: Record<string, string> = {}
): Transaction[] {
  return rows.map((row) => {
    const key = makeCacheKey(row);
    const rawHint = categoryHints[row.id]?.trim();
    const cachedEntry = cache[key] ?? cache[row.description.trim()] ?? cache[row.description];
    const entry = cachedEntry ?? classifyRowDeterministically(row, rawHint);
    const { amount_minor, direction, fx } = parseNumericAndFx(row);
    const safeMerchant = sanitizeMerchantForPrivacy(entry.merchant);

    const categoryLabel = rawHint || entry.category_label;
    const category =
      rawHint && !cachedEntry
        ? mapBusinessCategoryToSlot(rawHint, direction, row.description)
        : entry.category;

    const txn: Transaction = {
      id: row.id,
      date: row.date,
      posted_date: row.posted_date,
      account: row.account,
      tran_type: row.tran_type,
      amount_minor,
      currency: row.currency || 'USD',
      direction,
      raw_description: row.description,
      merchant: safeMerchant,
      merchant_confidence: entry.merchant_confidence,
      category,
      ...(categoryLabel ? { category_label: categoryLabel } : {}),
      category_confidence: entry.category_confidence,
      is_recurring: entry.is_recurring,
      is_transfer: entry.is_transfer,
      is_refund: entry.is_refund,
      ...(fx ? { fx } : {}),
      source_row: row,
    };

    return txn;
  });
}
