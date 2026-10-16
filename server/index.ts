/**
 * Runtime HTTP & API Server (`server/index.ts`)
 *
 * Serves:
 * - `GET  /api/health`         -> Server, active dataset & model health check
 * - `GET  /api/ask?q=`         -> Query-string convenience wrapper for `/api/ask`
 * - `POST /api/ask`            -> Question -> `AskQueryDSL` -> `executeAskQuery` -> `AskQueryResult`
 * - `POST /api/dataset/active` -> Updates active in-memory `Transaction[]` for BYO datasets
 * - `POST /api/ingest/enrich`  -> Tier 2 Gemini structured ingestion enrichment
 * - `POST /api/agent/analyze`  -> Tier 3 Managed Agent (`/v1beta/interactions` + Python `code_execution`) audit
 * - `GET  /api/drive/folder`   -> Google Drive folder / Google Sheet listing
 * - `POST /api/drive/fetch`    -> Google Drive file / Google Sheet content fetcher
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AskQueryDSL,
  IngestEnrichRequest,
  RawIngestFile,
  RawSourceRow,
  Transaction,
} from '../contracts/index.js';
import { buildMockDataset } from '../data/mock/index.js';
import {
  applyGeminiEnrichmentToBundle,
  ingestFilesDeterministically,
} from '../pipeline/ingest-business.js';
import { executeAskQuery } from '../src/ask/executor.js';
import { validateAskQueryDSL } from '../src/ask/validator.js';
import { loadServerConfig, resolveRuntimeApiKey, type ServerConfig } from './config.js';
import { fetchDriveFileContent, listDriveFolder } from './drive.js';
import { enrichDatasetWithGemini, translateQuestionToDSL } from './gemini.js';
import { runManagedAgentAudit } from './managed-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(APP_ROOT, 'dist');
const CAPTURE_DIR = path.join(APP_ROOT, 'capture');
const TRANSACTIONS_JSON_PATH = path.join(APP_ROOT, 'data', 'transactions.json');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
};

/**
 * Load real 2025 `Transaction[]` from `data/transactions.json`, falling back
 * to `buildMockDataset().transactions` only if `data/transactions.json` is absent.
 */
export function loadRealOrFallbackTransactions(): Transaction[] {
  if (fs.existsSync(TRANSACTIONS_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(TRANSACTIONS_JSON_PATH, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as Transaction[];
      }
    } catch {
      // Fall through to mock dataset
    }
  }
  return buildMockDataset().transactions;
}

export function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > 35 * 1024 * 1024) {
        reject(new Error('Request body too large (exceeds 35MB limit).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve({});
          return;
        }
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
          resolve(parsed as Record<string, unknown>);
        } else {
          resolve({});
        }
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function extractAccessToken(
  req: http.IncomingMessage,
  parsedUrl: URL,
  body?: Record<string, unknown>
): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const tok = auth.slice('Bearer '.length).trim();
    if (tok) return tok;
  }
  const queryTok = parsedUrl.searchParams.get('accessToken')?.trim();
  if (queryTok) return queryTok;
  if (typeof body?.accessToken === 'string' && body.accessToken.trim()) {
    return body.accessToken.trim();
  }
  return undefined;
}

function hydrateIngestEnrichRequest(reqBody: IngestEnrichRequest): {
  hydrated: IngestEnrichRequest;
  baseRows: RawSourceRow[];
  files: RawIngestFile[];
} {
  const files = Array.isArray(reqBody.files) ? reqBody.files : [];
  if (files.length > 0) {
    const baseBundle = ingestFilesDeterministically(files, {
      entityName: reqBody.entity_name_hint,
      isB2B: true,
    });
    const baseRows =
      Array.isArray(reqBody.raw_rows) && reqBody.raw_rows.length > 0
        ? reqBody.raw_rows
        : baseBundle.transactions.map((t) => t.source_row);
    const unclassified =
      Array.isArray(reqBody.unclassified_descriptions) &&
      reqBody.unclassified_descriptions.length > 0
        ? reqBody.unclassified_descriptions
        : Array.from(
            new Set(
              baseBundle.transactions
                .filter((t) => t.category_confidence < 0.75)
                .map((t) => t.raw_description)
            )
          ).slice(0, 50);
    const factsSummary =
      Array.isArray(reqBody.facts_summary) && reqBody.facts_summary.length > 0
        ? reqBody.facts_summary
        : baseBundle.facts.map((f) => ({
            id: f.id,
            label: f.label,
            formatted: f.formatted,
            computation: f.computation,
          }));
    const chapterIds =
      Array.isArray(reqBody.chapter_ids) && reqBody.chapter_ids.length > 0
        ? reqBody.chapter_ids
        : [
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
          ];

    return {
      hydrated: {
        ...reqBody,
        raw_rows: baseRows,
        unclassified_descriptions: unclassified,
        facts_summary: factsSummary,
        chapter_ids: chapterIds,
      },
      baseRows,
      files,
    };
  }

  return {
    hydrated: reqBody,
    baseRows: Array.isArray(reqBody.raw_rows) ? reqBody.raw_rows : [],
    files: [],
  };
}

export interface ApiHandlerOptions {
  transactions?: readonly Transaction[];
  config?: ServerConfig;
}

/**
 * Create a reusable HTTP API handler for `/api/*` endpoints.
 * Returns `true` if the request matched an API route and was handled, `false` otherwise.
 */
export function createApiHandler(
  options?: ApiHandlerOptions
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> {
  const initialConfig = options?.config ?? loadServerConfig();
  let activeTransactions: readonly Transaction[] =
    options?.transactions ?? loadRealOrFallbackTransactions();

  function getEffectiveConfig(): ServerConfig {
    if (options?.config !== undefined) {
      return initialConfig;
    }
    const freshKey = resolveRuntimeApiKey();
    if (freshKey && freshKey !== initialConfig.apiKey) {
      return {
        ...initialConfig,
        apiKey: freshKey,
        hasApiKey: true,
      };
    }
    return initialConfig;
  }

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const method = req.method ?? 'GET';
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const pathname = parsedUrl.pathname;

    if (!pathname.startsWith('/api/')) {
      return false;
    }

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return true;
    }

    const config = getEffectiveConfig();

    // 1. GET /api/health
    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        status: 'ok',
        model: config.modelName,
        hasApiKey: config.hasApiKey,
        transactionCount: activeTransactions.length,
      });
      return true;
    }

    // 2. POST /api/dataset/active
    if (pathname === '/api/dataset/active' && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const candidateTxns = Array.isArray(body.transactions)
          ? body.transactions
          : typeof body.bundle === 'object' &&
              body.bundle !== null &&
              Array.isArray((body.bundle as Record<string, unknown>).transactions)
            ? ((body.bundle as Record<string, unknown>).transactions as unknown[])
            : null;

        if (!candidateTxns || candidateTxns.length === 0) {
          sendJson(res, 400, { error: 'Expected non-empty `transactions` array.' });
          return true;
        }

        activeTransactions = candidateTxns as Transaction[];
        sendJson(res, 200, {
          ok: true,
          transactionCount: activeTransactions.length,
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update active dataset.';
        sendJson(res, 500, { error: message });
        return true;
      }
    }

    // 3. GET /api/ask & POST /api/ask
    if (pathname === '/api/ask' && (method === 'POST' || method === 'GET')) {
      try {
        let question = '';
        let explicitDsl: AskQueryDSL | undefined;
        let requestTransactions: readonly Transaction[] = activeTransactions;

        if (method === 'GET') {
          question = (
            parsedUrl.searchParams.get('q') ??
            parsedUrl.searchParams.get('question') ??
            ''
          ).trim();
        } else {
          const body = await readJsonBody(req);
          if (typeof body.question === 'string') {
            question = body.question.trim();
          }
          if (Array.isArray(body.transactions) && body.transactions.length > 0) {
            requestTransactions = body.transactions as Transaction[];
            activeTransactions = requestTransactions;
          }
          if (typeof body.query === 'object' && body.query !== null) {
            const validated = validateAskQueryDSL(body.query, question, requestTransactions);
            explicitDsl = validated.query;
          }
        }

        if (!question && !explicitDsl) {
          sendJson(res, 400, {
            error: 'Missing `question` or `query` in request.',
          });
          return true;
        }

        if (explicitDsl) {
          const result = executeAskQuery(explicitDsl, requestTransactions, {
            question: question || explicitDsl.interpretation,
            source: 'builder',
          });
          sendJson(res, 200, result);
          return true;
        }

        const translated = await translateQuestionToDSL(question, config, requestTransactions);
        const result = executeAskQuery(translated.query, requestTransactions, {
          question,
          source: translated.source,
        });
        sendJson(res, 200, result);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        sendJson(res, 500, { error: message });
        return true;
      }
    }

    // 4. POST /api/ingest/enrich (Tier 2 Gemini Enrichment)
    if (pathname === '/api/ingest/enrich' && method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as unknown as IngestEnrichRequest;
        const { hydrated, baseRows, files } = hydrateIngestEnrichRequest(body);
        const enrichment = await enrichDatasetWithGemini(hydrated, config);

        const effectiveRows =
          enrichment.extracted_rows && enrichment.extracted_rows.length > 0
            ? enrichment.extracted_rows
            : baseRows;

        if (effectiveRows.length > 0 || files.length > 0) {
          const bundle = applyGeminiEnrichmentToBundle(
            effectiveRows,
            files,
            enrichment,
            body.entity_name_hint
          );
          activeTransactions = bundle.transactions;
          sendJson(res, 200, {
            ...enrichment,
            bundle,
          });
          return true;
        }

        sendJson(res, 200, enrichment);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enrich dataset.';
        sendJson(res, 500, { error: message });
        return true;
      }
    }

    // 5. POST /api/agent/analyze (Tier 3 Managed Agent + Python code_execution Audit)
    if (pathname === '/api/agent/analyze' && method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as unknown as IngestEnrichRequest;
        const { hydrated, baseRows, files } = hydrateIngestEnrichRequest(body);
        const agentResponse = await runManagedAgentAudit(hydrated, config);

        const effectiveRows =
          agentResponse.extracted_rows && agentResponse.extracted_rows.length > 0
            ? agentResponse.extracted_rows
            : baseRows;

        if (effectiveRows.length > 0 || files.length > 0) {
          const bundle = applyGeminiEnrichmentToBundle(
            effectiveRows,
            files,
            agentResponse,
            body.entity_name_hint
          );
          activeTransactions = bundle.transactions;
          sendJson(res, 200, {
            ...agentResponse,
            bundle,
          });
          return true;
        }

        sendJson(res, 200, agentResponse);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Managed Agent audit failed.';
        sendJson(res, 500, { error: message });
        return true;
      }
    }

    // 6. GET / POST /api/drive/folder
    if (pathname === '/api/drive/folder' && (method === 'GET' || method === 'POST')) {
      try {
        const body = method === 'POST' ? await readJsonBody(req) : {};
        const urlOrId = (
          parsedUrl.searchParams.get('url') ??
          parsedUrl.searchParams.get('folderUrl') ??
          parsedUrl.searchParams.get('id') ??
          (typeof body.url === 'string' ? body.url : '') ??
          (typeof body.folderUrl === 'string' ? body.folderUrl : '')
        ).trim();

        if (!urlOrId) {
          sendJson(res, 400, { error: 'Missing `url` parameter for Google Drive folder/sheet.' });
          return true;
        }

        const accessToken = extractAccessToken(req, parsedUrl, body);
        const listing = await listDriveFolder(urlOrId, accessToken);
        sendJson(res, 200, listing);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list Google Drive folder.';
        sendJson(res, 400, { error: message });
        return true;
      }
    }

    // 7. POST / GET /api/drive/fetch
    if (
      (pathname === '/api/drive/fetch' || pathname === '/api/drive/fetch-file') &&
      (method === 'POST' || method === 'GET')
    ) {
      try {
        const body = method === 'POST' ? await readJsonBody(req) : {};
        const explicitFileId = (
          (typeof body.fileId === 'string' ? body.fileId : '') ||
          parsedUrl.searchParams.get('fileId') ||
          ''
        ).trim();
        const fileIdOrUrl = (
          explicitFileId ||
          (typeof body.url === 'string' ? body.url : '') ||
          (typeof body.id === 'string' ? body.id : '') ||
          parsedUrl.searchParams.get('url') ||
          parsedUrl.searchParams.get('id') ||
          ''
        ).trim();

        if (!fileIdOrUrl) {
          sendJson(res, 400, { error: 'Missing `fileId` or `url` to fetch from Google Drive.' });
          return true;
        }

        const accessToken = extractAccessToken(req, parsedUrl, body);

        // If a folder URL was sent directly to /api/drive/fetch without an explicit fileId,
        // list the folder and download up to 10 files automatically.
        if (!explicitFileId && /\/folders\/([a-zA-Z0-9_-]{10,})/i.test(fileIdOrUrl)) {
          const listing = await listDriveFolder(fileIdOrUrl, accessToken);
          const fetchedFiles: RawIngestFile[] = [];
          for (const entry of listing.files.slice(0, 10)) {
            try {
              const rf = await fetchDriveFileContent(
                entry.downloadUrl || entry.id,
                entry.mimeType,
                accessToken,
                entry.name
              );
              fetchedFiles.push(rf);
            } catch {
              // Skip unreadable individual file inside folder
            }
          }
          sendJson(res, 200, {
            folder: listing,
            files: fetchedFiles,
            file: fetchedFiles[0],
          });
          return true;
        }

        const mimeType =
          typeof body.mimeType === 'string'
            ? body.mimeType
            : (parsedUrl.searchParams.get('mimeType') ?? undefined);
        const fileName =
          typeof body.fileName === 'string'
            ? body.fileName
            : typeof body.name === 'string'
              ? body.name
              : (parsedUrl.searchParams.get('fileName') ?? undefined);

        const rawFile = await fetchDriveFileContent(fileIdOrUrl, mimeType, accessToken, fileName);

        sendJson(res, 200, {
          ...rawFile,
          file: rawFile,
          files: [rawFile],
        });
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch file from Google Drive.';
        sendJson(res, 400, { error: message });
        return true;
      }
    }

    sendJson(res, 404, { error: `Unknown API endpoint: ${pathname}` });
    return true;
  };
}

export function createAskHttpServer(options?: ApiHandlerOptions): http.Server {
  const handleApi = createApiHandler(options);

  return http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const pathname = parsedUrl.pathname;

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const handledByApi = await handleApi(req, res);
    if (handledByApi) {
      return;
    }

    // Serve capture deliverables from `capture/` if requested
    if (
      pathname.startsWith('/capture/') &&
      fs.existsSync(CAPTURE_DIR) &&
      (method === 'GET' || method === 'HEAD')
    ) {
      const relCapture = pathname.replace(/^\/capture\/+/, '');
      const candidateCapture = path.resolve(CAPTURE_DIR, relCapture);
      if (
        candidateCapture.startsWith(CAPTURE_DIR) &&
        fs.existsSync(candidateCapture) &&
        fs.statSync(candidateCapture).isFile()
      ) {
        const ext = path.extname(candidateCapture).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        if (method === 'HEAD') {
          res.end();
        } else {
          fs.createReadStream(candidateCapture).pipe(res);
        }
        return;
      }
    }

    // Serve static files from `dist/` if built
    if (fs.existsSync(DIST_DIR) && (method === 'GET' || method === 'HEAD')) {
      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const candidatePath = path.resolve(DIST_DIR, relPath);

      if (candidatePath.startsWith(DIST_DIR)) {
        const targetFile =
          fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
            ? candidatePath
            : path.join(DIST_DIR, 'index.html');

        if (fs.existsSync(targetFile)) {
          const ext = path.extname(targetFile).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          if (method === 'HEAD') {
            res.end();
          } else {
            fs.createReadStream(targetFile).pipe(res);
          }
          return;
        }
      }
    }

    // Fallback to root `index.html` if `dist/` has not been built yet
    const rootIndexHtml = path.join(APP_ROOT, 'index.html');
    if (
      (pathname === '/' || pathname === '/index.html') &&
      fs.existsSync(rootIndexHtml) &&
      (method === 'GET' || method === 'HEAD')
    ) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(rootIndexHtml).pipe(res);
      }
      return;
    }

    sendJson(res, 404, { error: `Not found: ${pathname}` });
  });
}

// Start server when run directly via `tsx server/index.ts`
const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedScript === __filename) {
  const config = loadServerConfig();
  const server = createAskHttpServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(
      `[AskServer] Listening on http://${config.host}:${config.port} (model=${config.modelName}, key=${config.hasApiKey ? 'configured' : 'offline-fallback'})`
    );
  });
}
