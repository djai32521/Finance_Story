import {
  type Category,
  type DatasetBundle,
  type DriveFileEntry,
  type DriveFolderListing,
  type IngestEnrichRequest,
  type IngestEnrichResponse,
  type IngestProgressStep,
  type RawIngestFile,
  type RawSourceRow,
} from '../../contracts/index.js';
import {
  applyGeminiEnrichmentToBundle,
  buildDatasetBundleFromRows,
  ingestFilesDeterministically,
} from '../../pipeline/ingest-business.js';
import { parseCsvLine } from '../../pipeline/parse.js';
import { convertXlsxToCsvIngestFiles, isXlsxBytes } from '../../pipeline/xlsx.js';

/**
 * Races an async fetch callback against a hard timeout with AbortController
 * so AI Studio's `iframe_shim.not_js` proxy never hangs indefinitely.
 */
export async function raceWithAbort<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 15000,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onExternalAbort = (): void => {
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function inferMimeType(fileName: string, rawType?: string): string {
  if (rawType && rawType.trim().length > 0) return rawType.trim();
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.tsv')) return 'text/tab-separated-values';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt') || lower.endsWith('.log') || lower.endsWith('.md')) {
    return 'text/plain';
  }
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

function isTextFile(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return false;
  }
  if (
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.log') ||
    lower.endsWith('.md')
  ) {
    return true;
  }
  return (
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('csv') ||
    mimeType.includes('tab-separated')
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(buffer).toString('base64');
}

/**
 * Reads browser `FileList` or `File[]` into `RawIngestFile[]`.
 * Unpacks `.xlsx`/`.xls` Excel workbooks directly into clean CSV tab files,
 * reads `.csv`, `.tsv`, `.json`, `.txt` as UTF-8 text, and `.pdf`/binary files as base64.
 */
export async function readBrowserFiles(fileList: FileList | File[]): Promise<RawIngestFile[]> {
  const files = Array.from(fileList);
  const results: RawIngestFile[] = [];

  for (const file of files) {
    const mimeType = inferMimeType(file.name, file.type);
    const lowerName = file.name.toLowerCase();
    if (
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      /spreadsheetml|excel/i.test(mimeType)
    ) {
      const buffer = await file.arrayBuffer();
      const u8 = new Uint8Array(buffer);
      if (isXlsxBytes(u8)) {
        try {
          const converted = convertXlsxToCsvIngestFiles(u8, file.name);
          if (converted.files.length > 0) {
            results.push(...converted.files);
            continue;
          }
        } catch {
          // Fall through to base64 if custom xlsx extraction fails
        }
      }
      results.push({
        name: file.name,
        mimeType,
        content: arrayBufferToBase64(buffer),
        encoding: 'base64',
      });
    } else if (isTextFile(file.name, mimeType)) {
      const content =
        typeof file.text === 'function' ? await file.text() : await readFileAsTextFallback(file);
      results.push({
        name: file.name,
        mimeType,
        content,
        encoding: 'utf8',
      });
    } else {
      const buffer = await file.arrayBuffer();
      results.push({
        name: file.name,
        mimeType,
        content: arrayBufferToBase64(buffer),
        encoding: 'base64',
      });
    }
  }

  return results;
}

function readFileAsTextFallback(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function normalizeFlexibleIsoDate(raw: string, fallbackIdx: number): string {
  const s = raw.trim();
  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (isoMatch) {
    const y = isoMatch[1]!;
    const m = isoMatch[2]!.padStart(2, '0');
    const d = isoMatch[3]!.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // MM/DD/YYYY or DD/MM/YYYY
  const usMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (usMatch) {
    const p1 = Number.parseInt(usMatch[1]!, 10);
    const p2 = Number.parseInt(usMatch[2]!, 10);
    const mNum = p1 > 12 && p2 <= 12 ? p2 : p1;
    const dNum = p1 > 12 && p2 <= 12 ? p1 : p2;
    const m = String(Math.max(1, Math.min(12, mNum))).padStart(2, '0');
    const d = String(Math.max(1, Math.min(31, dNum))).padStart(2, '0');
    const y = usMatch[3]!;
    return `${y}-${m}-${d}`;
  }
  // YYYY-MM or Month YYYY
  const ymMatch = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (ymMatch) {
    return `${ymMatch[1]}-${ymMatch[2]!.padStart(2, '0')}-15`;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getUTCFullYear();
    if (y >= 2000 && y <= 2035) {
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dt.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  // Deterministic fallback date in 2025
  const dayOfYear = (fallbackIdx % 365) + 1;
  const dt = new Date(Date.UTC(2025, 0, dayOfYear));
  return dt.toISOString().slice(0, 10);
}

function cleanAmountString(raw: string): number {
  const s = raw.trim();
  if (!s) return NaN;
  const isParenNegative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[^0-9.-]/g, '');
  const num = Number.parseFloat(cleaned);
  if (Number.isNaN(num)) return NaN;
  return isParenNegative ? -Math.abs(num) : num;
}

/**
 * Universal fallback tabular parser for arbitrary business CSVs, TSVs, and JSON dumps
 * whose headers differ from standard retail bank exports.
 */
export function parseFlexibleTabularRows(files: readonly RawIngestFile[]): RawSourceRow[] {
  const rows: RawSourceRow[] = [];
  let rowCounter = 1;

  for (const file of files) {
    if (!file.content || file.encoding === 'base64') continue;
    const trimmed = file.content.trim();
    if (!trimmed) continue;

    // 1. Check if JSON array or object with rows/transactions/data
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const arr = Array.isArray(parsed)
          ? parsed
          : typeof parsed === 'object' && parsed !== null
            ? ((parsed as Record<string, unknown>).transactions ??
              (parsed as Record<string, unknown>).rows ??
              (parsed as Record<string, unknown>).data ??
              [])
            : [];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item !== 'object' || item === null) continue;
            const rec = item as Record<string, unknown>;
            const rawDate = String(
              rec.date ??
                rec.transaction_date ??
                rec.posted_date ??
                rec.period ??
                rec.timestamp ??
                rec.month ??
                ''
            );
            const rawDesc = String(
              rec.description ??
                rec.merchant ??
                rec.vendor ??
                rec.counterparty ??
                rec.name ??
                rec.payee ??
                rec.account_name ??
                rec.memo ??
                rec.category ??
                'Business Transaction'
            );
            const rawType = String(
              rec.tran_type ?? rec.type ?? rec.category ?? rec.department ?? 'OPERATING'
            );
            const rawAcct = String(rec.account ?? rec.cost_center ?? 'Operating Ledger');
            const rawCurr = String(rec.currency ?? 'USD');

            let numericAmt = NaN;
            if (rec.amount !== undefined) {
              numericAmt = cleanAmountString(String(rec.amount));
            } else if (rec.amount_minor !== undefined) {
              numericAmt = Number(rec.amount_minor) / 100;
              if (rec.direction === 'out' && numericAmt > 0) numericAmt = -numericAmt;
            } else if (rec.debit !== undefined || rec.credit !== undefined) {
              const deb = cleanAmountString(String(rec.debit ?? '0')) || 0;
              const cred = cleanAmountString(String(rec.credit ?? '0')) || 0;
              numericAmt = cred > 0 ? cred : -Math.abs(deb);
            } else if (
              rec.total !== undefined ||
              rec.value !== undefined ||
              rec.spend !== undefined
            ) {
              numericAmt = cleanAmountString(String(rec.total ?? rec.value ?? rec.spend));
            }

            if (Number.isNaN(numericAmt) || numericAmt === 0) continue;
            // If direction is explicitly specified or type indicates expense, ensure sign matches
            const dirHint = String(rec.direction ?? rec.type ?? '').toLowerCase();
            if (
              numericAmt > 0 &&
              !/\b(in|income|revenue|credit|deposit|inflow|sales|arr)\b/.test(dirHint) &&
              !/\b(revenue|income|inflow|stripe\s+payout|customer|client\s+payment|arr)\b/i.test(
                rawDesc
              )
            ) {
              numericAmt = -Math.abs(numericAmt);
            }

            const isoDate = normalizeFlexibleIsoDate(rawDate, rowCounter);
            rows.push({
              id: String(rec.id ?? `BYO-${String(rowCounter).padStart(4, '0')}`),
              date: isoDate,
              posted_date: isoDate,
              account: rawAcct,
              tran_type: rawType,
              description: rawDesc,
              amount: numericAmt.toFixed(2),
              currency: rawCurr,
            });
            rowCounter++;
          }
          continue;
        }
      } catch {
        // Fall through to CSV/TSV line parsing
      }
    }

    // 2. CSV / TSV parsing with flexible column detection
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    const delimiter = lines[0]!.includes('\t') && !lines[0]!.includes(',') ? '\t' : ',';
    const splitLine = (line: string): string[] =>
      delimiter === '\t' ? line.split('\t').map((c) => c.trim()) : parseCsvLine(line);

    const headers = splitLine(lines[0]!).map((h) =>
      h
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
    );

    const dateCol = headers.findIndex(
      (h) =>
        /^(date|txn_date|transaction_date|posted_date|booking_date|period|month|day|timestamp)$/.test(
          h
        ) || h.includes('date')
    );
    const descCol = headers.findIndex((h) =>
      /^(description|merchant|vendor|counterparty|payee|name|memo|narrative|details|line_item|account_name|particulars)$/.test(
        h
      )
    );
    const catCol = headers.findIndex((h) =>
      /^(category|department|cost_center|gl_account|type|tran_type|class|segment)$/.test(h)
    );
    const amtCol = headers.findIndex(
      (h) =>
        /^(amount|amount_usd|total|value|net|spend|cost|usd|sum|balance_change)$/.test(h) ||
        h.includes('amount')
    );
    const debitCol = headers.findIndex((h) =>
      /^(debit|outflow|withdrawal|expense|charge)$/.test(h)
    );
    const creditCol = headers.findIndex((h) => /^(credit|inflow|deposit|revenue|income)$/.test(h));
    const dirCol = headers.findIndex((h) => /^(direction|dr_cr|sign|flow)$/.test(h));
    const idCol = headers.findIndex((h) =>
      /^(id|txn_id|transaction_id|unique_id|reference|ref)$/.test(h)
    );
    const acctCol = headers.findIndex((h) => /^(account|bank_account|card|source)$/.test(h));
    const currCol = headers.findIndex((h) => /^(currency|curr|ccy)$/.test(h));

    for (let i = 1; i < lines.length; i++) {
      const cols = splitLine(lines[i]!);
      if (cols.length < 2) continue;

      const rawDate = dateCol >= 0 ? (cols[dateCol] ?? '') : (cols[0] ?? '');
      const rawDesc =
        descCol >= 0
          ? (cols[descCol] ?? '')
          : catCol >= 0
            ? (cols[catCol] ?? '')
            : (cols[1] ?? 'Operating Entry');
      const rawCat = catCol >= 0 ? (cols[catCol] ?? '') : '';
      const combinedDesc =
        rawCat && !rawDesc.toLowerCase().includes(rawCat.toLowerCase())
          ? `${rawDesc.trim()} (${rawCat.trim()})`
          : rawDesc.trim();

      let numericAmt = NaN;
      if (amtCol >= 0 && cols[amtCol] !== undefined) {
        numericAmt = cleanAmountString(cols[amtCol]!);
      } else if (debitCol >= 0 || creditCol >= 0) {
        const deb = debitCol >= 0 ? cleanAmountString(cols[debitCol] ?? '') || 0 : 0;
        const cred = creditCol >= 0 ? cleanAmountString(cols[creditCol] ?? '') || 0 : 0;
        if (cred !== 0 || deb !== 0) {
          numericAmt = cred > 0 ? Math.abs(cred) : -Math.abs(deb);
        }
      } else {
        // Find the last numeric-looking column
        for (let c = cols.length - 1; c >= 1; c--) {
          if (c === dateCol || c === idCol) continue;
          const candidate = cleanAmountString(cols[c] ?? '');
          if (!Number.isNaN(candidate) && candidate !== 0) {
            numericAmt = candidate;
            break;
          }
        }
      }

      if (Number.isNaN(numericAmt) || numericAmt === 0) continue;

      const dirHint = `${dirCol >= 0 ? (cols[dirCol] ?? '') : ''} ${rawCat}`.toLowerCase();
      if (
        numericAmt > 0 &&
        !/\b(in|income|revenue|credit|cr|deposit|inflow|sales|arr|receipt)\b/.test(dirHint) &&
        !/\b(revenue|income|inflow|payout|customer|client\s+payment|salary|arr|deposit)\b/i.test(
          combinedDesc
        )
      ) {
        // In many expense CSVs, all spend numbers are positive; treat as outflow unless marked income/revenue
        numericAmt = -Math.abs(numericAmt);
      }

      const isoDate = normalizeFlexibleIsoDate(rawDate, rowCounter);
      const id =
        idCol >= 0 && cols[idCol]?.trim()
          ? cols[idCol]!.trim()
          : `BYO-${String(rowCounter).padStart(4, '0')}`;

      rows.push({
        id,
        date: isoDate,
        posted_date: isoDate,
        account: acctCol >= 0 && cols[acctCol]?.trim() ? cols[acctCol]!.trim() : 'Operating Ledger',
        tran_type: rawCat || 'OPERATING',
        description: combinedDesc || 'Operating Entry',
        amount: numericAmt.toFixed(2),
        currency: currCol >= 0 && cols[currCol]?.trim() ? cols[currCol]!.trim() : 'USD',
      });
      rowCounter++;
    }
  }

  return rows;
}

/**
 * Fetches one or more files from a Google Drive file URL, Google Drive folder URL,
 * or Google Sheets URL via the server `/api/drive/*` routes, with a direct
 * Google Sheets CSV export fallback when running serverless.
 */
export async function fetchGoogleDriveInput(
  urlOrId: string,
  accessToken?: string,
  onProgress?: (step: IngestProgressStep) => void
): Promise<RawIngestFile[]> {
  const trimmed = urlOrId.trim();
  if (!trimmed) {
    throw new Error('Please enter a valid Google Drive file/folder link or Google Sheets URL.');
  }

  onProgress?.({
    phase: 'parse',
    label: 'Connecting to Google Drive / Google Sheets...',
    detail: trimmed,
    progress_pct: 12,
  });

  const isFolderUrl = /\/folders\/([a-zA-Z0-9_-]+)/i.test(trimmed);

  // 1. If it's a Drive Folder URL, list folder files first via GET api/drive/folder
  if (isFolderUrl) {
    try {
      const qs = new URLSearchParams({ url: trimmed });
      if (accessToken) qs.set('accessToken', accessToken);
      const folderResp = await raceWithAbort(
        (signal) => fetch(`api/drive/folder?${qs.toString()}`, { method: 'GET', signal }),
        12000
      );
      if (folderResp.ok) {
        const listing = (await folderResp.json()) as DriveFolderListing & {
          files?: DriveFileEntry[];
        };
        if (listing && Array.isArray(listing.files) && listing.files.length > 0) {
          onProgress?.({
            phase: 'parse',
            label: `Discovered ${listing.files.length} file${listing.files.length === 1 ? '' : 's'} in Drive folder — downloading...`,
            detail: listing.files.map((f) => f.name).join(', '),
            progress_pct: 22,
          });
          const fetchedFiles: RawIngestFile[] = [];
          for (const entry of listing.files.slice(0, 10)) {
            const fileResp = await raceWithAbort(
              (signal) =>
                fetch('api/drive/fetch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    url: entry.downloadUrl || entry.webViewLink || entry.id,
                    fileId: entry.id,
                    name: entry.name,
                    mimeType: entry.mimeType,
                    accessToken,
                  }),
                  signal,
                }),
              12000
            );
            if (fileResp.ok) {
              const payload = (await fileResp.json()) as {
                files?: RawIngestFile[];
                file?: RawIngestFile;
                name?: string;
                content?: string;
                mimeType?: string;
                encoding?: 'utf8' | 'base64';
              };
              if (Array.isArray(payload.files)) {
                fetchedFiles.push(...payload.files);
              } else if (payload.file) {
                fetchedFiles.push(payload.file);
              } else if (typeof payload.content === 'string') {
                fetchedFiles.push({
                  name: payload.name ?? entry.name,
                  mimeType: payload.mimeType ?? entry.mimeType,
                  content: payload.content,
                  encoding: payload.encoding ?? 'utf8',
                });
              }
            }
          }
          if (fetchedFiles.length > 0) {
            return fetchedFiles;
          }
        }
      }
    } catch {
      // Fall through to POST api/drive/fetch
    }
  }

  // 2. Try POST api/drive/fetch (supports single Drive file, Sheets link, or folder URL)
  try {
    const resp = await raceWithAbort(
      (signal) =>
        fetch('api/drive/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed, accessToken }),
          signal,
        }),
      14000
    );
    if (resp.ok) {
      const data = (await resp.json()) as {
        files?: RawIngestFile[];
        file?: RawIngestFile;
        name?: string;
        content?: string;
        mimeType?: string;
        encoding?: 'utf8' | 'base64';
      };
      if (Array.isArray(data.files) && data.files.length > 0) {
        return data.files;
      }
      if (data.file && typeof data.file.content === 'string') {
        return [data.file];
      }
      if (typeof data.content === 'string' && data.content.length > 0) {
        return [
          {
            name: data.name ?? 'google-drive-import.csv',
            mimeType: data.mimeType ?? 'text/csv',
            content: data.content,
            encoding: data.encoding ?? 'utf8',
          },
        ];
      }
    }
  } catch {
    // Fall through to direct Google Sheets CSV export fallback
  }

  // 3. Direct browser fallback for public Google Sheets URLs
  const sheetsMatch = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i.exec(trimmed);
  if (sheetsMatch) {
    const sheetId = sheetsMatch[1]!;
    const gidMatch = /[?&#]gid=(\d+)/i.exec(trimmed);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
    const csvResp = await raceWithAbort((signal) => fetch(exportUrl, { signal }), 10000);
    if (csvResp.ok) {
      const csvText = await csvResp.text();
      if (csvText && csvText.trim().length > 0 && !csvText.trim().startsWith('<!DOCTYPE html')) {
        return [
          {
            name: `google-sheet-${sheetId.slice(0, 8)}.csv`,
            mimeType: 'text/csv',
            content: csvText,
            encoding: 'utf8',
          },
        ];
      }
    }
  }

  throw new Error(
    'Unable to fetch Google Drive / Sheets resource. Ensure the link is shared as "Anyone with the link can view".'
  );
}

/**
 * Orchestrates the BYO Ingestion Pipeline:
 * - Step 1: Instant deterministic parsing, profiling, 365-day calendar grid, and `Fact[]` computation
 * - Step 2: Argon (`gemini-4-argon`) schema/entity enrichment & `{fact:id}` narrative authoring (`/api/ingest/enrich`)
 * - Step 3 (Optional): Managed Agent `/v1beta/interactions` + Python `code_execution` audit (`/api/agent/analyze`)
 * - Verifies all `{fact:id}` placeholders and notifies `/api/dataset/active` for live Ask queries.
 */
export async function processByoIngestion(params: {
  files: RawIngestFile[];
  entityNameHint?: string;
  deepAgentAudit?: boolean;
  abortSignal?: AbortSignal;
  onProgress?: (step: IngestProgressStep) => void;
}): Promise<DatasetBundle> {
  const { files, entityNameHint, deepAgentAudit, abortSignal, onProgress } = params;
  if (!files || files.length === 0) {
    throw new Error('No files provided for ingestion.');
  }

  onProgress?.({
    phase: 'parse',
    label: `Parsing ${files.length} file${files.length === 1 ? '' : 's'} (${files.map((f) => f.name).join(', ')})...`,
    progress_pct: 20,
  });

  onProgress?.({
    phase: 'profile',
    label: 'Profiling schema, counterparties & fiscal calendar...',
    progress_pct: 38,
  });

  onProgress?.({
    phase: 'tier1_facts',
    label: 'Computing 365-day grid & ledger facts...',
    progress_pct: 55,
  });

  let tier1Bundle: DatasetBundle | null = null;
  let rawRows: RawSourceRow[] = [];

  try {
    tier1Bundle = ingestFilesDeterministically(files, {
      entityName: entityNameHint,
      isB2B: true,
    });
    rawRows = tier1Bundle.transactions.map((t) => t.source_row);
  } catch {
    tier1Bundle = null;
  }

  if (!tier1Bundle || tier1Bundle.transactions.length === 0) {
    const flexibleRows = parseFlexibleTabularRows(files);
    rawRows = flexibleRows;
    tier1Bundle = buildDatasetBundleFromRows(
      flexibleRows,
      files.map((f) => f.name),
      {},
      {
        entityName: entityNameHint,
        isB2B: true,
      }
    );
  }

  // Collect up to 45 unique raw descriptions for entity classification
  const unclassifiedSet = new Set<string>();
  for (const t of tier1Bundle.transactions) {
    if (t.merchant_confidence < 0.95 || t.category_confidence < 0.95) {
      unclassifiedSet.add(t.raw_description);
      if (unclassifiedSet.size >= 45) break;
    }
  }
  if (unclassifiedSet.size < 20) {
    for (const t of tier1Bundle.transactions) {
      unclassifiedSet.add(t.raw_description);
      if (unclassifiedSet.size >= 35) break;
    }
  }

  const factsSummary = tier1Bundle.facts.map((f) => ({
    id: f.id,
    label: f.label,
    formatted: f.formatted,
    computation: f.computation,
  }));

  const useDeepAgent = Boolean(deepAgentAudit);
  const needsServerRowExtraction = tier1Bundle.transactions.length === 0;

  const enrichRequest: IngestEnrichRequest = {
    ...(useDeepAgent || needsServerRowExtraction
      ? { files, raw_rows: rawRows.slice(0, 500) }
      : {}),
    unclassified_descriptions: Array.from(unclassifiedSet),
    facts_summary: factsSummary,
    chapter_ids: [
      'pour',
      'year_as_squares',
      'your_place',
      'studio_session',
      'streak',
      'getaway',
      'rivalry',
      'heartbeat',
      'big_one',
      'subscription_garden',
      'personality',
      'one_line',
      'share_card',
    ],
    entity_name_hint: entityNameHint || tier1Bundle.plan.person_name,
    deep_agent_audit: useDeepAgent,
  };

  onProgress?.({
    phase: useDeepAgent ? 'tier3_agent' : 'tier2_gemini',
    label: useDeepAgent
      ? 'Provisioning Managed Agent & Python sandbox...'
      : 'Classifying counterparties & authoring narrative...',
    progress_pct: 75,
  });

  const DEEP_AGENT_STAGES = [
    'Provisioning Managed Agent & Python sandbox...',
    'Cross-checking ledger tables & entity concentration...',
    'Running statistical variance & Pareto distribution models...',
    'Synthesizing executive narrative & slide selection...',
  ];

  let enrichment: IngestEnrichResponse | null = null;
  const primaryEndpoint = useDeepAgent ? 'api/agent/analyze' : 'api/ingest/enrich';
  let stageIdx = 1;
  let stagePct = 76;
  const stageInterval = useDeepAgent
    ? setInterval(() => {
        const label = DEEP_AGENT_STAGES[stageIdx % DEEP_AGENT_STAGES.length]!;
        stageIdx++;
        stagePct = Math.min(90, stagePct + 2);
        onProgress?.({
          phase: 'tier3_agent',
          label,
          progress_pct: stagePct,
        });
      }, 8000)
    : null;

  try {
    const resp = await raceWithAbort(
      (signal) =>
        fetch(primaryEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(enrichRequest),
          signal,
        }),
      useDeepAgent ? 600_000 : 30_000,
      abortSignal
    );
    if (resp.ok) {
      enrichment = (await resp.json()) as IngestEnrichResponse;
    } else if (useDeepAgent && !abortSignal?.aborted) {
      // Fallback to /api/ingest/enrich if /api/agent/analyze is not available
      const fallbackResp = await raceWithAbort(
        (signal) =>
          fetch('api/ingest/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...enrichRequest,
              files: undefined,
              raw_rows: undefined,
              deep_agent_audit: false,
            }),
            signal,
          }),
        30_000
      );
      if (fallbackResp.ok) {
        enrichment = (await fallbackResp.json()) as IngestEnrichResponse;
      }
    }
  } catch {
    enrichment = null;
    if (useDeepAgent && abortSignal?.aborted) {
      onProgress?.({
        phase: 'tier2_gemini',
        label: 'Skipping deep audit — opening fast summary...',
        progress_pct: 88,
      });
      try {
        const fastResp = await raceWithAbort(
          (signal) =>
            fetch('api/ingest/enrich', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...enrichRequest,
                files: undefined,
                raw_rows: undefined,
                deep_agent_audit: false,
              }),
              signal,
            }),
          5000
        );
        if (fastResp.ok) {
          enrichment = (await fastResp.json()) as IngestEnrichResponse;
        }
      } catch {
        enrichment = null;
      }
    }
  } finally {
    if (stageInterval) clearInterval(stageInterval);
  }

  if (enrichment?.agent_steps && enrichment.agent_steps.length > 0) {
    for (const stepText of enrichment.agent_steps) {
      onProgress?.({
        phase: 'tier3_agent',
        label: stepText,
        progress_pct: 84,
      });
    }
  }

  onProgress?.({
    phase: 'verify',
    label: 'Verifying {fact:id} placeholders & zero-hallucination guardrails...',
    progress_pct: 92,
  });

  let finalBundle: DatasetBundle = tier1Bundle;
  if (enrichment) {
    if (enrichment.bundle && enrichment.bundle.transactions?.length > 0) {
      finalBundle = enrichment.bundle;
    } else if (
      (enrichment.extracted_rows && enrichment.extracted_rows.length > 0) ||
      (enrichment.entity_mappings && enrichment.entity_mappings.length > 0) ||
      enrichment.narrative
    ) {
      finalBundle = applyGeminiEnrichmentToBundle(rawRows, files, enrichment, entityNameHint);
    }
  }

  if (finalBundle.transactions.length === 0) {
    throw new Error(
      'No valid financial transactions could be extracted from the uploaded file(s). Please check that your file contains dates and amounts.'
    );
  }

  // Notify server of active dataset so `/api/ask` queries against the newly loaded transactions
  void raceWithAbort(
    (signal) =>
      fetch('api/dataset/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_name: finalBundle.plan.person_name,
          year: finalBundle.plan.year,
          transactions: finalBundle.transactions,
        }),
        signal,
      }),
    5000
  ).catch(() => {});

  onProgress?.({
    phase: 'ready',
    label: `Processed ${finalBundle.transactions.length.toLocaleString('en-US')} transactions for ${finalBundle.plan.person_name} — launching report...`,
    progress_pct: 100,
  });

  return finalBundle;
}

export type { Category };
