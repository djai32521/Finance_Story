import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Day, Fact, MotionEvent, StoryPlan, Transaction } from '../contracts/index.js';
import { formatMoneyMinor } from '../contracts/index.js';
import daysJson from '../data/days.json';
import factsJson from '../data/facts.json';
import transactionsJson from '../data/transactions.json';
import { answerQuestionDeterministically } from '../src/ask/index.js';
import { filterTransactionsByIds, summarizeReceipts } from '../src/explore/receipts-drawer.js';
import { aggregateDayRange } from '../src/grid/drag-selector.js';
import storyPlanJson from '../story/plan.json';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const realTransactions = transactionsJson as unknown as readonly Transaction[];
const realDays = daysJson as unknown as readonly Day[];
const realFacts = factsJson as unknown as readonly Fact[];
const realPlan = storyPlanJson as unknown as StoryPlan;

interface BrowserPerfMetrics {
  startClickLatencyMs: number;
  chapterNavLatenciesMs: number[];
  rapidBurstTotalMs: number;
  rapidBurstPerStepMs: number;
  exploreOpenLatencyMs: number;
  flipCardOpenLatencyMs: number;
  dragSelectLatencyMs: number;
  lensSwitchLatencyMs: number;
  askQueryLatencyMs: number;
  filmStepLatenciesMs: number[];
  filmP50Ms: number;
  filmP95Ms: number;
  filmMaxMs: number;
}

function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[idx] ?? 0;
}

describe('Phase 4 Independent Interaction, Motion & Ask Verification (Playwright Headless Chromium)', () => {
  let viteServer: ViteDevServer;
  let baseUrl = '';
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];

  const perfMetrics: BrowserPerfMetrics = {
    startClickLatencyMs: 0,
    chapterNavLatenciesMs: [],
    rapidBurstTotalMs: 0,
    rapidBurstPerStepMs: 0,
    exploreOpenLatencyMs: 0,
    flipCardOpenLatencyMs: 0,
    dragSelectLatencyMs: 0,
    lensSwitchLatencyMs: 0,
    askQueryLatencyMs: 0,
    filmStepLatenciesMs: [],
    filmP50Ms: 0,
    filmP95Ms: 0,
    filmMaxMs: 0,
  };

  beforeAll(async () => {
    viteServer = await createServer({
      root: APP_ROOT,
      logLevel: 'silent',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
      },
    });
    await viteServer.listen();
    const addr = viteServer.httpServer?.address();
    const port = typeof addr === 'object' && addr ? addr.port : 4173;
    baseUrl = `http://127.0.0.1:${port}`;

    browser = await chromium.launch({
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();

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
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app[data-ready="true"]', { timeout: 10000 });
  }, 30000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (viteServer) {
      await viteServer.close();
    }
  });

  it('1. Start Screen Gate (BRIEF.md §3.0): blocks playback on initial load, hides #bar by default, renders #start-bg-grid and #stage-hud-nav, unlocks audio cue, logs start_open, and transitions to Chapter 0 (pour)', async () => {
    const initialCheck = await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;
      const startEl = document.getElementById('start-screen')!;
      const btnEl = document.getElementById('start-open-btn')!;
      const barEl = document.getElementById('bar');
      const startBgGrid = document.getElementById('start-bg-grid');
      const hudNav = document.getElementById('stage-hud-nav');
      const style = window.getComputedStyle(startEl);
      return {
        state: bridge.getState(),
        audioUnlocked: bridge.player.audioCue.isUnlocked(),
        eventsCount: bridge.getMotionEvents().length,
        startScreenVisible:
          style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.9,
        barDisplay: barEl ? window.getComputedStyle(barEl).display : 'missing',
        hasStartBgGrid: Boolean(startBgGrid),
        hasStageHudNav: Boolean(hudNav),
        buttonText: btnEl.textContent?.trim() ?? '',
        appDataset: {
          ready: document.getElementById('app')?.dataset.ready,
          transactions: document.getElementById('app')?.dataset.transactions,
          chapters: document.getElementById('app')?.dataset.chapters,
          person: document.getElementById('app')?.dataset.person,
        },
      };
    });

    expect(initialCheck.appDataset).toEqual({
      ready: 'true',
      transactions: '1000',
      chapters: String(realPlan.chapters.length),
      person: 'Sam',
    });
    expect(initialCheck.startScreenVisible).toBe(true);
    expect(initialCheck.barDisplay).toBe('none');
    expect(initialCheck.hasStartBgGrid).toBe(true);
    expect(initialCheck.hasStageHudNav).toBe(true);
    expect(initialCheck.buttonText).toContain('Open your 2025');
    expect(initialCheck.state.started).toBe(false);
    expect(initialCheck.state.mode).toBe('start');
    expect(initialCheck.state.chapterIndex).toBe(-1);
    expect(initialCheck.audioUnlocked).toBe(false);
    expect(initialCheck.eventsCount).toBe(0);

    // Click "Open your 2025" and measure synchronous input-to-state-transition latency
    const afterStart = await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;
      const btnEl = document.getElementById('start-open-btn')!;
      const t0 = performance.now();
      btnEl.click();
      const latencyMs = performance.now() - t0;
      const events = bridge.getMotionEvents();
      const cueLog = bridge.player.audioCue.getCueLog();
      return {
        latencyMs,
        state: bridge.getState(),
        audioUnlocked: bridge.player.audioCue.isUnlocked(),
        cueLog,
        eventTypes: events.map((e) => e.type),
        pourWallExists: Boolean(document.querySelector('[data-testid="pour-wall"]')),
        pourHeadline:
          document.querySelector('[data-testid="chapter-headline"]')?.textContent?.trim() ?? '',
      };
    });

    perfMetrics.startClickLatencyMs = afterStart.latencyMs;
    expect(afterStart.latencyMs).toBeLessThan(250); // Initial PourChapter cold mount (880 wall rows + 1920x1080 canvas glyph sampling)
    expect(afterStart.state.started).toBe(true);
    expect(afterStart.state.mode).toBe('story');
    expect(afterStart.state.chapterIndex).toBe(0);
    expect(afterStart.state.chapterId).toBe('pour');
    expect(afterStart.audioUnlocked).toBe(true);
    expect(afterStart.cueLog.some((c) => c.cue === 'start_open')).toBe(true);
    expect(afterStart.eventTypes).toContain('start_open');
    expect(afterStart.eventTypes).toContain('chapter.go');
    expect(afterStart.pourWallExists).toBe(true);
    expect(afterStart.pourHeadline).toContain('2025');
  });

  it('2. Interruptible Chapter Navigation (BRIEF.md §3.1): nextChapter, prevChapter, ArrowRight/ArrowLeft, Space pause, and rapid mid-flight inputs never throw or hang', async () => {
    const navResult = await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;
      const latencies: number[] = [];

      // Advance while pour animation is mid-flight
      bridge.player.timeline.seek(1.8);
      let t0 = performance.now();
      bridge.player.nextChapter();
      latencies.push(performance.now() - t0);
      const afterNext = bridge.getState();

      // Seek mid-sweep and trigger prevChapter()
      bridge.player.timeline.seek(2.4);
      t0 = performance.now();
      bridge.player.prevChapter();
      latencies.push(performance.now() - t0);
      const afterPrev = bridge.getState();

      // Keyboard ArrowRight mid-animation
      bridge.player.timeline.seek(0.9);
      t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      latencies.push(performance.now() - t0);
      const afterArrowRight = bridge.getState();

      // Keyboard ArrowLeft mid-animation
      t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      latencies.push(performance.now() - t0);
      const afterArrowLeft = bridge.getState();

      // Spacebar pause & resume
      const pausedBefore = bridge.getState().paused;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      const pausedAfterFirstSpace = bridge.getState().paused;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      const pausedAfterSecondSpace = bridge.getState().paused;

      // Rapid mid-flight burst across all 13 chapters forward and backward
      const totalChapters = bridge.player.data.plan.chapters.length;
      const burstStart = performance.now();
      for (let i = 0; i < totalChapters - 1; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      }
      const atLastChapter = bridge.getState();
      for (let i = 0; i < totalChapters - 1; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      }
      const burstTotalMs = performance.now() - burstStart;
      const atFirstChapter = bridge.getState();

      // Test Reduced Motion toggle
      bridge.setReducedMotion(true);
      const rmEnabledState = bridge.getState();
      bridge.setReducedMotion(false);
      const rmDisabledState = bridge.getState();

      return {
        latencies,
        afterNext,
        afterPrev,
        afterArrowRight,
        afterArrowLeft,
        pausedBefore,
        pausedAfterFirstSpace,
        pausedAfterSecondSpace,
        totalChapters,
        atLastChapter,
        atFirstChapter,
        burstTotalMs,
        burstPerStepMs: burstTotalMs / ((totalChapters - 1) * 2),
        rmEnabledState,
        rmDisabledState,
      };
    });

    perfMetrics.chapterNavLatenciesMs = navResult.latencies;
    perfMetrics.rapidBurstTotalMs = navResult.burstTotalMs;
    perfMetrics.rapidBurstPerStepMs = navResult.burstPerStepMs;

    expect(navResult.afterNext.chapterIndex).toBe(1);
    expect(navResult.afterNext.chapterId).toBe('year_as_squares');
    expect(navResult.afterPrev.chapterIndex).toBe(0);
    expect(navResult.afterPrev.chapterId).toBe('pour');
    expect(navResult.afterArrowRight.chapterIndex).toBe(1);
    expect(navResult.afterArrowLeft.chapterIndex).toBe(0);

    expect(navResult.pausedBefore).toBe(false);
    expect(navResult.pausedAfterFirstSpace).toBe(true);
    expect(navResult.pausedAfterSecondSpace).toBe(false);

    expect(navResult.atLastChapter.chapterIndex).toBe(navResult.totalChapters - 1);
    expect(navResult.atLastChapter.chapterId).toBe('share_card');
    expect(navResult.atFirstChapter.chapterIndex).toBe(0);
    expect(navResult.atFirstChapter.chapterId).toBe('pour');

    // Non-pour chapter navigation completes rapidly; average across 24 rapid transitions < 35ms
    expect(navResult.latencies[0]).toBeLessThan(60);
    expect(navResult.latencies[2]).toBeLessThan(35);
    expect(navResult.burstPerStepMs).toBeLessThan(35);

    expect(navResult.rmEnabledState.reducedMotion).toBe(true);
    expect(navResult.rmDisabledState.reducedMotion).toBe(false);
  });

  it('3. Explore Mode & 53×7 Grid Interactions (BRIEF.md §3.2): E key, hover magnification, clickDay(222) Monarch Acoustic flip card, dragDays(0, 30) January range total, category lenses, scrub speeds, and Receipts Drawer', async () => {
    const expectedJanRange = aggregateDayRange(realDays, 0, 30);
    const day222 = realDays[222]!;
    expect(day222.date).toBe('2025-08-11');
    const day222Txns = filterTransactionsByIds(realTransactions, day222.txn_ids).filter(
      (t) => !t.is_transfer && t.direction === 'out'
    );
    const day222TotalFormatted = formatMoneyMinor(
      day222Txns.reduce((acc, t) => acc + t.amount_minor, 0),
      { showCents: true, prefix: '$' }
    );

    const exploreResult = await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;

      // 3a. Open Explore mode via 'E' keyboard shortcut
      const tOpen0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
      const exploreOpenLatencyMs = performance.now() - tOpen0;
      const stateAfterOpen = bridge.getState();

      // Advance grid geometry transition (15 x 0.05s = 0.75s) so squares settle at GRID_PRESETS.explore coordinates
      for (let f = 0; f < 15; f++) {
        bridge.player.grid.stepAndDraw(0.05);
      }

      // 3b. Pointer hover over day 222 on the 53x7 grid: verify neighbour magnification & tooltip
      const dv222 = bridge.player.grid.days[222]!;
      const [hx, hy] = bridge.player.grid.getDayCoords(
        222,
        dv222.day,
        bridge.player.grid.currentGeometry
      );
      bridge.player.exploreOverlay.handlePointerMove(hx, hy);
      const hoveredMagnification = dv222.hovT;
      const hoverReadout =
        document.querySelector('[data-testid="explore-day-readout"]')?.textContent?.trim() ?? '';
      const tipHtml = document.getElementById('tip')?.innerHTML ?? '';

      // 3c. Click day 222 (2025-08-11, Monarch Acoustic loudest day) to open 3D flip card
      const tFlip0 = performance.now();
      bridge.clickDay(222);
      const flipCardOpenLatencyMs = performance.now() - tFlip0;
      const flipOpen = bridge.player.exploreOverlay.flipCard.isOpen();
      const flipActiveIdx = bridge.player.exploreOverlay.flipCard.getActiveDayIndex();
      const flipText = document.querySelector('[data-testid="day-flip-card"]')?.textContent ?? '';

      // Close flip card via Escape
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const flipClosedAfterEsc = !bridge.player.exploreOverlay.flipCard.isOpen();

      // 3d. Drag across days 0..30 (January) — test both pointer drag (live pill) and dragDays(0, 30)
      const tDrag0 = performance.now();
      const dv0 = bridge.player.grid.days[0]!;
      const dv30 = bridge.player.grid.days[30]!;
      const [x0, y0] = bridge.player.grid.getDayCoords(
        0,
        dv0.day,
        bridge.player.grid.currentGeometry
      );
      const [x30, y30] = bridge.player.grid.getDayCoords(
        30,
        dv30.day,
        bridge.player.grid.currentGeometry
      );
      bridge.player.exploreOverlay.handlePointerDown(x0, y0);
      bridge.player.exploreOverlay.handlePointerMove(x30, y30);
      const pillLabelDuringDrag = document.getElementById('pilll')?.textContent?.trim() ?? '';
      bridge.player.exploreOverlay.handlePointerUp();

      // Also invoke bridge.dragDays(0, 30) directly as specified
      bridge.dragDays(0, 30);
      const dragSelectLatencyMs = performance.now() - tDrag0;
      const selTitle = document.getElementById('exsel-title')?.textContent?.trim() ?? '';
      const selVal = document.getElementById('exselv')?.textContent?.trim() ?? '';
      const selLab = document.getElementById('exsell')?.textContent?.trim() ?? '';

      // 3e. Category lenses: 'coffee', 'groceries', '' (all)
      const tLens0 = performance.now();
      bridge.selectCategoryLens('coffee');
      const lensSwitchLatencyMs = performance.now() - tLens0;
      const coffeeReadout =
        document.querySelector('[data-testid="explore-day-readout"]')?.textContent?.trim() ?? '';
      const coffeeDetail =
        document.querySelector('[data-testid="explore-detail-readout"]')?.textContent?.trim() ?? '';
      const coffeeChipPressed =
        document.querySelector('[data-testid="lens-chip-coffee"]')?.getAttribute('aria-pressed') ??
        '';

      bridge.selectCategoryLens('groceries');
      const groceriesReadout =
        document.querySelector('[data-testid="explore-day-readout"]')?.textContent?.trim() ?? '';
      const groceriesDetail =
        document.querySelector('[data-testid="explore-detail-readout"]')?.textContent?.trim() ?? '';
      const groceriesChipPressed =
        document
          .querySelector('[data-testid="lens-chip-groceries"]')
          ?.getAttribute('aria-pressed') ?? '';

      bridge.selectCategoryLens('');
      const allReadout =
        document.querySelector('[data-testid="explore-day-readout"]')?.textContent?.trim() ?? '';
      const allChipPressed =
        document.querySelector('[data-testid="lens-chip-all"]')?.getAttribute('aria-pressed') ?? '';

      // 3f. Scrub speeds (0.5x, 1x, 2x)
      const speedBtns = Array.from(
        document.querySelectorAll<HTMLButtonElement>('#speed-btns [data-speed]')
      );
      speedBtns.forEach((b) => b.click());
      const finalScrubSpeed = bridge.player.exploreOverlay.scrubBar.speed;
      bridge.player.exploreOverlay.scrubBar.pauseReplay();
      bridge.player.exploreOverlay.scrubBar.setPosition(364);

      // 3g. Open Receipts Drawer for day 222 transactions
      bridge.openReceipts('Loudest Day — Mon 11 Aug', dv222.day.txn_ids);
      const drawerOpen = bridge.player.receiptsDrawer.isOpen();
      const drawerText =
        document.querySelector('[data-testid="receipts-drawer"]')?.textContent ?? '';
      const receiptRowIds = Array.from(
        document.querySelectorAll<HTMLElement>('#receipts-list .receipt-item')
      ).map((el) => el.dataset.txnId ?? '');

      // Filter inside Receipts Drawer
      const searchInput = document.querySelector<HTMLInputElement>('#receipts-search')!;
      searchInput.value = 'Monarch Acoustic';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      const filteredRowCount = document.querySelectorAll('#receipts-list .receipt-item').length;

      // Close Receipts Drawer via Escape
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const drawerClosedAfterEsc = !bridge.player.receiptsDrawer.isOpen();

      return {
        exploreOpenLatencyMs,
        stateAfterOpen,
        hoveredMagnification,
        hoverReadout,
        tipHtml,
        flipCardOpenLatencyMs,
        flipOpen,
        flipActiveIdx,
        flipText,
        flipClosedAfterEsc,
        dragSelectLatencyMs,
        pillLabelDuringDrag,
        selTitle,
        selVal,
        selLab,
        lensSwitchLatencyMs,
        coffeeReadout,
        coffeeDetail,
        coffeeChipPressed,
        groceriesReadout,
        groceriesDetail,
        groceriesChipPressed,
        allReadout,
        allChipPressed,
        finalScrubSpeed,
        drawerOpen,
        drawerText,
        receiptRowIds,
        filteredRowCount,
        drawerClosedAfterEsc,
      };
    });

    perfMetrics.exploreOpenLatencyMs = exploreResult.exploreOpenLatencyMs;
    perfMetrics.flipCardOpenLatencyMs = exploreResult.flipCardOpenLatencyMs;
    perfMetrics.dragSelectLatencyMs = exploreResult.dragSelectLatencyMs;
    perfMetrics.lensSwitchLatencyMs = exploreResult.lensSwitchLatencyMs;

    // Verify Explore mode opened within 1 frame
    expect(exploreResult.exploreOpenLatencyMs).toBeLessThan(16.67);
    expect(exploreResult.stateAfterOpen.mode).toBe('explore');

    // Verify Hover magnification & tooltip
    expect(exploreResult.hoveredMagnification).toBeGreaterThan(1.3);
    expect(exploreResult.hoverReadout).toBe('Mon 11 Aug');
    expect(exploreResult.tipHtml).toContain('Monarch Acoustic');

    // Verify 3D Flip Card on day 222 (2025-08-11)
    expect(exploreResult.flipCardOpenLatencyMs).toBeLessThan(16.67);
    expect(exploreResult.flipOpen).toBe(true);
    expect(exploreResult.flipActiveIdx).toBe(222);
    expect(exploreResult.flipText).toContain('MON 11 AUG');
    expect(exploreResult.flipText).toContain('Monarch Acoustic');
    expect(exploreResult.flipText).toContain('Squarespace');
    expect(exploreResult.flipText).toContain('Sweetwater');
    expect(exploreResult.flipText).toContain(`US${day222TotalFormatted}`);
    expect(exploreResult.flipClosedAfterEsc).toBe(true);

    // Verify Drag range selection (days 0..30 = January, 31 days)
    expect(exploreResult.pillLabelDuringDrag).toBe(
      `31 DAYS · ${expectedJanRange.txnIds.length} ITEMS · WED 1 JAN → FRI 31 JAN`
    );
    expect(exploreResult.selTitle).toBe('SELECTION · 31 DAYS');
    expect(exploreResult.selVal).toBe(expectedJanRange.formattedDiscretionary.replace(/^\$/, ''));
    expect(exploreResult.selLab).toContain(`31 DAYS · ${expectedJanRange.txnIds.length} ITEMS`);
    expect(exploreResult.selLab).toContain('WED 1 JAN → FRI 31 JAN');

    // Verify Category Lenses ('coffee', 'groceries', '')
    const expectedCoffeeLensTotal = formatMoneyMinor(226488, { showCents: false, prefix: '$' });
    const expectedGroceriesLensTotal = formatMoneyMinor(241582, { showCents: false, prefix: '$' });
    expect(exploreResult.lensSwitchLatencyMs).toBeLessThan(16.67);
    expect(exploreResult.coffeeChipPressed).toBe('true');
    expect(exploreResult.coffeeReadout).toBe(`Coffee · US${expectedCoffeeLensTotal}`);
    expect(exploreResult.coffeeDetail).toContain('163 purchases across 2025');

    expect(exploreResult.groceriesChipPressed).toBe('true');
    expect(exploreResult.groceriesReadout).toBe(`Groceries · US${expectedGroceriesLensTotal}`);
    expect(exploreResult.groceriesDetail).toContain('64 purchases across 2025');

    expect(exploreResult.allChipPressed).toBe('true');
    expect(exploreResult.allReadout).toContain('All Categories · US$');

    // Verify Scrub speed selector
    expect(exploreResult.finalScrubSpeed).toBe(2);

    // Verify Receipts Drawer backing rows and total
    const expectedDay222Summary = summarizeReceipts(
      filterTransactionsByIds(realTransactions, day222.txn_ids)
    );
    expect(exploreResult.drawerOpen).toBe(true);
    expect(exploreResult.drawerText).toContain('Loudest Day — Mon 11 Aug');
    expect(exploreResult.drawerText).toContain(`US${expectedDay222Summary.formattedTotalOut}`);
    expect(exploreResult.receiptRowIds.sort()).toEqual([...day222.txn_ids].sort());
    expect(exploreResult.filteredRowCount).toBe(1);
    expect(exploreResult.drawerClosedAfterEsc).toBe(true);
  });

  it('4. Ask Your Year End-to-End in Browser (BRIEF.md §3.3): Blue Bottle Coffee (72 visits), December coffee ($ total + grid highlight), and unanswerable time-of-day rejection with clickable suggestion', async () => {
    const expectedBlueBottle = answerQuestionDeterministically(
      'How many times did I visit Blue Bottle Coffee?',
      realTransactions
    );
    const expectedDecCoffee = answerQuestionDeterministically(
      'How much did I spend on coffee in December?',
      realTransactions
    );
    const expectedAfter9pm = answerQuestionDeterministically(
      'How much did I spend on coffee after 9pm?',
      realTransactions
    );

    expect(expectedBlueBottle.formatted_answer).toBe('72');
    expect(expectedBlueBottle.unit_label).toBe('visits');
    expect(expectedBlueBottle.receipts.length).toBe(72);

    expect(expectedDecCoffee.answerable).toBe(true);
    expect(expectedDecCoffee.value_minor).toBeGreaterThan(0);

    expect(expectedAfter9pm.answerable).toBe(false);
    expect(expectedAfter9pm.formatted_answer).toBe('Can’t tell');

    const askBrowserResult = await page.evaluate(async () => {
      const bridge = window.__YEAR_APP__!;

      // Helper to reconstruct the displayed number from Odometer DOM slots
      const readOdometerValue = (odoRoot: HTMLElement | null): string => {
        if (!odoRoot) return '';
        let out = '';
        for (const child of Array.from(odoRoot.children) as HTMLElement[]) {
          if (child.classList.contains('sp')) {
            out += child.textContent ?? '';
          } else if (child.classList.contains('dg')) {
            const st = child.querySelector<HTMLElement>('.st');
            const tf = st?.style.transform ?? '';
            const m = tf.match(/translate3d\(0(?:px)?,\s*(-?\d+(?:\.\d+)?)em/);
            if (m) {
              const pos = Math.round(-parseFloat(m[1]!));
              const digit = ((pos % 10) + 10) % 10;
              out += String(digit);
            }
          }
        }
        return out;
      };

      // 4a. Open Ask with "How many times did I visit Blue Bottle Coffee?"
      const tAsk0 = performance.now();
      bridge.openAsk('How many times did I visit Blue Bottle Coffee?');
      await Promise.resolve();
      const askQueryLatencyMs = performance.now() - tAsk0;

      const askOdoEl = document.getElementById('askodo');
      const cpOdoText = readOdometerValue(askOdoEl);
      const cpUnitSup = document.querySelector('#asknum sup.aft')?.textContent?.trim() ?? '';
      const cpInterpretation = document.getElementById('askintt')?.textContent?.trim() ?? '';
      const cpMeta = document.getElementById('askmeta')?.textContent?.trim() ?? '';
      const cpReceiptsHeader =
        document.querySelector('#askrct .lab span')?.textContent?.trim() ?? '';

      // Click "Full Drawer ->" inside Ask receipts block to verify all 72 receipt rows in drawer
      document.getElementById('ask-open-drawer-btn')?.click();
      const cpDrawerRowCount = document.querySelectorAll('#receipts-list .receipt-item').length;
      bridge.player.receiptsDrawer.close();

      // 4b. Ask "How much did I spend on coffee in December?" via input + Enter
      const inputEl = document.getElementById('askin') as HTMLInputElement;
      const tDec0 = performance.now();
      inputEl.value = 'How much did I spend on coffee in December?';
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      const decQueryLatencyMs = performance.now() - tDec0;

      const decPrefixSup = document.querySelector('#asknum sup')?.textContent?.trim() ?? '';
      const decOdoText = readOdometerValue(document.getElementById('askodo'));
      const decInterpretation = document.getElementById('askintt')?.textContent?.trim() ?? '';
      const decMeta = document.getElementById('askmeta')?.textContent?.trim() ?? '';

      // Check that December coffee days on the 53x7 grid were highlighted (target R > 100 vs dimmed R = 27)
      const decDaysHighlighted = bridge.player.grid.days.filter(
        (dv) => dv.day.date.startsWith('2025-12-') && (dv.A?.r?.t ?? dv.r) > 100
      ).length;

      // 4c. Ask unanswerable time-of-day question: "How much did I spend on coffee after 9pm?"
      await bridge.player.submitAskQuestion('How much did I spend on coffee after 9pm?');
      const unanswerableHeadline = document.getElementById('asknum')?.textContent?.trim() ?? '';
      const unanswerableReason = document.getElementById('askintt')?.textContent?.trim() ?? '';
      const altBtn = document.getElementById('ask-alt-btn') as HTMLButtonElement | null;
      const suggestedQuestionText = altBtn?.textContent?.trim() ?? '';

      // Click the suggested question button and verify it executes and renders a valid answer
      altBtn?.click();
      await Promise.resolve();
      const afterSuggestionInputVal = inputEl.value;
      const afterSuggestionOdo = readOdometerValue(document.getElementById('askodo'));
      const afterSuggestionInterp = document.getElementById('askintt')?.textContent?.trim() ?? '';

      return {
        askQueryLatencyMs,
        decQueryLatencyMs,
        cpOdoText,
        cpUnitSup,
        cpInterpretation,
        cpMeta,
        cpReceiptsHeader,
        cpDrawerRowCount,
        decPrefixSup,
        decOdoText,
        decInterpretation,
        decMeta,
        decDaysHighlighted,
        unanswerableHeadline,
        unanswerableReason,
        suggestedQuestionText,
        afterSuggestionInputVal,
        afterSuggestionOdo,
        afterSuggestionInterp,
      };
    });

    perfMetrics.askQueryLatencyMs = askBrowserResult.decQueryLatencyMs;
    expect(askBrowserResult.decQueryLatencyMs).toBeLessThan(16.67);

    // 4a assertions: Blue Bottle Coffee = 72 visits
    expect(askBrowserResult.cpOdoText).toBe('72');
    expect(askBrowserResult.cpUnitSup).toBe('visits');
    expect(askBrowserResult.cpInterpretation).toContain('Blue Bottle Coffee');
    expect(askBrowserResult.cpMeta).toContain('72 purchases');
    expect(askBrowserResult.cpReceiptsHeader).toBe('RECEIPTS (72)');
    expect(askBrowserResult.cpDrawerRowCount).toBe(72);

    // 4b assertions: December coffee spend
    expect(askBrowserResult.decPrefixSup).toBe('US$');
    expect(`$${askBrowserResult.decOdoText}`).toBe(expectedDecCoffee.formatted_answer);
    expect(askBrowserResult.decInterpretation.toLowerCase()).toContain('coffee');
    expect(askBrowserResult.decInterpretation.toLowerCase()).toContain('dec');
    expect(askBrowserResult.decMeta).toContain(
      `${expectedDecCoffee.matching_txn_ids.length} purchases on ${expectedDecCoffee.matching_dates.length} days`
    );
    expect(askBrowserResult.decDaysHighlighted).toBe(expectedDecCoffee.matching_dates.length);

    // 4c assertions: Unanswerable time-of-day rejection + suggested question execution
    expect(askBrowserResult.unanswerableHeadline).toBe('Can’t tell');
    expect(askBrowserResult.unanswerableReason.toLowerCase()).toMatch(/time|date/);
    expect(askBrowserResult.suggestedQuestionText.length).toBeGreaterThan(5);
    expect(askBrowserResult.afterSuggestionInputVal).toBe(askBrowserResult.suggestedQuestionText);
    expect(askBrowserResult.afterSuggestionOdo.length).toBeGreaterThan(0);
    expect(askBrowserResult.afterSuggestionInterp.length).toBeGreaterThan(0);
  });

  it('5. Motion Events & 60fps Frame Budget (BRIEF.md §4): stepping through 45s film storyboard logs deterministic MotionEvent[] and keeps p95 <= 20ms', async () => {
    const filmResult = await page.evaluate(async () => {
      const bridge = window.__YEAR_APP__!;

      // Reset to fresh start state before running the 45-second storyboard
      bridge.player.timeline.clearEvents();
      (bridge.player as unknown as { started: boolean }).started = false;

      const stepLatencies: number[] = [];
      // Step through 0..45s at 0.25s increments (181 deterministic steps covering every segment)
      for (let step = 0; step <= 180; step++) {
        const tSec = step * 0.25;
        const t0 = performance.now();
        bridge.seekFilm(tSec);
        stepLatencies.push(performance.now() - t0);

        // Allow microtask queue to flush when Ask segment triggers at t = 29s
        if (Math.abs(tSec - 29.0) < 0.01) {
          await Promise.resolve();
        }
      }

      // Trigger share card PNG export at the end of the share_card segment (41-45s)
      const dataUrl1350 = await bridge.exportShareCardPng('1080x1350');
      const dataUrl1920 = await bridge.exportShareCardPng('1080x1920');

      const events = [...bridge.getMotionEvents()];
      return {
        stepLatencies,
        events,
        dataUrl1350Prefix: dataUrl1350.slice(0, 30),
        dataUrl1920Prefix: dataUrl1920.slice(0, 30),
      };
    });

    const sortedLatencies = [...filmResult.stepLatencies].sort((a, b) => a - b);
    const p50 = percentile(sortedLatencies, 50);
    const p95 = percentile(sortedLatencies, 95);
    const maxLat = sortedLatencies[sortedLatencies.length - 1] ?? 0;

    perfMetrics.filmStepLatenciesMs = filmResult.stepLatencies;
    perfMetrics.filmP50Ms = p50;
    perfMetrics.filmP95Ms = p95;
    perfMetrics.filmMaxMs = maxLat;

    // Verify p95 <= 20ms frame budget
    expect(p95).toBeLessThanOrEqual(20);

    // Verify all required MotionEvent types are logged deterministically
    const eventTypes = new Set(filmResult.events.map((e: MotionEvent) => e.type));
    expect(eventTypes.has('start_open')).toBe(true);
    expect(eventTypes.has('chapter.go')).toBe(true);
    expect(eventTypes.has('sweep.payday')).toBe(true);
    expect(eventTypes.has('shatter.break')).toBe(true);
    expect(eventTypes.has('ask.answer')).toBe(true);
    expect(eventTypes.has('share.export')).toBe(true);

    // Verify payday pulse events were logged during the sweep
    const paydayEvents = filmResult.events.filter((e: MotionEvent) => e.type === 'sweep.payday');
    expect(paydayEvents.length).toBeGreaterThanOrEqual(11);

    // Verify every MotionEvent has valid schema (type, timestamp >= 0, beat >= 0)
    for (const ev of filmResult.events) {
      expect(typeof ev.type).toBe('string');
      expect(typeof ev.timestamp).toBe('number');
      expect(ev.timestamp).toBeGreaterThanOrEqual(0);
      expect(typeof ev.beat).toBe('number');
      expect(ev.beat).toBeGreaterThanOrEqual(0);
    }

    // Verify Share Card PNG exports succeeded in both 1080x1350 and 1080x1920
    expect(filmResult.dataUrl1350Prefix).toContain('data:image/png;base64,');
    expect(filmResult.dataUrl1920Prefix).toContain('data:image/png;base64,');
  });

  it('6. Phone Viewport Gestures (390×844) & Offline / Zero Console Errors Check (BRIEF.md §2 & §3.1)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });

    const phoneResult = await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;
      bridge.player.fitViewport();
      bridge.goToChapter(0);

      const stageEl = document.getElementById('stage')!;
      const hasPhoneClass = stageEl.classList.contains('phone-layout');
      const rect = stageEl.getBoundingClientRect();

      // Tap right half of stage -> next chapter
      stageEl.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: rect.left + rect.width * 0.8,
          clientY: rect.top + rect.height * 0.5,
          bubbles: true,
        })
      );
      stageEl.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: rect.left + rect.width * 0.8,
          clientY: rect.top + rect.height * 0.5,
          bubbles: true,
        })
      );
      const chapterAfterTapRight = bridge.getState().chapterIndex;

      // Tap left half of stage -> prev chapter
      stageEl.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: rect.left + rect.width * 0.2,
          clientY: rect.top + rect.height * 0.5,
          bubbles: true,
        })
      );
      stageEl.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: rect.left + rect.width * 0.2,
          clientY: rect.top + rect.height * 0.5,
          bubbles: true,
        })
      );
      const chapterAfterTapLeft = bridge.getState().chapterIndex;

      // Swipe up on stage -> opens Explore mode
      stageEl.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: rect.left + rect.width * 0.5,
          clientY: rect.top + rect.height * 0.7,
          bubbles: true,
        })
      );
      stageEl.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: rect.left + rect.width * 0.5,
          clientY: rect.top + rect.height * 0.2,
          bubbles: true,
        })
      );
      const modeAfterSwipeUp = bridge.getState().mode;

      return {
        hasPhoneClass,
        chapterAfterTapRight,
        chapterAfterTapLeft,
        modeAfterSwipeUp,
      };
    });

    expect(phoneResult.hasPhoneClass).toBe(true);
    expect(phoneResult.chapterAfterTapRight).toBe(1);
    expect(phoneResult.chapterAfterTapLeft).toBe(0);
    expect(phoneResult.modeAfterSwipeUp).toBe('explore');

    // Restore 1920x1080 desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Confirm zero runtime console errors, zero uncaught page errors, and zero external CDN requests
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(realFacts.length).toBeGreaterThan(50);
  });
});
