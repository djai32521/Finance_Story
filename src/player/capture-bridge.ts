import type { Category, MotionEvent } from '../../contracts/index.js';
import { ShareExporter, type ShareCardSize } from '../explore/share-exporter.js';
import type { StoryPlayer } from './story-player.js';

export interface YearAppCaptureBridge {
  player: StoryPlayer;
  startFilm(): void;
  seekFilm(timeSec: number): void;
  seekLoop(timeSec: number): void;
  goToChapter(indexOrId: number | string): void;
  openExplore(initialCategory?: Category): void;
  closeExplore(): void;
  selectCategoryLens(cat: Category | ''): void;
  clickDay(dayIndex: number): void;
  dragDays(startDayIndex: number, endDayIndex: number): void;
  openAsk(question?: string): void;
  openReceipts(title?: string, txnIds?: string[]): void;
  setFakeCursor(x: number, y: number, clicking?: boolean): void;
  exportShareCardPng(size?: ShareCardSize): Promise<string>;
  getMotionEvents(): readonly MotionEvent[];
  setReducedMotion(enabled: boolean): void;
  getState(): ReturnType<StoryPlayer['getState']>;
}

declare global {
  interface Window {
    __YEAR_APP__?: YearAppCaptureBridge;
    __STORY_PLAYER__?: StoryPlayer;
    ShareExporter?: typeof ShareExporter;
    __api?: Record<string, unknown>;
  }
}

export class CaptureBridge implements YearAppCaptureBridge {
  public readonly player: StoryPlayer;
  private activeSegmentId = '';
  private lastFilmSec = 0;

  constructor(player: StoryPlayer) {
    this.player = player;
  }

  public startFilm(): void {
    document.body.classList.add('film');
    this.player.manualStepping = false;
    this.player.fitViewport();
    this.activeSegmentId = '';
    this.lastFilmSec = 0;
    this.player.startStory();
  }

  /**
   * Deterministic 45-second storyboard seeker for 60fps Playwright video capture (Phase 5).
   *
   * Storyboard (BRIEF.md §7 Phase 5):
   * - 0–2s:   The CSV shatters into particles that pour into the page
   * - 2–5s:   Title slams in: "Your 2025"
   * - 5–9s:   Kinetic count of the number of transactions
   * - 9–14s:  The grid sweep with payday pulses
   * - 14–18s: The strongest chosen chapter (your_place)
   * - 18–23s: A bespoke chapter with its "only in your app" label
   * - 23–27s: The streak chapter (or next strongest)
   * - 27–32s: Open explore; Ask your year with a pre-tested question; grid lights up; answer slams in
   * - 32–36s: Shatter into categories; tap a category lens; the grid re-colours
   * - 36–41s: Personality reveal
   * - 41–45s: Share card
   */
  public seekFilm(timeSec: number): void {
    const t = Math.max(0, Math.min(45, timeSec));
    const dt = Math.max(1 / 60, Math.min(0.25, Math.abs(t - this.lastFilmSec) || 1 / 60));
    this.lastFilmSec = t;

    this.player.manualStepping = true;
    document.body.classList.add('film');
    this.player.fitViewport();

    const chapters = this.player.data.plan.chapters;
    const findChapterId = (preferredTypes: string[], fallbackIdx: number): string => {
      for (const pt of preferredTypes) {
        const found = chapters.find((c) => c.id === pt || c.type === pt);
        if (found) return found.id;
      }
      return chapters[Math.min(chapters.length - 1, fallbackIdx)]?.id ?? 'pour';
    };

    let timelineSeeked = false;

    if (t < 9) {
      // 0–9s: Pour (0–2s) -> "2025" Title (2–5s) -> Kinetic transaction count (5–9s)
      const seg = 'seg_pour';
      if (this.activeSegmentId !== seg) {
        this.activeSegmentId = seg;
        this.player.goToChapter(findChapterId(['pour'], 0));
        this.player.timeline.pause();
      }
      let localSec: number;
      if (t < 2.0) {
        localSec = 0.35 + (t / 2.0) * 3.3;
      } else if (t < 5.0) {
        localSec = 3.65 + ((t - 2.0) / 3.0) * 3.0;
      } else if (t < 5.7) {
        localSec = 6.65 + ((t - 5.0) / 0.7) * 1.75;
      } else if (t < 6.8) {
        localSec = 8.4 + ((t - 5.7) / 1.1) * 1.65;
      } else {
        localSec = 10.05 + ((t - 6.8) / 2.2) * 0.95;
      }
      this.player.timeline.seek(localSec);
      timelineSeeked = true;
      const cursorX = t < 2 ? 1480 - t * 200 : t < 6 ? 960 : 1460;
      const cursorY = t < 2 ? 420 - t * 40 : t < 6 ? 540 : 280;
      this.player.setFakeCursor(cursorX, cursorY, Math.abs(t - 0.1) < 0.04);
    } else if (t < 14) {
      // 9–14s: Grid sweep with payday pulses across all 365 days
      const seg = 'seg_sweep';
      if (this.activeSegmentId !== seg) {
        this.activeSegmentId = seg;
        this.player.goToChapter(findChapterId(['year_as_squares'], 1));
        this.player.timeline.pause();
      }
      const localSec = 0.4 + ((t - 9) / 5) * 8.6;
      this.player.timeline.seek(localSec);
      timelineSeeked = true;
      this.player.setFakeCursor(220 + ((t - 9) / 5) * 1560, 620, false);
    } else if (t < 18) {
      // 14–18s: Strongest chosen chapter (your_place)
      const seg = 'seg_place';
      if (this.activeSegmentId !== seg) {
        this.activeSegmentId = seg;
        this.player.goToChapter(findChapterId(['your_place'], 2));
        this.player.timeline.pause();
      }
      const localSec = t < 15.8 ? 0.25 + ((t - 14) / 1.8) * 2.75 : 3.0 + ((t - 15.8) / 2.2) * 0.8;
      this.player.timeline.seek(localSec);
      timelineSeeked = true;
      this.player.setFakeCursor(620 + (t - 14) * 60, 480, false);
    } else if (t < 23) {
      // 18–23s: Bespoke chapter ("only in your app" — Studio Build)
      const seg = 'seg_bespoke';
      if (this.activeSegmentId !== seg) {
        this.activeSegmentId = seg;
        const bespokeCh = chapters.find((c) => c.type === 'bespoke' || Boolean(c.params.badge));
        this.player.goToChapter(bespokeCh ? bespokeCh.id : findChapterId(['streak', 'getaway'], 3));
        this.player.timeline.pause();
      }
      const localSec = 0.25 + ((t - 18) / 5) * 3.2;
      this.player.timeline.seek(localSec);
      timelineSeeked = true;
      this.player.setFakeCursor(920 + (t - 18) * 50, 520, false);
    } else if (t < 27) {
      // 23–27s: Streak chapter ("24 days in a row. And 58 quiet days.")
      const seg = 'seg_streak';
      if (this.activeSegmentId !== seg) {
        this.activeSegmentId = seg;
        this.player.goToChapter(findChapterId(['streak', 'heartbeat', 'big_one', 'getaway'], 4));
        this.player.timeline.pause();
      }
      const localSec = 0.25 + ((t - 23) / 4) * 3.0;
      this.player.timeline.seek(localSec);
      timelineSeeked = true;
      this.player.setFakeCursor(840 + (t - 23) * 45, 600, false);
    } else if (t < 32) {
      // 27–32s: Explore (27–29s) -> Ask your year (29–32s)
      if (t < 29) {
        const seg = 'seg_explore';
        if (this.activeSegmentId !== seg) {
          this.activeSegmentId = seg;
          this.player.openExplore();
          this.player.exploreOverlay.dragSelector.selectRangeProgrammatically(90, 120);
        }
        const subT = t - 27;
        this.player.setFakeCursor(480 + subT * 260, 440, Math.abs(subT - 0.5) < 0.04);
      } else {
        const seg = 'seg_ask';
        if (this.activeSegmentId !== seg) {
          this.activeSegmentId = seg;
          this.player.openAsk('How much did I spend on coffee in December?');
          this.player.timeline.pause();
        }
        const subT = t - 29;
        this.player.timeline.seek(0.2 + subT * 0.9);
        timelineSeeked = true;
        this.player.setFakeCursor(1720, 170, Math.abs(subT - 0.15) < 0.04);
      }
    } else if (t < 36) {
      // 32–36s: Shatter into categories (32–34.75s) -> Tap category lens & re-colour grid (34.75–36s)
      if (t < 34.75) {
        const seg = 'seg_shatter';
        if (this.activeSegmentId !== seg) {
          this.activeSegmentId = seg;
          this.player.goToChapter(findChapterId(['shatter'], 9));
          this.player.timeline.pause();
        }
        const localSec = 0.35 + ((t - 32) / 2.75) * 3.5;
        this.player.timeline.seek(localSec);
        timelineSeeked = true;
        this.player.setFakeCursor(440 + (t - 32) * 320, 740, false);
      } else {
        const seg = 'seg_shatter_lens';
        if (this.activeSegmentId !== seg) {
          this.activeSegmentId = seg;
          this.player.openExplore('coffee');
        }
        const subT = t - 34.75;
        this.player.setFakeCursor(510 + subT * 40, 204, subT < 0.15);
      }
    } else if (t < 41) {
      // 36–41s: Personality reveal
      const seg = 'seg_personality';
      if (this.activeSegmentId !== seg) {
        this.activeSegmentId = seg;
        this.player.goToChapter(findChapterId(['personality'], 10));
        this.player.timeline.pause();
      }
      const localSec = 0.25 + ((t - 36) / 5) * 3.4;
      this.player.timeline.seek(localSec);
      timelineSeeked = true;
      this.player.setFakeCursor(1420, 480, false);
    } else {
      // 41–45s: Share card
      const seg = 'seg_share';
      if (this.activeSegmentId !== seg) {
        this.activeSegmentId = seg;
        this.player.goToChapter(findChapterId(['share_card'], chapters.length - 1));
        this.player.timeline.pause();
      }
      const localSec = 0.25 + ((t - 41) / 4) * 2.5;
      this.player.timeline.seek(localSec);
      timelineSeeked = true;
      this.player.setFakeCursor(320, 620, Math.abs(t - 42.5) < 0.04);
    }

    if (!timelineSeeked) {
      this.player.grid.stepAndDraw(dt);
    }
  }

  /**
   * Deterministic 5-second seamless loop seeker (`0.0s .. 5.0s`) for `capture/loop.mp4`:
   * Starts on the 53x7 calendar grid, shatters into category columns with dollar odometers,
   * holds the columns, and snaps cleanly back into the 53x7 calendar grid at 5.0s.
   */
  public seekLoop(timeSec: number): void {
    const t = Math.max(0, Math.min(5, timeSec));
    this.player.manualStepping = true;
    document.body.classList.add('film');
    this.player.fitViewport();

    const seg = 'seg_loop_shatter';
    if (this.activeSegmentId !== seg) {
      this.activeSegmentId = seg;
      const chapters = this.player.data.plan.chapters;
      const shatterCh = chapters.find((c) => c.id === 'shatter' || c.type === 'shatter');
      this.player.goToChapter(shatterCh ? shatterCh.id : 0);
      this.player.timeline.pause();
    }

    // Map 0..5.0s onto ShatterChapter's 0.65..5.45s cycle (grid -> shatter -> hold -> snap back to grid)
    const localSec = 0.65 + (t / 5.0) * 4.8;
    this.player.timeline.seek(localSec);
    const cursorX = 320 + Math.sin((t / 5.0) * Math.PI) * 1100;
    const cursorY = 660 - Math.sin((t / 5.0) * Math.PI) * 140;
    this.player.setFakeCursor(cursorX, cursorY, Math.abs(t - 0.35) < 0.04);
  }

  public goToChapter(indexOrId: number | string): void {
    this.player.goToChapter(indexOrId);
  }

  public openExplore(initialCategory?: Category): void {
    this.player.openExplore(initialCategory);
  }

  public closeExplore(): void {
    this.player.closeExplore();
  }

  public selectCategoryLens(cat: Category | ''): void {
    if (this.player.getState().mode !== 'explore') {
      this.player.openExplore();
    }
    this.player.exploreOverlay.selectCategoryLens(cat);
  }

  public clickDay(dayIndex: number): void {
    if (this.player.getState().mode !== 'explore') {
      this.player.openExplore();
    }
    const dv = this.player.grid.days[dayIndex];
    if (dv) {
      this.player.exploreOverlay.flipCard.open(dv, this.player.grid.currentGeometry);
    }
  }

  public dragDays(startDayIndex: number, endDayIndex: number): void {
    if (this.player.getState().mode !== 'explore') {
      this.player.openExplore();
    }
    this.player.exploreOverlay.dragSelector.selectRangeProgrammatically(startDayIndex, endDayIndex);
  }

  public openAsk(question?: string): void {
    this.player.openAsk(question);
  }

  public openReceipts(title = 'Receipts', txnIds?: string[]): void {
    const ids =
      txnIds ??
      this.player.data.plan.chapters[Math.max(0, this.player.getState().chapterIndex)]?.txn_ids ??
      [];
    this.player.openReceipts(title, ids);
  }

  public setFakeCursor(x: number, y: number, clicking = false): void {
    this.player.setFakeCursor(x, y, clicking);
  }

  public exportShareCardPng(size: ShareCardSize = '1080x1350'): Promise<string> {
    return this.player.exportShareCard(size);
  }

  public getMotionEvents(): readonly MotionEvent[] {
    return this.player.getMotionEvents();
  }

  public setReducedMotion(enabled: boolean): void {
    this.player.setReducedMotion(enabled);
  }

  public getState(): ReturnType<StoryPlayer['getState']> {
    return this.player.getState();
  }
}

export function installCaptureBridge(player: StoryPlayer): YearAppCaptureBridge {
  const bridge = new CaptureBridge(player);
  if (typeof window !== 'undefined') {
    window.__YEAR_APP__ = bridge;
    window.__STORY_PLAYER__ = player;
    window.ShareExporter = ShareExporter;
    window.__api = {
      go: (n: number) => bridge.goToChapter(n),
      playFilm: () => bridge.startFilm(),
      seekFilm: (s: number) => bridge.seekFilm(s),
      get ML() {
        return bridge.getMotionEvents();
      },
    };
  }
  return bridge;
}
