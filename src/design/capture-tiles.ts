/**
 * Style-Tile & Prototype Frame Capture Runner (`src/design/capture-tiles.ts`)
 *
 * Renders the 5 signature chapter layouts (`your_place`, `year_as_squares`,
 * `personality`, `pour`, `shatter`) in Playwright Headless Chromium at
 * `1920×1080`, `1440×900`, and `390×844` and saves PNGs to `app/design/style-tiles/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import type { StyleTileChapterId, StyleTileViewport } from './prototype.js';

const APP_ROOT = path.resolve(import.meta.dirname, '../..');
const OUT_DIR = path.join(APP_ROOT, 'design', 'style-tiles');

const CHAPTERS: readonly StyleTileChapterId[] = [
  'your_place',
  'year_as_squares',
  'personality',
  'pour',
  'shatter',
];

const VIEWPORTS: ReadonlyArray<{ id: StyleTileViewport; width: number; height: number }> = [
  { id: '1920x1080', width: 1920, height: 1080 },
  { id: '1440x900', width: 1440, height: 900 },
  { id: '390x844', width: 390, height: 844 },
];

export async function captureAllStyleTiles(): Promise<string[]> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const savedFiles: string[] = [];

  const vite = await createServer({
    root: APP_ROOT,
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'error',
    plugins: [
      {
        name: 'style-tile-route',
        configureServer(server) {
          server.middlewares.use('/__style_tile__', async (req, res, next) => {
            try {
              const rawHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Style Tile Capture</title>
  </head>
  <body class="tile-capture">
    <div id="tile-root"></div>
    <script type="module">
      import '@fontsource/inter-tight/300.css';
      import '@fontsource/inter-tight/400.css';
      import '@fontsource/inter-tight/500.css';
      import '@fontsource/jetbrains-mono/400.css';
      import '@fontsource/jetbrains-mono/500.css';
      import '@fontsource/jetbrains-mono/600.css';
      import { mountDesignPrototype } from '/src/design/index.ts';
      import transactions from '/data/transactions.json';
      import days from '/data/days.json';
      import facts from '/data/facts.json';

      const root = document.getElementById('tile-root');
      mountDesignPrototype(root, {
        tileMode: true,
        dataset: { transactions, days, facts },
      });
      window.__TILE_READY__ = true;
    </script>
  </body>
</html>`;
              const html = await server.transformIndexHtml(req.url ?? '/__style_tile__', rawHtml);
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(html);
            } catch (e) {
              next(e);
            }
          });
        },
      },
    ],
  });

  await vite.listen();
  const address = vite.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 4173;
  const url = `http://127.0.0.1:${port}/__style_tile__`;

  const browser = await chromium.launch({ headless: true });

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() =>
        Boolean((window as unknown as Record<string, unknown>).__TILE_READY__)
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      for (const ch of CHAPTERS) {
        await page.evaluate(
          ({ chapterId, viewportId }) => {
            const api = (
              window as unknown as Record<
                string,
                { renderStyleTile: (c: string, v: string) => void }
              >
            ).__DESIGN_PROTOTYPE__;
            api!.renderStyleTile(chapterId, viewportId);
          },
          { chapterId: ch, viewportId: vp.id }
        );
        await page.waitForTimeout(80);
        const filename = `${ch}_${vp.id}.png`;
        const outPath = path.join(OUT_DIR, filename);
        await page.screenshot({ path: outPath, fullPage: false });
        savedFiles.push(outPath);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    await vite.close();
  }

  return savedFiles;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  captureAllStyleTiles()
    .then((files) => {
      console.log(`Captured ${files.length} style tiles in ${OUT_DIR}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
