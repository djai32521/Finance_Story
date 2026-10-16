/**
 * AI Studio Full-Stack Root Entrypoint (`server.ts`)
 *
 * Boots an HTTP server that:
 * 1. Parses `--port <N>` / `--port=<N>` and `process.env.PORT || 3000`, binding to `'0.0.0.0'`
 *    (compatible with AI Studio's `npm run dev -- --port 3000 --host 0.0.0.0` behind nginx `8080 -> 3000`).
 * 2. Routes all `/api/*` requests through `createApiHandler` from `./server/index.js`.
 * 3. Mounts Vite in middleware mode (`createViteServer({ server: { middlewareMode: true }, appType: 'spa' })`)
 *    or serves static `dist/` when `NODE_ENV === 'production'` and `dist/index.html` exists.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from './server/config.js';
import { createApiHandler } from './server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');

const STATIC_MIME_TYPES: Record<string, string> = {
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

function resolvePortAndHost(): { port: number; host: string } {
  const args = process.argv.slice(2);
  let cliPort: number | null = null;
  let cliHost: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--port' && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1]!, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        cliPort = parsed;
      }
      i++;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        cliPort = parsed;
      }
    } else if (arg === '--host' && args[i + 1]) {
      cliHost = args[i + 1]!.trim();
      i++;
    } else if (arg.startsWith('--host=')) {
      cliHost = arg.slice('--host='.length).trim();
    }
  }

  const envPort = Number.parseInt(process.env.PORT || '3000', 10);
  const port = cliPort ?? (Number.isInteger(envPort) && envPort > 0 ? envPort : 3000);
  const host = cliHost || process.env.HOST?.trim() || '0.0.0.0';

  return { port, host };
}

async function startFullStackServer(): Promise<void> {
  const config = loadServerConfig();
  const { port, host } = resolvePortAndHost();
  const handleApi = createApiHandler({ config });

  const useStaticDist =
    process.env.NODE_ENV === 'production' && fs.existsSync(path.join(DIST_DIR, 'index.html'));

  let viteMiddleware: ((
    req: http.IncomingMessage,
    res: http.ServerResponse,
    next?: (err?: unknown) => void
  ) => void) | null = null;

  if (!useStaticDist) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    viteMiddleware = vite.middlewares as unknown as (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      next?: (err?: unknown) => void
    ) => void;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const handled = await handleApi(req, res);
      if (handled) {
        return;
      }

      if (viteMiddleware) {
        viteMiddleware(req, res);
        return;
      }

      // Production static serving from `dist/`
      const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
      const pathname = parsedUrl.pathname;
      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const candidatePath = path.resolve(DIST_DIR, relPath);

      if (candidatePath.startsWith(DIST_DIR)) {
        const targetFile =
          fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
            ? candidatePath
            : path.join(DIST_DIR, 'index.html');

        if (fs.existsSync(targetFile)) {
          const ext = path.extname(targetFile).toLowerCase();
          const contentType = STATIC_MIME_TYPES[ext] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          if (req.method === 'HEAD') {
            res.end();
          } else {
            fs.createReadStream(targetFile).pipe(res);
          }
          return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(port, host, () => {
    console.log(
      `[FinanceStory] Full-stack server listening on http://${host}:${port} (model=${config.modelName}, key=${config.hasApiKey ? 'configured' : 'offline-fallback'})`
    );
  });
}

void startFullStackServer();
