import fs from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoryPlan } from '../contracts/index.js';
import { ingestFilesDeterministically } from '../pipeline/ingest-business.js';
import type { YearAppCaptureBridge } from '../src/player/capture-bridge.js';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const SCREENSHOTS_DIR = path.join(APP_ROOT, 'reports', 'screenshots');
const PLAN_PATH = path.join(APP_ROOT, 'story', 'plan.json');

const CHAPTER_SETTLED_SECONDS: Record<string, number> = {
  pour: 10.2,
  year_as_squares: 8.6,
  your_place: 2.8,
  bespoke_0: 2.2,
  streak: 2.2,
  getaway: 2.2,
  bespoke_1: 2.2,
  heartbeat: 2.2,
  big_one: 2.2,
  shatter: 3.0,
  personality: 3.0,
  one_line: 2.2,
  share_card: 2.2,
};

const KEY_RESPONSIVE_CHAPTER_IDS = [
  'pour',
  'year_as_squares',
  'your_place',
  'bespoke_0',
  'streak',
  'bespoke_1',
  'shatter',
  'personality',
  'share_card',
] as const;

interface ChapterAuditRow {
  index: number;
  id: string;
  type: string;
  paletteId: string;
  headline: string;
  body: string;
  hasUnresolvedFact: boolean;
  blockCount: number;
  receiptTriggerCount: number;
  svgCount: number;
  badgeText: string | null;
  screenshot1920: string;
}

describe('Phase 4 Independent Visual & Layout Verification (Playwright Headless Chromium)', () => {
  let viteServer: ViteDevServer;
  let baseUrl = '';
  let browser: Browser;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  const fontRequests: string[] = [];
  const chapterAudits: ChapterAuditRow[] = [];

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8')) as StoryPlan;

  beforeAll(async () => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    viteServer = await createServer({
      root: APP_ROOT,
      server: { port: 0, host: '127.0.0.1' },
      logLevel: 'error',
    });
    await viteServer.listen();
    const addr = viteServer.httpServer?.address();
    const port = typeof addr === 'object' && addr ? addr.port : 4173;
    baseUrl = `http://127.0.0.1:${port}/`;

    browser = await chromium.launch({ headless: true });
  }, 60000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (viteServer) {
      await viteServer.close();
    }
  }, 30000);

  async function seekChapterToSettledBeat(
    page: import('playwright').Page,
    chapterId: string,
    settledSec: number
  ): Promise<void> {
    await page.evaluate(
      ({ id, targetSec }) => {
        const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
        app.goToChapter(id);
        app.player.timeline.pause();

        const steps = Math.max(24, Math.ceil(targetSec / 0.05));
        const dt = targetSec / steps;
        for (let i = 1; i <= steps; i++) {
          app.player.timeline.seek(i * dt);
          app.player.grid.stepAndDraw(0.05);
        }
        for (let i = 0; i < 32; i++) {
          app.player.grid.stepAndDraw(0.04);
        }

        document.querySelectorAll<HTMLElement>('.od').forEach((el) => {
          const odo = (el as unknown as { _odo?: { setImmediate: () => void } })._odo;
          odo?.setImmediate();
        });

        const pY = document.querySelector<HTMLElement>('#pY');
        if (pY) {
          pY.style.clipPath = 'inset(0px 0px 0px 0px)';
          pY.style.opacity = '1';
          pY.style.visibility = 'visible';
        }
      },
      { id: chapterId, targetSec: settledSec }
    );
    await page.waitForTimeout(80);
  }

  it('renders Desktop Full HD (1920×1080) start screen, all 13 chapters, Explore, Receipts, Ask, and Share Card exports with zero console/page errors', async () => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith(baseUrl) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        externalRequests.push(url);
      }
      if (url.includes('font') || url.endsWith('.woff2') || url.endsWith('.woff')) {
        fontRequests.push(url);
      }
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app[data-ready="true"]');

    // 1. Verify self-hosted fonts loaded with zero external font requests
    const fontStatus = await page.evaluate(async () => {
      await document.fonts.ready;
      const loadedFamilies = Array.from(document.fonts).map((f) => f.family.replace(/['"]/g, ''));
      return {
        interTightLoaded:
          document.fonts.check('16px "Inter Tight"') ||
          loadedFamilies.some((f) => f.toLowerCase().includes('inter tight')),
        jetBrainsMonoLoaded:
          document.fonts.check('16px "JetBrains Mono"') ||
          loadedFamilies.some((f) => f.toLowerCase().includes('jetbrains mono')),
        totalFontFaces: document.fonts.size,
      };
    });

    expect(fontStatus.interTightLoaded).toBe(true);
    expect(fontStatus.jetBrainsMonoLoaded).toBe(true);
    expect(fontStatus.totalFontFaces).toBeGreaterThanOrEqual(6);
    expect(externalRequests).toEqual([]);

    // 2. Verify Start Screen, Hidden Header Bar (#bar), Landing Grid (#start-bg-grid), & On-Stage HUD (#stage-hud-nav)
    const startState = await page.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      const startEl = document.getElementById('start-screen');
      const openBtn = document.getElementById('start-open-btn');
      const barEl = document.getElementById('bar');
      const startBgGrid = document.getElementById('start-bg-grid');
      const hudNav = document.getElementById('stage-hud-nav');
      return {
        state: app.getState(),
        visible: Boolean(startEl && getComputedStyle(startEl).display !== 'none'),
        barDisplay: barEl ? getComputedStyle(barEl).display : 'missing',
        hasStartBgGrid: Boolean(startBgGrid),
        startBgTileCount: startBgGrid?.querySelectorAll('.start-bg-tile').length ?? 0,
        hasStageHudNav: Boolean(hudNav),
        btnText: openBtn?.textContent?.trim() ?? '',
        startText: startEl?.textContent ?? '',
      };
    });

    expect(startState.state.started).toBe(false);
    expect(startState.state.mode).toBe('start');
    expect(startState.visible).toBe(true);
    expect(startState.barDisplay).toBe('none');
    expect(startState.hasStartBgGrid).toBe(true);
    expect(startState.startBgTileCount).toBe(24);
    expect(startState.hasStageHudNav).toBe(true);
    expect(startState.btnText).toContain('Open your 2025');
    expect(startState.startText).not.toContain('{fact:');

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'start_1920x1080.png'),
      fullPage: false,
    });

    // Also capture mid-pour unscramble lens beat (t = 1.8s) & verify #ttlt-canvas 1920x1080 alignment (Feedback 5)
    await seekChapterToSettledBeat(page, 'pour', 1.8);
    const pourTitleCanvasCheck = await page.evaluate(() => {
      const ttlCanvas = document.querySelector<HTMLCanvasElement>('#ttl #ttlt-canvas');
      const ttlA = document.getElementById('ttlA');
      const ttlB = document.getElementById('ttlB');
      return {
        exists: Boolean(ttlCanvas),
        width: ttlCanvas?.width ?? 0,
        height: ttlCanvas?.height ?? 0,
        ttlATextAlign: ttlA ? getComputedStyle(ttlA).textAlign : '',
        ttlBTextAlign: ttlB ? getComputedStyle(ttlB).textAlign : '',
      };
    });
    expect(pourTitleCanvasCheck.exists).toBe(true);
    expect(pourTitleCanvasCheck.width).toBe(1920);
    expect(pourTitleCanvasCheck.height).toBe(1080);
    expect(pourTitleCanvasCheck.ttlATextAlign).toBe('center');
    expect(pourTitleCanvasCheck.ttlBTextAlign).toBe('center');

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'ch_00_pour_unscramble_1920x1080.png'),
      fullPage: false,
    });

    // 3. Step through all 13 chapters in story/plan.json at their settled hold beat
    for (let idx = 0; idx < plan.chapters.length; idx++) {
      const ch = plan.chapters[idx]!;
      const settledSec = CHAPTER_SETTLED_SECONDS[ch.id] ?? 2.2;
      await seekChapterToSettledBeat(page, ch.id, settledSec);

      const filename = `ch_${String(idx).padStart(2, '0')}_${ch.id}.png`;
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, filename),
        fullPage: false,
      });

      const domAudit = await page.evaluate((chapterId) => {
        const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
        const host = document.getElementById('chapter-host')!;
        const headlineEl =
          host.querySelector<HTMLElement>('[data-testid="chapter-headline"]') ??
          host.querySelector<HTMLElement>('#swdate');
        const bodyEl =
          host.querySelector<HTMLElement>('[data-testid="chapter-body"]') ??
          Array.from(host.querySelectorAll<HTMLElement>('.lab.tx')).find((el) =>
            el.textContent?.includes('Monday')
          ) ??
          null;
        const badgeEl = host.querySelector<HTMLElement>('[data-testid="bespoke-badge"]');
        const svgs = Array.from(host.querySelectorAll<SVGElement>('svg'));
        const nonEmptySvgs = svgs.filter((s) => s.children.length > 0);
        const blks = host.querySelectorAll('.blk').length;
        const receiptBtns = host.querySelectorAll(
          '.receipt-trigger, [data-cat-col], #share-receipts-btn'
        ).length;
        const hostText = host.textContent ?? '';
        const hostHtml = host.innerHTML;

        return {
          state: app.getState(),
          chapterId,
          headlineText: headlineEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          bodyText: bodyEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          hostUpperText: hostText.toUpperCase(),
          badgeText: badgeEl?.textContent?.trim() ?? null,
          svgCount: nonEmptySvgs.length,
          blockCount: blks,
          receiptTriggerCount: receiptBtns,
          hasUnresolvedFact: hostText.includes('{fact:') || hostHtml.includes('{fact:'),
        };
      }, ch.id);

      expect(domAudit.state.chapterId).toBe(ch.id);
      expect(domAudit.headlineText.length).toBeGreaterThan(0);
      expect(domAudit.bodyText.length).toBeGreaterThan(0);
      expect(domAudit.hasUnresolvedFact).toBe(false);
      expect(domAudit.receiptTriggerCount).toBeGreaterThan(0);

      // Feedback 3: Verify every narrative chapter (pour through personality) renders Takeaway for Sam
      if (ch.id !== 'one_line' && ch.id !== 'share_card') {
        expect(
          domAudit.hostUpperText,
          `Chapter ${ch.id} should render TAKEAWAY FOR SAM on stage`
        ).toContain('TAKEAWAY FOR SAM');
      }

      // Feedback 4: Verify Shatter chapter holds category columns & #shatter-takeaway in interactive mode
      if (ch.id === 'shatter') {
        const shatterHoldAudit = await page.evaluate(() => {
          const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
          // Advance even further to t = 6.0s in interactive mode (not body.film)
          app.player.timeline.seek(6.0);
          for (let i = 0; i < 20; i++) {
            app.player.grid.stepAndDraw(0.05);
          }
          const takeawayEl = document.querySelector<HTMLElement>(
            '[data-testid="shatter-takeaway"]'
          );
          const visibleParticles = app.player.grid.particles.filter((p) => p.v > 0).length;
          return {
            isFilmMode: document.body.classList.contains('film'),
            takeawayVisible: Boolean(
              takeawayEl && Number(getComputedStyle(takeawayEl).opacity) > 0.5
            ),
            takeawayText: takeawayEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            visibleParticles,
          };
        });
        expect(shatterHoldAudit.isFilmMode).toBe(false);
        expect(shatterHoldAudit.takeawayVisible).toBe(true);
        expect(shatterHoldAudit.takeawayText).toContain('#1 CATEGORY:');
        expect(shatterHoldAudit.visibleParticles).toBeGreaterThan(500);
      }

      if (ch.type === 'bespoke') {
        expect(domAudit.badgeText).not.toBeNull();
        expect(domAudit.badgeText?.toUpperCase()).toContain('ONLY IN YOUR APP');
        expect(domAudit.svgCount).toBeGreaterThanOrEqual(1);
      }

      chapterAudits.push({
        index: idx,
        id: ch.id,
        type: ch.type,
        paletteId: ch.palette_id,
        headline: domAudit.headlineText,
        body: domAudit.bodyText,
        hasUnresolvedFact: domAudit.hasUnresolvedFact,
        blockCount: domAudit.blockCount,
        receiptTriggerCount: domAudit.receiptTriggerCount,
        svgCount: domAudit.svgCount,
        badgeText: domAudit.badgeText,
        screenshot1920: filename,
      });
    }

    // 4. Verify & screenshot Explore Mode (default, day flip, drag range)
    await page.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      app.openExplore('coffee');
      for (let i = 0; i < 30; i++) {
        app.player.grid.stepAndDraw(0.04);
      }
    });
    await page.waitForTimeout(100);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'explore_1920x1080.png'),
      fullPage: false,
    });

    const exploreState = await page.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      const readout = document.querySelector('#exday')?.textContent?.trim() ?? '';
      const pressedChip = document
        .querySelector('#chips .chip[aria-pressed="true"]')
        ?.getAttribute('data-cat');
      return {
        mode: app.getState().mode,
        readout,
        pressedChip,
      };
    });
    expect(exploreState.mode).toBe('explore');
    expect(exploreState.pressedChip).toBe('coffee');
    expect(exploreState.readout).toContain('Coffee');

    // Explore Day Flip (click day index 222 = 11 Aug 2025, biggest day)
    await page.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      app.selectCategoryLens('');
      for (let i = 0; i < 20; i++) {
        app.player.grid.stepAndDraw(0.04);
      }
      app.clickDay(222);
    });
    await page.waitForTimeout(750);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'explore_day_flip.png'),
      fullPage: false,
    });

    const flipCardCheck = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('[data-testid="day-flip-card"]');
      return {
        isOpen: Boolean(card && Number(getComputedStyle(card).opacity) > 0.5),
        text: card?.textContent?.trim() ?? '',
      };
    });
    expect(flipCardCheck.isOpen).toBe(true);
    expect(flipCardCheck.text).toContain('Monarch Acoustic');

    // Explore Drag Range (days 120..150 = May 2025)
    await page.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      app.player.exploreOverlay.flipCard.close(true);
      app.dragDays(120, 150);
      for (let i = 0; i < 25; i++) {
        app.player.grid.stepAndDraw(0.04);
      }
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'explore_drag_range.png'),
      fullPage: false,
    });

    const dragRangeCheck = await page.evaluate(() => {
      const selBlock = document.querySelector<HTMLElement>(
        '[data-testid="explore-selection-block"]'
      );
      const selTitle = document.querySelector('#exsel-title')?.textContent?.trim() ?? '';
      const selVal = document.querySelector('#exselv')?.textContent?.trim() ?? '';
      return {
        visible: Boolean(selBlock && Number(getComputedStyle(selBlock).opacity) > 0.5),
        selTitle,
        selVal,
      };
    });
    expect(dragRangeCheck.visible).toBe(true);
    expect(dragRangeCheck.selTitle).toContain('31 DAYS');
    expect(dragRangeCheck.selVal.length).toBeGreaterThan(0);

    // 5. Verify & screenshot Receipts Drawer
    await page.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      app.goToChapter('bespoke_0');
      app.player.timeline.pause();
      const ch = app.player.data.plan.chapters.find((c) => c.id === 'bespoke_0')!;
      app.openReceipts('Room to Make Noise · Monarch Acoustic & Studio Gear', ch.txn_ids);
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'receipts_drawer_1920x1080.png'),
      fullPage: false,
    });

    const receiptsCheck = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>('[data-testid="receipts-drawer"]');
      const items = document.querySelectorAll('#receipts-list .receipt-item');
      const text = drawer?.textContent ?? '';
      return {
        itemCount: items.length,
        hasMonarchAcoustic: text.includes('Monarch Acoustic'),
        hasUnresolvedFact: text.includes('{fact:'),
        hasRawCardNum: /\b7731\b/.test(text),
      };
    });
    expect(receiptsCheck.itemCount).toBe(15);
    expect(receiptsCheck.hasMonarchAcoustic).toBe(true);
    expect(receiptsCheck.hasUnresolvedFact).toBe(false);
    expect(receiptsCheck.hasRawCardNum).toBe(false);

    // Close receipts drawer before Ask mode
    await page.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      app.player.receiptsDrawer.close();
    });
    await page.waitForTimeout(200);

    // 6. Verify & screenshot Ask Your Year (answerable + unanswerable)
    await page.evaluate(async () => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      app.openAsk();
      await app.player.submitAskQuestion('How much did I spend on coffee in December?');
      for (let i = 0; i < 30; i++) {
        app.player.grid.stepAndDraw(0.04);
      }
    });
    await page.waitForTimeout(1050);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'ask_answer_1920x1080.png'),
      fullPage: false,
    });

    const askAnswerCheck = await page.evaluate(() => {
      const odoEl = document.querySelector<HTMLElement>('#askodo');
      let odoVal = '';
      if (odoEl) {
        for (const child of Array.from(odoEl.children) as HTMLElement[]) {
          if (child.classList.contains('sp')) {
            odoVal += child.textContent ?? '';
          } else if (child.classList.contains('dg')) {
            const st = child.querySelector<HTMLElement>('.st');
            const tf = st?.style.transform ?? '';
            const m = tf.match(/translate3d\(\s*0(?:px)?\s*,\s*(-?[\d.]+)/);
            if (m) {
              odoVal += String(Math.round(Math.abs(parseFloat(m[1]))) % 10);
            }
          }
        }
      }
      const intText = document.querySelector('#askintt')?.textContent?.trim() ?? '';
      const rcRows = document.querySelectorAll('#askrct .rc').length;
      return { odoVal, intText, rcRows };
    });
    expect(askAnswerCheck.odoVal).toBe('389.46');
    expect(askAnswerCheck.intText.toLowerCase()).toContain('coffee');
    expect(askAnswerCheck.rcRows).toBeGreaterThan(0);

    // Unanswerable question ("Spending by time of day")
    await page.evaluate(async () => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      const inputEl = document.querySelector<HTMLInputElement>('#askin');
      if (inputEl) inputEl.value = 'Spending by time of day';
      await app.player.submitAskQuestion('Spending by time of day');
      for (let i = 0; i < 20; i++) {
        app.player.grid.stepAndDraw(0.04);
      }
    });
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'ask_unanswerable_1920x1080.png'),
      fullPage: false,
    });

    const askUnanswerableCheck = await page.evaluate(() => {
      const numText = document.querySelector('#asknum')?.textContent?.trim() ?? '';
      const intText = document.querySelector('#askintt')?.textContent?.trim() ?? '';
      const altText = document.querySelector('#ask-alt-btn')?.textContent?.trim() ?? '';
      return { numText, intText, altText };
    });
    expect(askUnanswerableCheck.numText).toContain('Can’t tell');
    expect(askUnanswerableCheck.intText.toLowerCase()).toContain('time');
    expect(askUnanswerableCheck.altText.length).toBeGreaterThan(0);

    // 7. Export Share Card PNGs (1080x1350 and 1080x1920) & verify PNG magic bytes
    await seekChapterToSettledBeat(page, 'share_card', 2.2);
    const exportedDataUrls = await page.evaluate(async () => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      const png1350 = await app.exportShareCardPng('1080x1350');
      const png1920 = await app.exportShareCardPng('1080x1920');
      return { png1350, png1920 };
    });

    for (const [size, dataUrl] of [
      ['1080x1350', exportedDataUrls.png1350],
      ['1080x1920', exportedDataUrls.png1920],
    ] as const) {
      expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buf = Buffer.from(base64Data, 'base64');
      // Verify PNG magic signature: 89 50 4E 47 0D 0A 1A 0A
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);
      // Verify IHDR width and height (big-endian uint32 at offset 16 and 20)
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width).toBe(1080);
      expect(height).toBe(size === '1080x1350' ? 1350 : 1920);

      const outPath = path.join(SCREENSHOTS_DIR, `share_card_${size}.png`);
      fs.writeFileSync(outPath, buf);
      expect(buf.length).toBeGreaterThan(15000);
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    await context.close();
  }, 120000);

  it('renders Desktop Laptop (1440×900) and Mobile Phone (390×844) viewports plus Reduced-Motion Mode cleanly', async () => {
    // 1. Desktop Laptop (1440 × 900)
    const laptopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const laptopPage = await laptopCtx.newPage();
    laptopPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    laptopPage.on('pageerror', (err) => pageErrors.push(err.message));

    await laptopPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await laptopPage.waitForSelector('#app[data-ready="true"]');

    await laptopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'start_1440x900.png'),
      fullPage: false,
    });

    for (const chId of KEY_RESPONSIVE_CHAPTER_IDS) {
      const chIndex = plan.chapters.findIndex((c) => c.id === chId);
      const settledSec = CHAPTER_SETTLED_SECONDS[chId] ?? 2.2;
      await seekChapterToSettledBeat(laptopPage, chId, settledSec);
      await laptopPage.screenshot({
        path: path.join(
          SCREENSHOTS_DIR,
          `ch_${String(chIndex).padStart(2, '0')}_${chId}_1440x900.png`
        ),
        fullPage: false,
      });
    }
    await laptopCtx.close();

    // 2. Mobile Phone (390 × 844)
    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const phonePage = await phoneCtx.newPage();
    phonePage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    phonePage.on('pageerror', (err) => pageErrors.push(err.message));

    await phonePage.goto(baseUrl, { waitUntil: 'networkidle' });
    await phonePage.waitForSelector('#app[data-ready="true"]');

    await phonePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'start_390x844.png'),
      fullPage: false,
    });

    const phoneViewportCheck = await phonePage.evaluate(() => {
      const stage = document.getElementById('stage');
      return {
        hasPhoneClass: Boolean(stage?.classList.contains('phone-layout')),
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(phoneViewportCheck.hasPhoneClass).toBe(true);
    expect(phoneViewportCheck.clientWidth).toBe(390);

    for (const chId of KEY_RESPONSIVE_CHAPTER_IDS) {
      const chIndex = plan.chapters.findIndex((c) => c.id === chId);
      const settledSec = CHAPTER_SETTLED_SECONDS[chId] ?? 2.2;
      await seekChapterToSettledBeat(phonePage, chId, settledSec);
      await phonePage.screenshot({
        path: path.join(
          SCREENSHOTS_DIR,
          `ch_${String(chIndex).padStart(2, '0')}_${chId}_390x844.png`
        ),
        fullPage: false,
      });
    }

    // Verify bespoke phone stages mount with data-viewport="phone"
    await seekChapterToSettledBeat(phonePage, 'bespoke_0', 2.2);
    const studioPhoneViewport = await phonePage.evaluate(() =>
      document.querySelector('[data-testid="studio-chapter-stage"]')?.getAttribute('data-viewport')
    );
    expect(studioPhoneViewport).toBe('phone');

    await seekChapterToSettledBeat(phonePage, 'bespoke_1', 2.2);
    const coffeePhoneViewport = await phonePage.evaluate(() =>
      document.querySelector('[data-testid="coffee-chapter-stage"]')?.getAttribute('data-viewport')
    );
    expect(coffeePhoneViewport).toBe('phone');

    await phoneCtx.close();

    // 3. Reduced-Motion Mode (1920 × 1080)
    const rmCtx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: 'reduce',
    });
    const rmPage = await rmCtx.newPage();
    rmPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    rmPage.on('pageerror', (err) => pageErrors.push(err.message));

    await rmPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await rmPage.waitForSelector('#app[data-ready="true"]');

    const rmState = await rmPage.evaluate(() => {
      const app = (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__;
      app.setReducedMotion(true);
      app.goToChapter('shatter');
      app.player.timeline.seek(1.5);
      app.player.grid.stepAndDraw(0.05);
      return app.getState();
    });
    expect(rmState.reducedMotion).toBe(true);

    await rmPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'reduced_motion_1920x1080.png'),
      fullPage: false,
    });

    await rmCtx.close();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 90000);

  it('verifies B2B 2025–26 multi-year 13-chapter bounding-box geometry, zero header clashing, zero box overflow, ShareExporter PNG, and Upload Data reset in real Chromium (1920×1080)', async () => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app[data-ready="true"]');

    // Build multi-year 2025–26 B2B dataset with long merchant names and large amounts (including 225,162,500 minor units)
    const rows: string[] = ['Invoice Date,Vendor,Department,Description,Amount,Currency'];
    const months = [
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ];
    months.forEach((ym, idx) => {
      rows.push(
        `${ym}-02,Stripe UK Enterprise Settlement Clearing,Revenue & Sales,Monthly Commercial Settlement Cycle ${idx + 1},480000.00,GBP`
      );
      rows.push(
        `${ym}-08,Northbank Coffee Roasters — Southbank Flagship,Inventory & Green Bean Supply,Direct Trade Espresso Roast Lot #${101 + idx},-42500.00,GBP`
      );
      rows.push(
        `${ym}-14,Global Cloud Infrastructure Services Ltd — EMEA Cluster,Cloud & POS Systems,Multi-Region Telemetry & Point-of-Sale Hosting,-18900.00,GBP`
      );
      rows.push(
        `${ym}-19,Metropolitan Commercial Property Management LLP,Premises & Leasehold,Flagship Roastery & Café Quarter Lease,-64000.00,GBP`
      );
      rows.push(
        `${ym}-24,Highland Dairy & Oat Barista Distributors UK,Perishables & Cold Chain,Weekly Chilled Barista Supply Delivery,-14200.00,GBP`
      );
    });
    for (let d = 10; d <= 16; d++) {
      rows.push(
        `2026-05-${String(d).padStart(2, '0')},Northbank Coffee Roasters — Southbank Flagship,Flagship Roastery Expansion,La Marzocco KB90 & Probat Roaster Commissioning Day ${d - 9},-28500.00,GBP`
      );
    }
    rows.push(
      '2026-05-18,Probat Werke Industrial Roastery Engineering GmbH,Flagship Roastery Expansion,Turnkey Industrial Roastery & Flagship Buildout Tranche,-2251625.00,GBP'
    );

    const b2bBundle = ingestFilesDeterministically(
      [
        {
          name: 'northbank_flagship_2025-26.csv',
          content: rows.join('\n') + '\n',
          mimeType: 'text/csv',
        },
      ],
      {
        entityName: 'Northbank Coffee Roasters — Southbank Flagship',
        isB2B: true,
        selectedChapters: [
          'pour',
          'year_as_squares',
          'your_place',
          'bespoke_studio',
          'streak',
          'getaway',
          'bespoke_coffee',
          'heartbeat',
          'big_one',
          'shatter',
          'personality',
          'one_line',
          'share_card',
        ],
      }
    );

    expect(b2bBundle.plan.chapters.length).toBe(13);

    // Load the 13-chapter B2B dataset into window.__STORY_PLAYER__
    await page.evaluate((bundle) => {
      const player =
        window.__STORY_PLAYER__ ??
        (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__.player;
      player.loadDataset(bundle, true);
    }, b2bBundle);

    // Step through all 13 B2B chapters (0..12) and verify real browser bounding-box geometry
    for (let idx = 0; idx < b2bBundle.plan.chapters.length; idx++) {
      const ch = b2bBundle.plan.chapters[idx]!;
      const settledSec =
        ch.type === 'pour'
          ? 10.2
          : ch.type === 'year_as_squares'
            ? 8.6
            : ch.type === 'your_place'
              ? 2.8
              : ch.type === 'shatter' || ch.type === 'personality'
                ? 3.0
                : 2.2;

      await seekChapterToSettledBeat(page, ch.id, settledSec);

      const geomAudit = await page.evaluate(
        ({ chapterIdx, chapterId, chapterType }) => {
          const host = document.getElementById('chapter-host')!;
          const chlEl = document.getElementById('chl')!;
          const headerStack = host.querySelector<HTMLElement>('.ch-header-stack');
          const headlineEl = host.querySelector<HTMLElement>('[data-testid="chapter-headline"]');
          const bodyEl = host.querySelector<HTMLElement>('[data-testid="chapter-body"]');

          const headlineRect = headlineEl?.getBoundingClientRect() ?? null;
          const bodyRect = bodyEl?.getBoundingClientRect() ?? null;
          const stackRect = headerStack?.getBoundingClientRect() ?? null;

          // Check if .ch-header-stack overlaps any visible .blk card below/beside it (excluding .blk containers that wrap .ch-header-stack)
          const overlappingBlocks: string[] = [];
          if (headerStack && stackRect && stackRect.width > 0 && stackRect.height > 0) {
            const blks = Array.from(host.querySelectorAll<HTMLElement>('.blk'));
            for (const blk of blks) {
              if (blk.contains(headerStack)) continue;
              const style = getComputedStyle(blk);
              if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                Number(style.opacity) < 0.05
              ) {
                continue;
              }
              const r = blk.getBoundingClientRect();
              if (r.width <= 2 || r.height <= 2) continue;

              const separated =
                stackRect.right <= r.left + 2 ||
                stackRect.left >= r.right - 2 ||
                stackRect.bottom <= r.top + 2 ||
                stackRect.top >= r.bottom - 2;
              if (!separated) {
                overlappingBlocks.push(
                  `${blk.dataset.testid || blk.id || 'blk'}(top=${Math.round(r.top)},left=${Math.round(r.left)},stackBottom=${Math.round(stackRect.bottom)},stackRight=${Math.round(stackRect.right)})`
                );
              }
            }
          }

          // Check every visible .blk .num for horizontal overflow (scrollWidth <= parentBlk.clientWidth)
          const overflowingNums: string[] = [];
          const numEls = Array.from(host.querySelectorAll<HTMLElement>('.blk .num'));
          for (const numEl of numEls) {
            const parentBlk = numEl.closest<HTMLElement>('.blk');
            if (!parentBlk) continue;
            const blkStyle = getComputedStyle(parentBlk);
            const numStyle = getComputedStyle(numEl);
            if (
              blkStyle.display === 'none' ||
              blkStyle.visibility === 'hidden' ||
              Number(blkStyle.opacity) < 0.05 ||
              numStyle.display === 'none' ||
              numStyle.visibility === 'hidden'
            ) {
              continue;
            }
            const blkRect = parentBlk.getBoundingClientRect();
            const numRect = numEl.getBoundingClientRect();
            if (blkRect.width <= 2 || blkRect.height <= 2) continue;
            if (numEl.scrollWidth > parentBlk.clientWidth || numRect.right > blkRect.right + 2) {
              overflowingNums.push(
                `${parentBlk.dataset.testid || parentBlk.id || 'blk'}: scrollWidth=${numEl.scrollWidth}, clientWidth=${parentBlk.clientWidth}, numRight=${Math.round(numRect.right)}, blkRight=${Math.round(blkRect.right)} (text="${(numEl.textContent ?? '').trim()}", fontSize=${numStyle.fontSize})`
              );
            }
          }

          const ttltText = host.querySelector('#ttlt')?.textContent?.trim() ?? null;
          const ttlBText = host.querySelector('#ttlB')?.textContent?.trim() ?? null;
          const hasGhostNumOnShatter =
            chapterType === 'shatter' ? Boolean(host.querySelector('.num.gh')) : false;
          const hostHtml = host.innerHTML;

          return {
            chapterIdx,
            chapterId,
            chapterType,
            chlText: chlEl.textContent?.trim() ?? '',
            hasHeaderStack: Boolean(headerStack),
            headlineBottom: headlineRect ? headlineRect.bottom : 0,
            bodyTop: bodyRect ? bodyRect.top : 0,
            headlineHeight: headlineRect ? headlineRect.height : 0,
            bodyHeight: bodyRect ? bodyRect.height : 0,
            overlappingBlocks,
            overflowingNums,
            ttltText,
            ttlBText,
            hasGhostNumOnShatter,
            hostHtml,
          };
        },
        { chapterIdx: idx, chapterId: ch.id, chapterType: ch.type }
      );

      // Sequential kicker check (Items 6 & 7)
      const expectedPrefix = `${String(idx + 1).padStart(2, '0')} / 13 · `;
      expect(geomAudit.chlText.startsWith(expectedPrefix)).toBe(true);

      // Forbidden consumer/typo copy check (Item 7)
      for (const forbidden of [
        'Longest Coffee Streak',
        'Coastal Getaway',
        'Favourite Coastal Getaway',
        'Ritual calendar',
        'Peak ritual',
        'MERCHANT UNSCRAMBLE',
        'Merchant gibberish',
        'EVERYDAY PURCHASES',
        'ONLY IN YOUR APP',
        'YOU ARE',
        'paydays in orange',
        'Payday vs normal',
        'SETTLEMENTSS',
        'CLOSESS',
      ]) {
        expect(geomAudit.hostHtml).not.toContain(forbidden);
        expect(geomAudit.chlText).not.toContain(forbidden);
      }

      // Multi-year 2025–26 period check on PourChapter (Item 3)
      if (ch.type === 'pour') {
        expect(geomAudit.ttltText).toBe('2025–26');
        expect(geomAudit.ttlBText).toContain('2025–26');
      }

      // Zero Header Clashing (Item 2)
      expect(geomAudit.hasHeaderStack, `Chapter ${ch.id} missing .ch-header-stack`).toBe(true);
      expect(geomAudit.headlineHeight, `Chapter ${ch.id} headline height`).toBeGreaterThan(0);
      expect(geomAudit.bodyHeight, `Chapter ${ch.id} body height`).toBeGreaterThan(0);
      expect(
        geomAudit.headlineBottom,
        `Chapter ${ch.id} headline overlaps body (headlineBottom=${geomAudit.headlineBottom}, bodyTop=${geomAudit.bodyTop})`
      ).toBeLessThanOrEqual(geomAudit.bodyTop + 4);
      expect(
        geomAudit.overlappingBlocks,
        `Chapter ${ch.id} .ch-header-stack overlaps .blk cards`
      ).toEqual([]);

      // Zero Box Overflow (Item 4)
      expect(geomAudit.overflowingNums, `Chapter ${ch.id} has .blk .num overflow`).toEqual([]);

      // Zero Ghost 505 Watermark on shatter (Item 8)
      if (ch.type === 'shatter') {
        expect(geomAudit.hasGhostNumOnShatter).toBe(false);
      }
    }

    // Verify D/d keyboard shortcut removal in real Chromium (Item 11)
    await page.keyboard.press('d');
    await page.keyboard.press('D');
    const modeAfterKeyD = await page.evaluate(() => {
      const player =
        window.__STORY_PLAYER__ ??
        (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__.player;
      return player.getState().mode;
    });
    expect(modeAfterKeyD).toBe('story');

    // Share Image Export Verification (Item 9) inside real Chromium browser
    const sharePosterResult = await page.evaluate(async () => {
      const player =
        window.__STORY_PLAYER__ ??
        (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__.player;
      const exporter = window.ShareExporter!;
      const dataUrl = await exporter.renderPosterDataUrl(
        player.data.plan,
        player.data.facts,
        player.data.days,
        '1080x1350'
      );
      return {
        startsWithPngPrefix: dataUrl.startsWith('data:image/png;base64,'),
        length: dataUrl.length,
      };
    });
    expect(sharePosterResult.startsWithPngPrefix).toBe(true);
    expect(sharePosterResult.length).toBeGreaterThan(10000);

    // Landing Screen (#start-screen) & Upload Data Reset (Items 1, 5, 10, 11)
    const uploadDataResetCheck = await page.evaluate(() => {
      const player =
        window.__STORY_PLAYER__ ??
        (window as unknown as { __YEAR_APP__: YearAppCaptureBridge }).__YEAR_APP__.player;
      player.openDataIngestion();

      const startScreen = document.getElementById('start-screen')!;
      const heroTitle = document.getElementById('start-hero-title')?.textContent?.trim() ?? '';
      const topLeft = document.getElementById('start-top-left-label')?.textContent?.trim() ?? '';
      const topRight = document.getElementById('start-top-right-label')?.textContent?.trim() ?? '';
      const entityInput = document.getElementById('byo-entity-input');
      const deepAgentToggle = document.getElementById(
        'byo-deep-agent-toggle'
      ) as HTMLInputElement | null;
      const toggleRect = deepAgentToggle?.getBoundingClientRect();
      const startHtml = startScreen.innerHTML;
      const navDataBtnText = document.getElementById('nav-data-btn')?.textContent?.trim() ?? '';
      const hudDataBtnText = document.getElementById('hud-data-btn')?.textContent?.trim() ?? '';

      return {
        heroTitle,
        topLeft,
        topRight,
        hasEntityInput: entityInput !== null,
        deepAgentVisible: Boolean(
          deepAgentToggle && toggleRect && toggleRect.width > 0 && toggleRect.height > 0
        ),
        deepAgentChecked: Boolean(deepAgentToggle?.checked),
        hasDemoTerms: startHtml.includes('DEMO TERMS'),
        hasDeterministicEngine: startHtml.includes('DETERMINISTIC ENGINE'),
        navDataBtnText,
        hudDataBtnText,
      };
    });

    expect(uploadDataResetCheck.heroTitle).toBe('Finance Story.');
    expect(uploadDataResetCheck.topLeft).toBe('FINANCE STORY · INTERACTIVE SUMMARY');
    expect(uploadDataResetCheck.topRight).toBe('LEDGER ANALYSIS');
    expect(uploadDataResetCheck.hasEntityInput).toBe(false);
    expect(uploadDataResetCheck.deepAgentVisible).toBe(true);
    expect(uploadDataResetCheck.deepAgentChecked).toBe(false);
    expect(uploadDataResetCheck.hasDemoTerms).toBe(false);
    expect(uploadDataResetCheck.hasDeterministicEngine).toBe(false);
    expect(uploadDataResetCheck.navDataBtnText).toBe('Upload Data');
    expect(uploadDataResetCheck.hudDataBtnText).toBe('Upload Data');

    await context.close();
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 120000);
});
