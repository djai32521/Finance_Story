import type { Direction, RawSourceRow, Transaction } from '../contracts/index.js';
import { getNodeFs } from './node-io.js';

export interface ParsedFx {
  foreign_amount_minor: number;
  foreign_currency: string;
  rate: number;
  stripped_description: string;
}

export interface UniversalParseResult {
  rows: RawSourceRow[];
  categoryHints: Record<string, string>;
  entityNameHint?: string;
  currencyHint?: string;
}

const CURRENCY_MAP: Record<string, string> = {
  'POUND STERLING': 'GBP',
  'AUSTRALIAN DOLLAR': 'AUD',
  EURO: 'EUR',
  'US DOLLAR': 'USD',
  'SWISS FRANC': 'CHF',
  'JAPANESE YEN': 'JPY',
  'CANADIAN DOLLAR': 'CAD',
};

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/**
 * Parses a single delimited line respecting RFC-4180 double quotes.
 */
export function parseCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/**
 * Normalises a wide range of date formats into ISO YYYY-MM-DD:
 * - YYYY-MM-DD, YYYY/MM/DD
 * - ISO timestamps (YYYY-MM-DDTHH:mm:ssZ)
 * - MM/DD/YYYY, DD/MM/YYYY, MM-DD-YYYY, DD-MM-YYYY
 * - YYYY-MM (maps to -01)
 * - YYYY-Q1..Q4 or Q1 2025
 * - "Jan 15, 2025", "15 Jan 2025", "Jan 2025"
 */
export function normaliseFlexibleDate(rawDate: string): string | null {
  const raw = String(rawDate ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!raw) return null;

  // 1. ISO date or timestamp: YYYY-MM-DD or YYYY/MM/DD (with optional time)
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(raw);
  if (isoMatch) {
    const yyyy = isoMatch[1]!;
    const mm = isoMatch[2]!.padStart(2, '0');
    const dd = isoMatch[3]!.padStart(2, '0');
    const mNum = Number.parseInt(mm, 10);
    const dNum = Number.parseInt(dd, 10);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  // 2. YYYY-MM or YYYY/MM
  const ymMatch = /^(\d{4})[-/](\d{1,2})$/.exec(raw);
  if (ymMatch) {
    const yyyy = ymMatch[1]!;
    const mm = ymMatch[2]!.padStart(2, '0');
    const mNum = Number.parseInt(mm, 10);
    if (mNum >= 1 && mNum <= 12) {
      return `${yyyy}-${mm}-01`;
    }
  }

  // 3. Quarters: YYYY-Q1..Q4, Q1 2025, 2025 Q1
  const qMatch1 = /^(\d{4})[-/\s]?Q([1-4])$/i.exec(raw);
  if (qMatch1) {
    const yyyy = qMatch1[1]!;
    const q = Number.parseInt(qMatch1[2]!, 10);
    const mm = String((q - 1) * 3 + 1).padStart(2, '0');
    return `${yyyy}-${mm}-01`;
  }
  const qMatch2 = /^Q([1-4])[-/\s](\d{4})$/i.exec(raw);
  if (qMatch2) {
    const q = Number.parseInt(qMatch2[1]!, 10);
    const yyyy = qMatch2[2]!;
    const mm = String((q - 1) * 3 + 1).padStart(2, '0');
    return `${yyyy}-${mm}-01`;
  }

  // 4. MM/DD/YYYY or DD/MM/YYYY (and 2-digit year variants)
  const slashMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[T\s].*)?$/.exec(raw);
  if (slashMatch) {
    const p1 = Number.parseInt(slashMatch[1]!, 10);
    const p2 = Number.parseInt(slashMatch[2]!, 10);
    let yyyy = slashMatch[3]!;
    if (yyyy.length === 2) {
      yyyy = `20${yyyy}`;
    }
    let mNum = p1;
    let dNum = p2;
    if (p1 > 12 && p2 <= 12) {
      dNum = p1;
      mNum = p2;
    }
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${yyyy}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
    }
  }

  // 5. Month name formats: "Jan 15, 2025", "January 15 2025", "15 Jan 2025", "15-Jan-2025", "Jan 2025"
  const monthFirstMatch = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
  if (monthFirstMatch) {
    const mm = MONTH_NAME_MAP[monthFirstMatch[1]!.toLowerCase()];
    const dd = monthFirstMatch[2]!.padStart(2, '0');
    const yyyy = monthFirstMatch[3]!;
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  const dayFirstMatch = /^(\d{1,2})[-\s]+([A-Za-z]+)[-\s,]+(\d{2,4})$/.exec(raw);
  if (dayFirstMatch) {
    const dd = dayFirstMatch[1]!.padStart(2, '0');
    const mm = MONTH_NAME_MAP[dayFirstMatch[2]!.toLowerCase()];
    let yyyy = dayFirstMatch[3]!;
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  const monthYearMatch = /^([A-Za-z]+)[-\s,]+(\d{4})$/.exec(raw);
  if (monthYearMatch) {
    const mm = MONTH_NAME_MAP[monthYearMatch[1]!.toLowerCase()];
    const yyyy = monthYearMatch[2]!;
    if (mm) return `${yyyy}-${mm}-01`;
  }

  return null;
}

/**
 * Normalises YYYY/MM/DD or YYYY-MM-DD (and flexible date strings) into ISO YYYY-MM-DD.
 */
export function normaliseIsoDate(rawDate: string): string {
  const trimmed = rawDate.trim().replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const flex = normaliseFlexibleDate(rawDate);
  if (flex) {
    return flex;
  }
  throw new Error(`Invalid date format: "${rawDate}"`);
}

/**
 * Parses currency strings including $, €, £, commas, accounting parentheses ($1,250.50),
 * and k/M/B suffixes ($12.5k -> 12500).
 */
export function parseFlexibleAmount(
  rawAmount: string | number | null | undefined
): { value: number; currencyHint?: string } | null {
  if (typeof rawAmount === 'number') {
    if (Number.isNaN(rawAmount) || !Number.isFinite(rawAmount)) return null;
    return { value: rawAmount };
  }
  if (rawAmount === null || rawAmount === undefined) return null;
  let s = String(rawAmount)
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!s || s === '-' || s === '—' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a') {
    return null;
  }

  let currencyHint: string | undefined;
  if (/€|\bEUR\b/i.test(s)) currencyHint = 'EUR';
  else if (/£|\bGBP\b/i.test(s)) currencyHint = 'GBP';
  else if (/¥|\bJPY\b/i.test(s)) currencyHint = 'JPY';
  else if (/A\$|\bAUD\b/i.test(s)) currencyHint = 'AUD';
  else if (/C\$|\bCAD\b/i.test(s)) currencyHint = 'CAD';
  else if (/\$|\bUSD\b/i.test(s)) currencyHint = 'USD';

  let isNegative = false;
  if (/^\(.*\)$/.test(s) || /^-\s*\(.*\)$/.test(s)) {
    isNegative = true;
    s = s.replace(/[()]/g, '');
  }
  if (s.endsWith('-')) {
    isNegative = true;
    s = s.slice(0, -1);
  }
  if (s.includes('-')) {
    isNegative = true;
  }

  // Check multiplier suffix (k, m, b)
  let multiplier = 1;
  const suffixMatch = /([0-9.])\s*([kKmMbB])\b/.exec(s);
  if (suffixMatch) {
    const suf = suffixMatch[2]!.toLowerCase();
    if (suf === 'k') multiplier = 1_000;
    else if (suf === 'm') multiplier = 1_000_000;
    else if (suf === 'b') multiplier = 1_000_000_000;
  }

  const cleaned = s.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  if (Number.isNaN(num)) return null;

  const signed = (isNegative ? -1 : 1) * num * multiplier;
  return {
    value: Object.is(signed, -0) ? 0 : signed,
    ...(currencyHint ? { currencyHint } : {}),
  };
}

/**
 * Extracts inline FX metadata such as:
 * "AMAZON MARKETPLACE AU SYDNEY SOUTH 127.05 AUSTRALIAN DOLLAR at a Conversion Rate  of 1.5025 (US$84.56)"
 */
export function extractInlineFx(description: string): ParsedFx | null {
  const fxRegex =
    /^(.*?)\s+(\d+(?:\.\d+)?)\s+([A-Z][A-Z\s]+?)\s+at\s+a\s+Conversion\s+Rate\s+of\s+(\d+(?:\.\d+)?)\s*\(US\$\d+(?:\.\d+)?\)\s*$/i;
  const match = fxRegex.exec(description.trim());
  if (!match) {
    return null;
  }
  const stripped = match[1]!.trim();
  const foreignAmount = Number.parseFloat(match[2]!);
  const rawCurrencyName = match[3]!.trim().toUpperCase();
  const rate = Number.parseFloat(match[4]!);
  const currencyCode = CURRENCY_MAP[rawCurrencyName] ?? rawCurrencyName;
  return {
    foreign_amount_minor: Math.round(foreignAmount * 100),
    foreign_currency: currencyCode,
    rate,
    stripped_description: stripped,
  };
}

const DATE_COL_PATTERNS = [
  /^date$/i,
  /^transaction[\s_-]*date$/i,
  /^tx[\s_-]*date$/i,
  /^txn[\s_-]*date$/i,
  /^invoice[\s_-]*date$/i,
  /^booking[\s_-]*date$/i,
  /^posted[\s_-]*date$/i,
  /^created[\s_-]*at$/i,
  /^created$/i,
  /^period$/i,
  /^month$/i,
  /^day$/i,
  /^timestamp$/i,
  /^effective[\s_-]*date$/i,
  /^settlement[\s_-]*date$/i,
  /^value[\s_-]*date$/i,
];

const POSTED_DATE_COL_PATTERNS = [
  /^posted[\s_-]*date$/i,
  /^date[\s_-]*processed$/i,
  /^settlement[\s_-]*date$/i,
  /^cleared[\s_-]*date$/i,
];

const SINGLE_AMOUNT_COL_PATTERNS = [
  /^amount$/i,
  /^net[\s_-]*amount$/i,
  /^total$/i,
  /^total[\s_-]*amount$/i,
  /^value$/i,
  /^usd$/i,
  /^amount[\s_-]*\(?usd\)?$/i,
  /^revenue$/i,
  /^spend$/i,
  /^cost$/i,
  /^mrr$/i,
  /^arr$/i,
  /^cash[\s_-]*flow$/i,
  /^gross[\s_-]*amount$/i,
  /^transaction[\s_-]*amount$/i,
  /^price$/i,
];

const DEBIT_COL_PATTERNS = [
  /^debit$/i,
  /^debit[\s_-]*amount$/i,
  /^outflow$/i,
  /^outflows$/i,
  /^expense$/i,
  /^expenses$/i,
  /^withdrawal$/i,
  /^money[\s_-]*out$/i,
  /^paid[\s_-]*out$/i,
];

const CREDIT_COL_PATTERNS = [
  /^credit$/i,
  /^credit[\s_-]*amount$/i,
  /^inflow$/i,
  /^inflows$/i,
  /^revenue$/i,
  /^income$/i,
  /^deposit$/i,
  /^money[\s_-]*in$/i,
  /^paid[\s_-]*in$/i,
];

const DIRECTION_COL_PATTERNS = [
  /^direction$/i,
  /^type$/i,
  /^tran[\s_-]*type$/i,
  /^transaction[\s_-]*type$/i,
  /^flow$/i,
  /^entry[\s_-]*type$/i,
  /^account[\s_-]*type$/i,
  /^dr[\s_/-]*cr$/i,
];

const COUNTERPARTY_COL_PATTERNS = [
  /^vendor$/i,
  /^merchant$/i,
  /^counterparty$/i,
  /^customer$/i,
  /^client$/i,
  /^payee$/i,
  /^supplier$/i,
  /^merchant[\s_-]*name$/i,
  /^vendor[\s_-]*name$/i,
  /^account[\s_-]*name$/i,
  /^name$/i,
];

const DESCRIPTION_COL_PATTERNS = [
  /^description$/i,
  /^memo$/i,
  /^narrative$/i,
  /^item$/i,
  /^details$/i,
  /^particulars$/i,
  /^reference$/i,
  /^notes$/i,
];

const CATEGORY_COL_PATTERNS = [
  /^category$/i,
  /^department$/i,
  /^cost[\s_-]*center$/i,
  /^gl[\s_-]*account$/i,
  /^gl$/i,
  /^segment$/i,
  /^product[\s_-]*line$/i,
  /^expense[\s_-]*type$/i,
  /^stream$/i,
  /^bucket$/i,
  /^division$/i,
  /^pillar$/i,
];

const CURRENCY_COL_PATTERNS = [
  /^currency$/i,
  /^ccy$/i,
  /^curr$/i,
  /^currency[\s_-]*code$/i,
  /^iso[\s_-]*currency$/i,
];

const ACCOUNT_COL_PATTERNS = [
  /^account$/i,
  /^bank[\s_-]*account$/i,
  /^source[\s_-]*account$/i,
  /^card$/i,
  /^ledger$/i,
  /^fund$/i,
];

const ID_COL_PATTERNS = [
  /^id$/i,
  /^tx[\s_-]*id$/i,
  /^txn[\s_-]*id$/i,
  /^transaction[\s_-]*id$/i,
  /^unique[\s_-]*id$/i,
  /^entry[\s_-]*id$/i,
  /^invoice[\s_-]*id$/i,
  /^reference[\s_-]*id$/i,
];

const INFLOW_HINT_REGEX =
  /revenue|sales|arr|mrr|subscription income|invoice paid|settlement|retainer|deposit|customer|inflow|payout|grant|rebate|interest/i;

function matchColumnIndex(headers: readonly string[], patterns: readonly RegExp[]): number {
  for (const pat of patterns) {
    const idx = headers.findIndex((h) => pat.test(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

function inferEntityNameFromFileName(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  const cleaned = base
    .replace(
      /\b(20\d\d|fy\d\d|transactions|ledger|export|csv|tsv|json|data|dump|statement|raw)\b/gi,
      ''
    )
    .replace(/\d+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseJsonBusinessData(rawJson: unknown, fileName?: string): UniversalParseResult {
  let records: Array<Record<string, unknown>> = [];
  let entityNameHint = inferEntityNameFromFileName(fileName);
  let currencyHint: string | undefined;

  if (Array.isArray(rawJson)) {
    records = rawJson.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object')
    );
  } else if (rawJson && typeof rawJson === 'object') {
    const obj = rawJson as Record<string, unknown>;
    if (typeof obj.entity_name === 'string' && obj.entity_name.trim()) {
      entityNameHint = obj.entity_name.trim();
    } else if (typeof obj.entityName === 'string' && obj.entityName.trim()) {
      entityNameHint = obj.entityName.trim();
    } else if (typeof obj.company === 'string' && obj.company.trim()) {
      entityNameHint = obj.company.trim();
    } else if (typeof obj.organization === 'string' && obj.organization.trim()) {
      entityNameHint = obj.organization.trim();
    }

    if (typeof obj.currency === 'string' && obj.currency.trim()) {
      currencyHint = obj.currency.trim().toUpperCase();
    }

    const candidateKeys = ['transactions', 'rows', 'data', 'entries', 'items', 'ledger'];
    for (const k of candidateKeys) {
      if (Array.isArray(obj[k])) {
        records = (obj[k] as unknown[]).filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object')
        );
        break;
      }
    }
    if (records.length === 0) {
      for (const val of Object.values(obj)) {
        if (Array.isArray(val)) {
          records = val.filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === 'object')
          );
          if (records.length > 0) break;
        }
      }
    }
  }

  if (records.length === 0) {
    throw new Error('Unrecognised CSV header format');
  }

  // Inspect keys of first record to ensure date + amount exist
  const sampleKeys = Array.from(new Set(records.slice(0, 10).flatMap((r) => Object.keys(r))));
  const cleanKeys = sampleKeys.map((k) => k.trim());
  const dateKeyIdx = matchColumnIndex(cleanKeys, DATE_COL_PATTERNS);
  const postedDateKeyIdx = matchColumnIndex(cleanKeys, POSTED_DATE_COL_PATTERNS);
  const amountKeyIdx = matchColumnIndex(cleanKeys, SINGLE_AMOUNT_COL_PATTERNS);
  const debitKeyIdx = matchColumnIndex(cleanKeys, DEBIT_COL_PATTERNS);
  const creditKeyIdx = matchColumnIndex(cleanKeys, CREDIT_COL_PATTERNS);
  const dirKeyIdx = matchColumnIndex(cleanKeys, DIRECTION_COL_PATTERNS);
  const counterpartyKeyIdx = matchColumnIndex(cleanKeys, COUNTERPARTY_COL_PATTERNS);
  const descKeyIdx = matchColumnIndex(cleanKeys, DESCRIPTION_COL_PATTERNS);
  const catKeyIdx = matchColumnIndex(cleanKeys, CATEGORY_COL_PATTERNS);
  const currKeyIdx = matchColumnIndex(cleanKeys, CURRENCY_COL_PATTERNS);
  const acctKeyIdx = matchColumnIndex(cleanKeys, ACCOUNT_COL_PATTERNS);
  const idKeyIdx = matchColumnIndex(cleanKeys, ID_COL_PATTERNS);

  const hasPairedDebitCredit = debitKeyIdx !== -1 && creditKeyIdx !== -1;
  if (
    dateKeyIdx === -1 ||
    (amountKeyIdx === -1 && !hasPairedDebitCredit && debitKeyIdx === -1 && creditKeyIdx === -1)
  ) {
    throw new Error('Unrecognised CSV header format');
  }

  const getVal = (rec: Record<string, unknown>, idx: number): string => {
    if (idx === -1) return '';
    const k = sampleKeys[idx];
    if (!k) return '';
    const v = rec[k];
    return v === null || v === undefined ? '' : String(v).trim();
  };

  // Pre-scan whether single-column amounts are all non-negative
  const rawAmounts: number[] = [];
  for (const rec of records) {
    if (!hasPairedDebitCredit && amountKeyIdx !== -1) {
      const parsed = parseFlexibleAmount(getVal(rec, amountKeyIdx));
      if (parsed !== null) rawAmounts.push(parsed.value);
    }
  }
  const allNonNegative = rawAmounts.length > 0 && rawAmounts.every((n) => n >= 0);
  const amountColHeader = amountKeyIdx !== -1 ? cleanKeys[amountKeyIdx]! : '';
  const isRevenueNamedCol = /^(revenue|arr|mrr|inflow|sales|income)$/i.test(amountColHeader);

  const rows: RawSourceRow[] = [];
  const categoryHints: Record<string, string> = {};
  const seenIds = new Set<string>();

  records.forEach((rec, idx) => {
    const rawDate = getVal(rec, dateKeyIdx);
    const isoDate = normaliseFlexibleDate(rawDate);
    if (!isoDate) return;

    const rawPosted = postedDateKeyIdx !== -1 ? getVal(rec, postedDateKeyIdx) : '';
    const isoPosted = (rawPosted && normaliseFlexibleDate(rawPosted)) || isoDate;

    const dirVal = getVal(rec, dirKeyIdx);
    const counterpartyVal = getVal(rec, counterpartyKeyIdx);
    const descVal = getVal(rec, descKeyIdx);
    const catVal = getVal(rec, catKeyIdx);

    const description = counterpartyVal || descVal || catVal || 'Operating Transaction';
    const combinedContext = `${counterpartyVal} ${descVal} ${catVal} ${dirVal}`.trim();

    if (/^pending$/i.test(dirVal) || /^pending\b/i.test(description)) {
      return;
    }

    let signedAmount = 0;
    let rowCurrHint: string | undefined;

    if (hasPairedDebitCredit) {
      const deb = parseFlexibleAmount(getVal(rec, debitKeyIdx));
      const cred = parseFlexibleAmount(getVal(rec, creditKeyIdx));
      const debVal = deb ? Math.abs(deb.value) : 0;
      const credVal = cred ? Math.abs(cred.value) : 0;
      rowCurrHint = deb?.currencyHint ?? cred?.currencyHint;
      if (credVal > 0 && debVal === 0) {
        signedAmount = credVal;
      } else if (debVal > 0 && credVal === 0) {
        signedAmount = -debVal;
      } else {
        signedAmount = credVal - debVal;
      }
    } else {
      const targetIdx =
        amountKeyIdx !== -1 ? amountKeyIdx : debitKeyIdx !== -1 ? debitKeyIdx : creditKeyIdx;
      const parsed = parseFlexibleAmount(getVal(rec, targetIdx));
      if (!parsed) return;
      rowCurrHint = parsed.currencyHint;
      signedAmount = parsed.value;

      if (/^(in|inflow|credit|cr|revenue|income|deposit|receipt|sales|ar)$/i.test(dirVal)) {
        signedAmount = Math.abs(signedAmount);
      } else if (
        /^(out|outflow|debit|dr|expense|spend|cost|payment|withdrawal|ap|bill)$/i.test(dirVal)
      ) {
        signedAmount = -Math.abs(signedAmount);
      } else if (allNonNegative) {
        if (isRevenueNamedCol || INFLOW_HINT_REGEX.test(combinedContext)) {
          signedAmount = Math.abs(signedAmount);
        } else {
          signedAmount = -Math.abs(signedAmount);
        }
      }
    }

    const rawId = getVal(rec, idKeyIdx);
    const cleanDate = isoDate.replace(/-/g, '');
    const id = rawId || `BIZ-${cleanDate}-${String(idx + 1).padStart(4, '0')}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const rowCurrency =
      getVal(rec, currKeyIdx).toUpperCase() || rowCurrHint || currencyHint || 'USD';
    if (!currencyHint && rowCurrHint) {
      currencyHint = rowCurrHint;
    }

    const rawAccount = getVal(rec, acctKeyIdx);
    const account = rawAccount || (signedAmount >= 0 ? 'Savings' : 'Credit card');
    const tranType = dirVal || (signedAmount >= 0 ? 'CREDIT' : 'DEBIT');

    if (catVal) {
      categoryHints[id] = catVal;
    }

    rows.push({
      id,
      date: isoDate,
      posted_date: isoPosted,
      account,
      tran_type: tranType,
      description,
      amount: (Object.is(signedAmount, -0) ? 0 : signedAmount).toFixed(2),
      currency: rowCurrency,
    });
  });

  return {
    rows,
    categoryHints,
    ...(entityNameHint ? { entityNameHint } : {}),
    ...(currencyHint ? { currencyHint } : {}),
  };
}

/**
 * Universal Business Data Parser supporting:
 * 1. Canonical personal/bank CSVs (Sam & Alex)
 * 2. Arbitrary B2B CSV and TSV tables (auto-detecting `,`, `\t`, `;` delimiters, flexible dates, paired debit/credit or signed/unsigned amounts, department/category hints)
 * 3. JSON arrays or ledger wrapper objects (`[{ date, amount, vendor, department, ... }]` or `{ transactions: [...] }` or `{ rows: [...] }`)
 */
export function parseUniversalBusinessData(
  content: string,
  fileName?: string
): UniversalParseResult {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Unrecognised CSV header format');
  }

  // 1. Check JSON format first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsedJson = JSON.parse(trimmed) as unknown;
      return parseJsonBusinessData(parsedJson, fileName);
    } catch (err) {
      if (err instanceof Error && err.message === 'Unrecognised CSV header format') {
        throw err;
      }
      throw new Error('Unrecognised CSV header format');
    }
  }

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('Unrecognised CSV header format');
  }

  // 2. Check if it matches one of the 3 canonical CSV headers
  const canonicalHeaderIdx = lines.findIndex(
    (l) =>
      l.startsWith('id,date,') ||
      l.startsWith('Date Processed,Date of Transaction,') ||
      l.startsWith('Date,Unique Id,Tran Type,')
  );
  if (canonicalHeaderIdx !== -1) {
    const canonicalRows = parseCanonicalCsvLines(lines, canonicalHeaderIdx);
    const entityNameHint = inferEntityNameFromFileName(fileName);
    return {
      rows: canonicalRows,
      categoryHints: {},
      ...(entityNameHint ? { entityNameHint } : {}),
      currencyHint: canonicalRows[0]?.currency || 'USD',
    };
  }

  // 3. Auto-detect delimiter (`,`, `\t`, `;`) and header row across first 20 lines
  const candidateDelimiters = [',', '\t', ';'] as const;
  let bestDelimiter = ',';
  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i]!;
    for (const delim of candidateDelimiters) {
      const cols = parseCsvLine(line, delim).map((c) =>
        c
          .trim()
          .replace(/^["']|["']$/g, '')
          .trim()
      );
      if (cols.length < 2) continue;
      const dIdx = matchColumnIndex(cols, DATE_COL_PATTERNS);
      const aIdx = matchColumnIndex(cols, SINGLE_AMOUNT_COL_PATTERNS);
      const debIdx = matchColumnIndex(cols, DEBIT_COL_PATTERNS);
      const credIdx = matchColumnIndex(cols, CREDIT_COL_PATTERNS);
      if (dIdx !== -1 && (aIdx !== -1 || debIdx !== -1 || credIdx !== -1)) {
        bestDelimiter = delim;
        headerIdx = i;
        headers = cols;
        break;
      }
    }
    if (headerIdx !== -1) break;
  }

  if (headerIdx === -1) {
    throw new Error('Unrecognised CSV header format');
  }

  const dateColIdx = matchColumnIndex(headers, DATE_COL_PATTERNS);
  const postedDateColIdx = matchColumnIndex(headers, POSTED_DATE_COL_PATTERNS);
  const amountColIdx = matchColumnIndex(headers, SINGLE_AMOUNT_COL_PATTERNS);
  const debitColIdx = matchColumnIndex(headers, DEBIT_COL_PATTERNS);
  const creditColIdx = matchColumnIndex(headers, CREDIT_COL_PATTERNS);
  const dirColIdx = matchColumnIndex(headers, DIRECTION_COL_PATTERNS);
  const counterpartyColIdx = matchColumnIndex(headers, COUNTERPARTY_COL_PATTERNS);
  const descColIdx = matchColumnIndex(headers, DESCRIPTION_COL_PATTERNS);
  const catColIdx = matchColumnIndex(headers, CATEGORY_COL_PATTERNS);
  const currColIdx = matchColumnIndex(headers, CURRENCY_COL_PATTERNS);
  const acctColIdx = matchColumnIndex(headers, ACCOUNT_COL_PATTERNS);
  const idColIdx = matchColumnIndex(headers, ID_COL_PATTERNS);

  const hasPairedDebitCredit = debitColIdx !== -1 && creditColIdx !== -1;
  const dataLines = lines.slice(headerIdx + 1);
  const parsedColsList = dataLines.map((l) => parseCsvLine(l, bestDelimiter));

  // Pre-scan whether single-column amounts are all non-negative
  const rawAmounts: number[] = [];
  for (const cols of parsedColsList) {
    if (!hasPairedDebitCredit && amountColIdx !== -1 && cols[amountColIdx] !== undefined) {
      const p = parseFlexibleAmount(cols[amountColIdx]);
      if (p !== null) rawAmounts.push(p.value);
    }
  }
  const allNonNegative = rawAmounts.length > 0 && rawAmounts.every((n) => n >= 0);
  const amountColHeader = amountColIdx !== -1 ? headers[amountColIdx]! : '';
  const isRevenueNamedCol = /^(revenue|arr|mrr|inflow|sales|income)$/i.test(amountColHeader);

  const rows: RawSourceRow[] = [];
  const categoryHints: Record<string, string> = {};
  const seenIds = new Set<string>();
  let currencyHint: string | undefined;

  parsedColsList.forEach((cols, idx) => {
    if (cols.length < 2) return;
    const getCol = (cIdx: number): string =>
      cIdx !== -1 && cIdx < cols.length ? cols[cIdx]!.trim() : '';

    const rawDate = getCol(dateColIdx);
    const isoDate = normaliseFlexibleDate(rawDate);
    if (!isoDate) return;

    const rawPosted = getCol(postedDateColIdx);
    const isoPosted = (rawPosted && normaliseFlexibleDate(rawPosted)) || isoDate;

    const dirVal = getCol(dirColIdx);
    const counterpartyVal = getCol(counterpartyColIdx);
    const descVal = getCol(descColIdx);
    const catVal = getCol(catColIdx);

    const description = counterpartyVal || descVal || catVal || 'Operating Transaction';
    const combinedContext = `${counterpartyVal} ${descVal} ${catVal} ${dirVal}`.trim();

    if (/^pending$/i.test(dirVal) || /^pending\b/i.test(description)) {
      return;
    }

    let signedAmount = 0;
    let rowCurrHint: string | undefined;

    if (hasPairedDebitCredit) {
      const deb = parseFlexibleAmount(getCol(debitColIdx));
      const cred = parseFlexibleAmount(getCol(creditColIdx));
      if (!deb && !cred) return;
      const debVal = deb ? Math.abs(deb.value) : 0;
      const credVal = cred ? Math.abs(cred.value) : 0;
      rowCurrHint = deb?.currencyHint ?? cred?.currencyHint;
      if (credVal > 0 && debVal === 0) {
        signedAmount = credVal;
      } else if (debVal > 0 && credVal === 0) {
        signedAmount = -debVal;
      } else {
        signedAmount = credVal - debVal;
      }
    } else {
      const targetIdx =
        amountColIdx !== -1 ? amountColIdx : debitColIdx !== -1 ? debitColIdx : creditColIdx;
      const parsed = parseFlexibleAmount(getCol(targetIdx));
      if (!parsed) return;
      rowCurrHint = parsed.currencyHint;
      signedAmount = parsed.value;

      if (/^(in|inflow|credit|cr|revenue|income|deposit|receipt|sales|ar)$/i.test(dirVal)) {
        signedAmount = Math.abs(signedAmount);
      } else if (
        /^(out|outflow|debit|dr|expense|spend|cost|payment|withdrawal|ap|bill)$/i.test(dirVal)
      ) {
        signedAmount = -Math.abs(signedAmount);
      } else if (allNonNegative) {
        if (isRevenueNamedCol || INFLOW_HINT_REGEX.test(combinedContext)) {
          signedAmount = Math.abs(signedAmount);
        } else {
          signedAmount = -Math.abs(signedAmount);
        }
      }
    }

    const rawId = getCol(idColIdx);
    const cleanDate = isoDate.replace(/-/g, '');
    const id = rawId || `BIZ-${cleanDate}-${String(idx + 1).padStart(4, '0')}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const rowCurrency = getCol(currColIdx).toUpperCase() || rowCurrHint || currencyHint || 'USD';
    if (!currencyHint && rowCurrency) {
      currencyHint = rowCurrency;
    }

    const rawAccount = getCol(acctColIdx);
    const account = rawAccount || (signedAmount >= 0 ? 'Savings' : 'Credit card');
    const tranType = dirVal || (signedAmount >= 0 ? 'CREDIT' : 'DEBIT');

    if (catVal) {
      categoryHints[id] = catVal;
    }

    rows.push({
      id,
      date: isoDate,
      posted_date: isoPosted,
      account,
      tran_type: tranType,
      description,
      amount: (Object.is(signedAmount, -0) ? 0 : signedAmount).toFixed(2),
      currency: rowCurrency,
    });
  });

  const entityNameHint = inferEntityNameFromFileName(fileName);
  return {
    rows,
    categoryHints,
    ...(entityNameHint ? { entityNameHint } : {}),
    ...(currencyHint ? { currencyHint } : {}),
  };
}

function parseCanonicalCsvLines(lines: readonly string[], headerIdx: number): RawSourceRow[] {
  const headerLine = lines[headerIdx]!;
  const dataLines = lines.slice(headerIdx + 1);
  const rows: RawSourceRow[] = [];
  const seenIds = new Set<string>();

  if (headerLine.startsWith('id,date,')) {
    for (const line of dataLines) {
      const cols = parseCsvLine(line);
      if (cols.length < 8) continue;
      const [id, date, posted_date, account, tran_type, description, amount, currency] = cols as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (
        tran_type.trim().toUpperCase() === 'PENDING' ||
        description.trim().toUpperCase().startsWith('PENDING')
      ) {
        continue;
      }
      if (seenIds.has(id.trim())) {
        continue;
      }
      seenIds.add(id.trim());
      rows.push({
        id: id.trim(),
        date: normaliseIsoDate(date),
        posted_date: normaliseIsoDate(posted_date),
        account: account.trim(),
        tran_type: tran_type.trim(),
        description: description.trim(),
        amount: amount.trim(),
        currency: currency.trim() || 'USD',
      });
    }
  } else if (headerLine.startsWith('Date Processed,Date of Transaction,')) {
    // Raw Credit Card export: sign is inverted (positive = debit/out, negative = credit/in)
    for (const line of dataLines) {
      const cols = parseCsvLine(line);
      if (cols.length < 7) continue;
      const [dateProcessed, dateOfTxn, uniqueId, tranType, _ref, description, amountStr] = cols as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (tranType.trim().toUpperCase() === 'PENDING') continue;
      const id = uniqueId.trim().startsWith('CARD-') ? uniqueId.trim() : `CARD-${uniqueId.trim()}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const rawNum = Number.parseFloat(amountStr.trim());
      const invertedNum = -rawNum;
      const formattedAmount = (Object.is(invertedNum, -0) ? 0 : invertedNum).toFixed(2);

      rows.push({
        id,
        date: normaliseIsoDate(dateOfTxn),
        posted_date: normaliseIsoDate(dateProcessed),
        account: 'Credit card',
        tran_type: tranType.trim(),
        description: description.trim(),
        amount: formattedAmount,
        currency: 'USD',
      });
    }
  } else if (headerLine.startsWith('Date,Unique Id,Tran Type,')) {
    // Raw Savings statement: Payee + Memo join into description; sign is standard (negative = out)
    for (const line of dataLines) {
      const cols = parseCsvLine(line);
      if (cols.length < 7) continue;
      const [dateStr, uniqueId, tranType, _cheque, payee, memo, amountStr] = cols as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (tranType.trim().toUpperCase() === 'PENDING') continue;
      const id = uniqueId.trim().startsWith('SAV-') ? uniqueId.trim() : `SAV-${uniqueId.trim()}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const descParts = [payee.trim(), memo.trim()].filter((p) => p.length > 0);
      const description = descParts.join(' ');
      const isoDate = normaliseIsoDate(dateStr);
      const rawNum = Number.parseFloat(amountStr.trim());

      rows.push({
        id,
        date: isoDate,
        posted_date: isoDate,
        account: 'Savings',
        tran_type: tranType.trim(),
        description,
        amount: rawNum.toFixed(2),
        currency: 'USD',
      });
    }
  }

  return rows;
}

/**
 * Parses any of the supported CSV formats:
 * 1. Standard normalized CSV (`id,date,posted_date,account,tran_type,description,amount,currency`)
 * 2. Raw bank card statement (`Date Processed,Date of Transaction,Unique Id,Tran Type,Reference,Description,Amount`)
 * 3. Raw bank savings statement (`Date,Unique Id,Tran Type,Cheque Number,Payee,Memo,Amount`)
 * 4. Universal B2B CSV/TSV/JSON fallback when recognizable date + amount columns are present.
 *
 * Removes exact duplicate IDs and rows marked PENDING.
 */
export function parseRawCsvContent(csvContent: string): RawSourceRow[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Locate the header row (handles metadata lines above the header in raw bank exports)
  const headerIdx = lines.findIndex(
    (l) =>
      l.startsWith('id,date,') ||
      l.startsWith('Date Processed,Date of Transaction,') ||
      l.startsWith('Date,Unique Id,Tran Type,')
  );

  if (headerIdx !== -1) {
    return parseCanonicalCsvLines(lines, headerIdx);
  }

  return parseUniversalBusinessData(csvContent).rows;
}

export function parseCsvFile(filePath: string): RawSourceRow[] {
  const fs = getNodeFs();
  if (!fs) {
    throw new Error('parseCsvFile is only supported in a Node.js environment');
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return parseRawCsvContent(content);
}

/**
 * Converts a RawSourceRow into a partial Transaction with amount_minor, direction, and FX parsed.
 */
export function parseNumericAndFx(row: RawSourceRow): {
  amount_minor: number;
  signed_minor: number;
  direction: Direction;
  fx?: Transaction['fx'];
  stripped_description: string;
} {
  const numericAmount = Number.parseFloat(row.amount);
  if (Number.isNaN(numericAmount)) {
    throw new Error(`Invalid numeric amount "${row.amount}" in row ${row.id}`);
  }
  const signed_minor = Math.round(numericAmount * 100);
  const amount_minor = Math.abs(signed_minor);
  const direction: Direction = signed_minor < 0 ? 'out' : 'in';

  const fxParsed = extractInlineFx(row.description);
  if (fxParsed) {
    return {
      amount_minor,
      signed_minor,
      direction,
      fx: {
        foreign_amount_minor: fxParsed.foreign_amount_minor,
        foreign_currency: fxParsed.foreign_currency,
        rate: fxParsed.rate,
      },
      stripped_description: fxParsed.stripped_description,
    };
  }

  return {
    amount_minor,
    signed_minor,
    direction,
    stripped_description: row.description,
  };
}
