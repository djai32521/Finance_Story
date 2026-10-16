import gsap from 'gsap';
import type {
  AskQueryResult,
  Category,
  Chapter,
  ChapterModule,
  DatasetBundle,
  Day,
  Fact,
  IngestProgressStep,
  MotionEvent,
  PaletteTheme,
  RawIngestFile,
  StoryPlan,
  Transaction,
} from '../../contracts/index.js';
import { formatMoneyMinor } from '../../contracts/index.js';
import { answerQuestionDeterministically } from '../ask/index.js';
import { createCoreChapterModule } from '../chapters/core/index.js';
import type { ExtendedChapterContext } from '../chapters/core/pour-chapter.js';
import { ExploreOverlay } from '../explore/explore-overlay.js';
import { ReceiptsDrawer } from '../explore/receipts-drawer.js';
import { ShareExporter, type ShareCardSize } from '../explore/share-exporter.js';
import {
  CATEGORY_COLORS,
  EASE,
  GRID_PRESETS,
  InteractiveGrid,
  RGB_PALETTE,
  hexToRgb,
} from '../grid/interactive-grid.js';
import { fetchGoogleDriveInput, processByoIngestion, readBrowserFiles } from '../ingest/index.js';
import { AudioCueSlot } from './audio-cue.js';
import {
  MOTION_TOKENS,
  Odometer,
  PlayerTimelineController,
  enterStageGroup,
  exitStageGroup,
  resolveCopyTemplate,
} from './timeline-controller.js';
import { getLanguage, toggleLanguage, t } from '../i18n.js';

export interface StoryPlayerData {
  transactions: readonly Transaction[];
  days: readonly Day[];
  facts: readonly Fact[];
  plan: StoryPlan;
}

export type CustomAskExecutor = (question: string) => Promise<AskQueryResult> | AskQueryResult;

const DEFAULT_PALETTES: Record<string, PaletteTheme> = {
  ink_solar: {
    id: 'ink_solar',
    name: 'Ink Solar',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#F4F03A',
    secondary: '#FF5A14',
    muted: '#8E8A7F',
    blocks: {
      primary: { bg: '#F4F03A', fg: '#111111' },
      secondary: { bg: '#FFA8E4', fg: '#111111' },
      tertiary: { bg: '#FF5A14', fg: '#111111' },
      quaternary: { bg: '#A9A2E0', fg: '#111111' },
    },
  },
  solar_ember: {
    id: 'solar_ember',
    name: 'Solar Ember',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#FF5A14',
    secondary: '#F4F03A',
    muted: '#8E8A7F',
    blocks: {
      primary: { bg: '#F4F03A', fg: '#111111' },
      secondary: { bg: '#FF5A14', fg: '#111111' },
      tertiary: { bg: '#FFA8E4', fg: '#111111' },
      quaternary: { bg: '#A9A2E0', fg: '#111111' },
    },
  },
  ink_rose: {
    id: 'ink_rose',
    name: 'Ink Rose',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#FFA8E4',
    secondary: '#F4F03A',
    muted: '#8E8A7F',
    blocks: {
      primary: { bg: '#FFA8E4', fg: '#111111' },
      secondary: { bg: '#F4F03A', fg: '#111111' },
      tertiary: { bg: '#6E8BFF', fg: '#111111' },
    },
  },
  paper_studio: {
    id: 'paper_studio',
    name: 'Paper Studio',
    bg: '#111111',
    fg: '#F3F0E6',
    accent: '#F3F0E6',
    secondary: '#FF5A14',
    muted: '#8E8A7F',
    blocks: {
      primary: { bg: '#F3F0E6', fg: '#111111' },
      secondary: { bg: '#FF5A14', fg: '#111111' },
      tertiary: { bg: '#B9B744', fg: '#111111' },
    },
  },
};

const ASK_SAMPLE_QUESTIONS = [
  'How much did I spend on coffee in December?',
  'What did Blue Bottle Coffee cost me?',
  'How many takeaway orders?',
  'Eating out on weekends',
  'Biggest purchase?',
  'Spending by time of day',
];

const ASK_SAMPLE_QUESTIONS_KO = [
  '12월에 커피에 쓴 금액은 얼마인가요?',
  '가장 금액이 컸던 지출 내역은?',
  '식비 및 외식 총 지출액은?',
  '주말 배달 및 외식 횟수는?',
  '시간대별 지출 패턴은?',
  '가장 자주 결제한 가맹점 Top 5는?',
];

export class StoryPlayer {
  public readonly rootEl: HTMLElement;
  public data: StoryPlayerData;
  public factMap: ReadonlyMap<string, Fact>;
  public readonly audioCue: AudioCueSlot;
  public readonly timeline: PlayerTimelineController;
  public readonly grid: InteractiveGrid;
  public readonly receiptsDrawer: ReceiptsDrawer;
  public readonly exploreOverlay: ExploreOverlay;

  private stageWrapEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private underLayerEl!: HTMLElement;
  private overLayerEl!: HTMLElement;
  private chromeLayerEl!: HTMLElement;
  private startScreenEl!: HTMLElement;
  private askLayerEl!: HTMLElement;
  private chapterHostEl!: HTMLElement;

  private stageScale = 0.5;
  private viewportMode: 'desktop' | 'phone' = 'desktop';
  private started = false;
  private currentChapterIdx = -1;
  private activeChapterModule: ChapterModule | null = null;
  private mode: 'start' | 'story' | 'explore' | 'ask' = 'start';
  private customAskExecutor: CustomAskExecutor | null = null;
  private readonly customChapterRegistry = new Map<string, () => ChapterModule>();
  public manualStepping = false;
  public byoMode = false;
  public byoLoaded = false;
  private byoBusy = false;
  private deepAgentAbortController: AbortController | null = null;
  private byoElapsedTimer: ReturnType<typeof setInterval> | null = null;
  private byoStartMs = 0;
  private byoLastPct = 0;
  private byoDeepAgentActive = false;

  private lastFrameMs = 0;
  private tickerBound: (() => void) | null = null;
  private resizeBound: (() => void) | null = null;
  private keydownBound: ((e: KeyboardEvent) => void) | null = null;

  constructor(rootEl: HTMLElement, data: StoryPlayerData) {
    this.rootEl = rootEl;
    this.data = data;
    this.factMap = new Map(data.facts.map((f) => [f.id, f]));
    this.audioCue = new AudioCueSlot();

    const search = typeof window !== 'undefined' ? window.location.search : '';
    const isWebdriver = typeof navigator !== 'undefined' && Boolean(navigator.webdriver);
    this.byoMode =
      search.includes('byo=1') ||
      (!search.includes('film=1') &&
        !search.includes('chapter=') &&
        !search.includes('legacy=1') &&
        !isWebdriver);

    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.timeline = new PlayerTimelineController({
      reducedMotion: prefersReduced,
      onSeek: (_sec, deltaSec) => {
        if (deltaSec !== 0) {
          this.grid.stepAndDraw(Math.abs(deltaSec));
        } else {
          this.grid.stepAndDraw(1 / 60);
        }
      },
    });

    this.injectStyles();
    this.buildShellDom();

    const canvas = this.stageEl.querySelector<HTMLCanvasElement>('#cv')!;
    this.grid = new InteractiveGrid(canvas, data.days, data.transactions, {
      categoryLabels: data.plan.category_labels,
      isB2B: Boolean(data.plan.business_meta),
      milestoneLabel: data.plan.business_meta?.milestone_singular ?? 'Payday',
      currencySymbol: data.plan.business_meta?.currency_symbol ?? 'US$',
    });
    this.grid.reducedMotion = prefersReduced;

    this.receiptsDrawer = new ReceiptsDrawer(this.rootEl, data.transactions, (type, val) =>
      this.timeline.logEvent(type, val)
    );
    this.receiptsDrawer.reducedMotion = prefersReduced;
    if (data.plan.business_meta?.currency_symbol) {
      this.receiptsDrawer.currencySymbol = data.plan.business_meta.currency_symbol;
    }

    this.exploreOverlay = new ExploreOverlay(
      this.underLayerEl,
      this.overLayerEl,
      this.chromeLayerEl,
      this.grid,
      {
        onCloseExplore: () => this.closeExplore(),
        onOpenReceipts: (title, ids) => this.openReceipts(title, ids),
        onOpenAsk: (q) => this.openAsk(q),
        onExportShareCard: (size) => this.exportShareCard(size),
        onLogEvent: (type, val) => this.timeline.logEvent(type, val),
        getStageScale: () => this.stageScale,
        getStageElement: () => this.stageEl,
      }
    );
    this.exploreOverlay.setDataset(
      data.days,
      data.transactions,
      data.plan.category_labels,
      Boolean(data.plan.business_meta),
      data.plan.business_meta?.currency_symbol
    );

    this.buildAskOverlayDom();
    this.bindEvents();
    this.fitViewport();
    this.grid.stepAndDraw(0);
    this.playStartScreenIntro();
  }

  public registerChapterModule(key: string, factory: () => ChapterModule): void {
    this.customChapterRegistry.set(key, factory);
  }

  public setCustomAskExecutor(executor: CustomAskExecutor): void {
    this.customAskExecutor = executor;
  }

  public resolveCopy(template: string): string {
    return resolveCopyTemplate(template, this.factMap);
  }

  public getFact(factId: string): Fact {
    const f = this.factMap.get(factId);
    if (!f) {
      throw new Error(`Fact "${factId}" not found in StoryPlayer factMap`);
    }
    return f;
  }

  private injectStyles(): void {
    if (document.getElementById('sam-2025-player-styles')) return;
    const style = document.createElement('style');
    style.id = 'sam-2025-player-styles';
    style.textContent = `
      :root {
        --ink: #111111;
        --bone: #F3F0E6;
        --paper: #E6E4DE;
        --c1: #F4F03A;
        --c2: #FFA8E4;
        --c3: #B9B744;
        --c4: #FF5A14;
        --c5: #E3A83C;
        --c6: #FF6B57;
        --lav: #A9A2E0;
        --mint: #B9F0C6;
        --blue: #6E8BFF;
        --ghost: #1C1C1B;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { background: var(--ink); color: var(--bone); overflow: hidden; width: 100vw; height: 100vh; font-family: 'Inter Tight', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
      body:not(.show-dev-bar) #app { width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
      button, input { font: inherit; color: inherit; background: none; border: 0; }
      button { cursor: pointer; }
      .mono, .lab { font-family: 'JetBrains Mono', monospace; }
      .lab { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 500; line-height: 1.45; }
      #bar { position: sticky; top: 0; z-index: 40; display: none; gap: 10px 14px; align-items: center; flex-wrap: wrap; padding: 10px 20px; background: var(--paper); color: var(--ink); border-bottom: 1.5px solid var(--ink); }
      body.show-dev-bar #bar { display: flex; }
      #bar .brand { margin-right: auto; display: flex; flex-direction: column; gap: 2px; }
      #bar .brand b { font-weight: 500; font-size: 18px; letter-spacing: -0.01em; }
      #bar .brand span { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
      .btn { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; padding: 9px 14px; border: 1.5px solid var(--ink); transition: scale 0.12s, background-color 0.2s, color 0.2s; }
      .btn:active { scale: 0.94; }
      .btn.primary { background: var(--ink); color: var(--bone); }
      #chnav { display: flex; border: 1.5px solid var(--ink); flex-wrap: wrap; }
      #chnav button { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px 10px; }
      #chnav button + button { border-left: 1.5px solid var(--ink); }
      #chnav button[aria-current="true"] { background: var(--ink); color: var(--bone); }
      .tog { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; display: flex; gap: 6px; align-items: center; cursor: pointer; }
      .tog input { width: 15px; height: 15px; accent-color: #111; }
      #stagewrap { position: relative; margin: 0 auto; width: calc(1920px * var(--s, 0.5)); height: calc(1080px * var(--s, 0.5)); flex-shrink: 0; }
      #stage { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform: scale(var(--s, 0.5)); transform-origin: 0 0; background: var(--ink); color: var(--bone); overflow: hidden; contain: strict; user-select: none; -webkit-user-select: none; }
      .layer { position: absolute; inset: 0; }
      #cv { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
      .ch { position: absolute; inset: 0; }
      .ia { pointer-events: auto; }
      .ch-header-stack { position: absolute; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; z-index: 6; pointer-events: none; }
      .ch-header-stack > .lab, .ch-header-stack > .tx, .ch-header-stack > [data-testid='chapter-headline'], .ch-header-stack > [data-testid='chapter-body'] { position: relative !important; top: auto !important; left: auto !important; right: auto !important; margin: 0; pointer-events: auto; }
      .blk { position: absolute; overflow: hidden; }
      .blk > .lab { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.25; }
      .blk:has(> .rc) > .lab:first-child:not([style*='right']):not([style*='display:flex']):not([style*='display: flex']), .blk:has(> .receipt-trigger) > .lab:first-child:not([style*='right']):not([style*='display:flex']):not([style*='display: flex']) { max-width: calc(100% - 132px); }
      .blk > .lab[style*='display:flex'], .blk > .lab[style*='display: flex'] { max-width: none; gap: 8px; }
      .blk > .lab > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .blk > .lab > button { flex-shrink: 0; white-space: nowrap; }
      .blk[data-ax="b"] { transform-origin: 50% 100%; }
      .blk[data-ax="t"] { transform-origin: 50% 0%; }
      .blk[data-ax="l"] { transform-origin: 0% 50%; }
      .blk[data-ax="r"] { transform-origin: 100% 50%; }
      .num { font-weight: 300; letter-spacing: -0.045em; line-height: 1; white-space: nowrap; display: flex; align-items: flex-start; font-feature-settings: 'tnum'; }
      .num sup { font-family: 'JetBrains Mono', monospace; font-size: clamp(11px, 0.12em, 26px); font-weight: 500; letter-spacing: 0.06em; line-height: 1; margin: 0.34em 0.16em 0 0; }
      .num sup.aft { margin: 0.34em 0 0 0.14em; }
      .odo { display: inline-flex; }
      .odo .dg { display: inline-block; height: 1em; overflow: hidden; }
      .odo .st { display: block; will-change: transform; }
      .odo .st i { display: block; height: 1em; line-height: 1em; font-style: normal; text-align: center; }
      .odo .sp { display: inline-block; height: 1em; line-height: 1em; }
      .split .ln { display: block; white-space: normal; overflow: visible; }
      .split .w { display: inline-block; overflow: hidden; vertical-align: top; padding: 0.04em 0.03em 0.16em; margin: -0.04em -0.03em -0.16em; }
      .split .l { display: inline-block; will-change: transform; }
      .chip { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border: 1.5px solid var(--bone); font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 500; color: var(--bone); }
      .chip i { width: 10px; height: 10px; display: block; }
      .chip[aria-pressed="true"] { background: var(--bone); color: var(--ink); }
      #prog { position: absolute; left: 0; top: 0; right: 0; height: 6px; display: flex; gap: 4px; pointer-events: auto; }
      #prog button { flex: 1; background: #2A2A29; position: relative; overflow: hidden; height: 6px; border: 0; padding: 0; cursor: pointer; }
      #prog button i { position: absolute; inset: 0; background: var(--bone); transform-origin: 0 50%; transform: scaleX(0); }
      #beatdot { display: inline-block; width: 9px; height: 9px; background: var(--c4); margin-right: 6px; }
      #stage-hud-nav { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; background: rgba(17, 17, 17, 0.88); border: 1.5px solid #3A3A38; color: var(--bone); pointer-events: auto; z-index: 55; }
      #stage-hud-nav button { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; padding: 7px 12px; color: var(--bone); transition: background-color 0.16s, color 0.16s; white-space: nowrap; }
      #stage-hud-nav button + button { border-left: 1.5px solid #3A3A38; }
      #stage-hud-nav button:hover { background: var(--bone); color: var(--ink); }
      #stage-hud-nav button.hud-primary { background: var(--c1); color: var(--ink); font-weight: 600; }
      body.film { padding: 0; background: var(--ink); overflow: hidden; }
      body.film #bar { display: none; }
      body.film #stage-hud-nav { display: none !important; }
      body.film #stagewrap { margin: 0; }
      #stagewrap.native-phone { width: calc(390px * var(--s, 0.85)); height: calc(844px * var(--s, 0.85)); }
      #stage.native-phone { width: 390px; height: 844px; }
      #stage.native-phone #chrome > .lab { display: none; }
      #stage.native-phone #stage-hud-nav { bottom: 10px; transform: translateX(-50%) scale(0.76); }
      @media (max-width: 767px) {
        #bar { padding: 8px 12px; gap: 6px; }
        #chnav { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  private buildShellDom(): void {
    const yearStr =
      this.factMap.get(this.data.plan.year_fact_id)?.formatted ?? String(this.data.plan.year);
    const spendFact = this.factMap.get('total_spend_usd');
    const txnsFact = this.factMap.get('total_transactions_count');
    const byoAwaiting = this.byoMode && !this.byoLoaded;

    const chButtonsHtml = this.data.plan.chapters
      .map(
        (ch, i) =>
          `<button type="button" data-ch-index="${i}" data-testid="nav-chapter-${i}">${String(i + 1).padStart(2, '0')} ${this.escapeHtml((ch.params.kicker ?? ch.type).replace(/^\d+\s*(?:\/\s*\d+\s*)?·\s*/, ''))}</button>`
      )
      .join('');

    const progSegmentsHtml = this.data.plan.chapters
      .map(
        (ch, i) =>
          `<button type="button" data-prog-index="${i}" aria-label="Jump to ${this.escapeHtml(ch.id)}"><i></i></button>`
      )
      .join('');

    const bgPalette = [
      'var(--c1)',
      'var(--c2)',
      'var(--c3)',
      'var(--c4)',
      'var(--lav)',
      'var(--mint)',
      'var(--blue)',
    ];
    const startBgTilesHtml = Array.from({ length: 24 }, (_, idx) => {
      const col = idx % 8;
      const row = Math.floor(idx / 8);
      const x = 96 + col * 232 + (row % 2 === 1 ? 36 : 0);
      const y = 136 + row * 340 + ((col % 3) - 1) * 28;
      const size = 28 + (idx % 4) * 14;
      const color = bgPalette[idx % bgPalette.length]!;
      const baseOp = (0.12 + (idx % 5) * 0.03).toFixed(2);
      return `<div class="start-bg-tile" data-base-op="${baseOp}" style="position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};opacity:${baseOp};pointer-events:none;"></div>`;
    }).join('');

    const isB2BOrInteractive = byoAwaiting || Boolean(this.data.plan.business_meta);
    const heroTitleText = isB2BOrInteractive
      ? t('start_hero_title')
      : `Your ${this.escapeHtml(yearStr)}.`;
    const openBtnText = isB2BOrInteractive
      ? t('start_open_btn')
      : `Open your ${this.escapeHtml(yearStr)}`;

    this.rootEl.innerHTML = `
      <header id="bar" data-testid="player-top-bar">
        <div class="brand">
          <b id="bar-brand-title">${
            byoAwaiting
              ? t('brand_title')
              : `${this.escapeHtml(this.data.plan.person_name)} · ${this.escapeHtml(yearStr)}`
          }</b>
          <span id="bar-brand-sub">${t('brand_sub')}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button type="button" class="btn" id="nav-prev-btn" data-testid="nav-prev-btn">${t('nav_prev')}</button>
          <button type="button" class="btn primary" id="nav-pause-btn" data-testid="nav-pause-btn">${t('nav_pause')}</button>
          <button type="button" class="btn" id="nav-next-btn" data-testid="nav-next-btn">${t('nav_next')}</button>
          <button type="button" class="btn" id="nav-explore-btn" data-testid="nav-explore-btn">${t('nav_explore')}</button>
          <button type="button" class="btn" id="nav-ask-btn" data-testid="nav-ask-btn">${t('nav_ask')}</button>
          <button type="button" class="btn" id="nav-receipts-btn" data-testid="nav-receipts-btn">${t('nav_receipts')}</button>
          <button type="button" class="btn" id="nav-share-btn" data-testid="nav-share-btn">${t('nav_share')}</button>
          <button type="button" class="btn" id="nav-data-btn" data-testid="nav-data-btn" title="Return to landing page to upload a new dataset">${t('nav_data')}</button>
          <button type="button" class="btn" id="nav-lang-btn" data-testid="nav-lang-btn" style="background:var(--c1);color:var(--ink);font-weight:700;">🌐 ${getLanguage() === 'ko' ? '한국어 (KO)' : 'English (EN)'}</button>
        </div>
        <nav id="chnav" aria-label="Chapters">${chButtonsHtml}</nav>
        <label class="tog">
          <input type="checkbox" id="rmtog" data-testid="reduced-motion-toggle" ${this.timeline.isReducedMotion() ? 'checked' : ''} />
          <span id="label-rmtog">${t('reduced_motion')}</span>
        </label>
      </header>

      <div id="stagewrap">
        <div id="stage" data-testid="player-stage">
          <div id="under" class="layer"></div>
          <canvas id="cv" width="1920" height="1080"></canvas>
          <div id="over" class="layer">
            <div id="chapter-host" class="ch"></div>
          </div>
          <div id="chrome" class="layer" style="pointer-events:none">
            <div id="prog" data-testid="story-progress-bar">${progSegmentsHtml}</div>
            <div class="lab" id="chrome-brand-label" style="position:absolute;left:64px;top:28px;font-size:13px">${
              byoAwaiting
                ? t('brand_tag')
                : `${this.escapeHtml(this.data.plan.person_name)} · ${this.escapeHtml(yearStr)} · Finance Story`
            }</div>
            <div class="lab" id="chl" data-testid="chapter-indicator" style="position:absolute;right:64px;top:28px;font-size:13px;text-align:right">${t('hud_start')}</div>
            <div class="lab" style="position:absolute;right:64px;bottom:24px;font-size:12px"><i id="beatdot"></i>${t('hud_bpm')} <span id="beatn">000</span></div>
            <div class="lab" id="hud-hints-label" style="position:absolute;left:64px;bottom:24px;font-size:12px">${t('hud_hints')}</div>
            <div id="stage-hud-nav" data-testid="stage-hud-nav">
              <button type="button" id="hud-prev-btn" data-testid="hud-prev-btn">${t('nav_prev')}</button>
              <button type="button" id="hud-pause-btn" data-testid="hud-pause-btn" class="hud-primary">${t('nav_pause')}</button>
              <button type="button" id="hud-next-btn" data-testid="hud-next-btn">${t('nav_next')}</button>
              <button type="button" id="hud-explore-btn" data-testid="hud-explore-btn">${t('nav_explore')}</button>
              <button type="button" id="hud-ask-btn" data-testid="hud-ask-btn">${t('nav_ask')}</button>
              <button type="button" id="hud-receipts-btn" data-testid="hud-receipts-btn">${t('nav_receipts')}</button>
              <button type="button" id="hud-share-btn" data-testid="hud-share-btn">${t('nav_share')}</button>
              <button type="button" id="hud-data-btn" data-testid="hud-data-btn" title="Return to landing page to upload a new dataset">${t('nav_data')}</button>
              <button type="button" id="hud-lang-btn" data-testid="hud-lang-btn" style="color:var(--c1);font-weight:700;">${getLanguage() === 'ko' ? 'KO' : 'EN'}</button>
            </div>
            <div id="fclick" style="position:absolute;left:0;top:0;width:60px;height:60px;margin:-30px 0 0 -30px;border:2px solid var(--bone);border-radius:50%;opacity:0;pointer-events:none;z-index:60"></div>
            <div id="fcur" data-testid="fake-cursor" style="position:absolute;left:0;top:0;pointer-events:none;opacity:0;z-index:65">
              <svg width="34" height="40" viewBox="0 0 34 40"><path d="M4 3 L4 33 L12 25 L18 38 L24 35.5 L18 23 L29 23 Z" fill="#F3F0E6" stroke="#111" stroke-width="2.4" stroke-linejoin="round"/></svg>
            </div>
          </div>

          <!-- Start Screen -->
          <div id="start-screen" data-testid="start-screen" style="position:absolute;inset:0;background:var(--ink);color:var(--bone);z-index:60;display:flex;flex-direction:column;justify-content:space-between;padding:72px 96px;overflow:hidden;">
            <div id="start-bg-grid" data-testid="start-bg-grid" style="position:absolute;inset:0;pointer-events:none;z-index:0;">${startBgTilesHtml}</div>
            <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center">
              <span class="lab" id="start-top-left-label">${isB2BOrInteractive ? t('start_top_left') : `${this.escapeHtml(this.data.plan.person_name)} · FINANCIAL ARCHIVE`}</span>
              <div style="display:flex;align-items:center;gap:14px;">
                <button type="button" id="start-lang-btn" data-testid="start-lang-btn" style="padding:6px 14px;border:1.5px solid var(--bone);background:rgba(243,240,230,0.12);font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:var(--c1);cursor:pointer;display:inline-flex;align-items:center;gap:6px;">🌐 <span id="start-lang-text">${getLanguage() === 'ko' ? '한국어 / EN' : 'EN / 한국어'}</span></button>
                <span class="lab" id="start-top-right-label">${byoAwaiting ? t('start_top_right') : `${this.escapeHtml(txnsFact?.formatted ?? '1,000')} ${t('start_stat_txns')} · ${this.escapeHtml(yearStr)}`}</span>
              </div>
            </div>
            <div style="position:relative;z-index:2;display:grid;grid-template-columns:1.1fr 0.9fr;gap:32px;align-items:stretch">
              <div id="start-hero-block" data-ax="b" style="background:var(--c1);color:var(--ink);padding:52px 56px;display:flex;flex-direction:column;justify-content:space-between;min-height:510px;box-sizing:border-box;transform-origin:50% 100%">
                <div>
                  <div class="lab" id="start-hero-kicker" style="font-size:13px;letter-spacing:0.12em">${isB2BOrInteractive ? t('start_hero_kicker') : 'AN APP BUILT JUST FOR YOU'}</div>
                  <h1 id="start-hero-title" style="font-size:152px;font-weight:300;letter-spacing:-0.055em;line-height:0.92;margin-top:18px">${heroTitleText}</h1>
                </div>
                <p id="start-hero-copy" style="font-size:24px;line-height:1.35;margin-top:28px;max-width:680px">${
                  byoAwaiting
                    ? t('start_hero_copy')
                    : this.escapeHtml(this.resolveCopy(this.data.plan.one_line))
                }</p>
              </div>
              <div id="start-cta-card" data-ax="b" style="background:var(--c4);color:var(--ink);padding:44px 48px;display:flex;flex-direction:column;justify-content:space-between;min-height:510px;box-sizing:border-box;transform-origin:50% 100%">
                <div>
                  <div class="lab" id="start-cta-kicker" style="font-size:13px;letter-spacing:0.12em">${byoAwaiting ? t('start_cta_kicker') : 'READY TO PLAY · 120 BPM'}</div>
                  <div id="start-stat-box" style="display:${byoAwaiting ? 'none' : 'block'};margin-top:10px;">
                    <div class="lab" id="start-stat-label" style="font-size:12px">${t('start_stat_label')}</div>
                    <div class="num" style="font-size:72px;margin-top:4px"><sup id="start-stat-sup">US</sup><span id="start-spend-val">${this.escapeHtml(spendFact?.formatted ?? '')}</span></div>
                  </div>
                </div>

                <!-- Data Input Section -->
                <div id="byo-studio-panel" data-testid="byo-studio-panel" style="display:flex;flex-direction:column;gap:12px;margin:14px 0;">
                  <div
                    id="byo-file-dropzone"
                    data-testid="byo-file-dropzone"
                    role="button"
                    tabindex="0"
                    style="padding:16px 18px;background:var(--ink);color:var(--bone);border:2px solid var(--ink);font-family:'JetBrains Mono',monospace;cursor:pointer;text-align:center;transition:background-color 0.15s,color 0.15s;"
                  >
                    <div id="byo-dropzone-title" style="font-weight:600;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:var(--c1)">${t('start_dropzone_title')}</div>
                    <div id="byo-dropzone-sub" style="font-size:11px;opacity:0.78;margin-top:4px;letter-spacing:0.03em">${t('start_dropzone_sub')}</div>
                  </div>
                  <input
                    type="file"
                    id="byo-file-input"
                    data-testid="byo-file-input"
                    multiple
                    accept=".xlsx,.xls,.csv,.tsv,.json,.txt,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    style="display:none"
                  />

                  <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:stretch;">
                    <input
                      type="text"
                      id="byo-drive-input"
                      data-testid="byo-drive-input"
                      autocomplete="off"
                      placeholder="${t('start_drive_placeholder')}"
                      style="width:100%;box-sizing:border-box;padding:11px 14px;background:var(--bone);color:var(--ink);border:2px solid var(--ink);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none;"
                    />
                    <button
                      type="button"
                      id="byo-drive-fetch-btn"
                      data-testid="byo-drive-fetch-btn"
                      style="padding:0 16px;background:var(--ink);color:var(--c1);border:2px solid var(--ink);font-family:'JetBrains Mono',monospace;font-size:11.5px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;cursor:pointer;white-space:nowrap;"
                    >
                      ${t('start_drive_import')}
                    </button>
                  </div>

                  <!-- Upload Disclaimer -->
                  <div
                    id="byo-upload-disclaimer"
                    data-testid="byo-upload-disclaimer"
                    style="font-size:10.5px;line-height:1.45;color:rgba(17,17,17,0.88);font-family:'Inter Tight',system-ui,sans-serif;"
                  >
                    <p style="margin:0 0 5px 0;">
                      ${t('start_disclaimer_1')}
                    </p>
                    <p style="margin:0;">
                      ${t('start_disclaimer_2')}
                    </p>
                  </div>

                  <label for="byo-deep-agent-toggle" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(11,13,18,0.55);border:1px solid rgba(244,241,234,0.1);cursor:pointer;user-select:none">
                    <span style="display:flex;align-items:center;gap:8px;font:500 12px/1.3 'Inter',sans-serif;color:rgba(244,241,234,0.88)">
                      <input type="checkbox" id="byo-deep-agent-toggle" data-testid="byo-deep-agent-toggle" style="accent-color:#15803D;width:14px;height:14px;cursor:pointer" />
                      <span id="byo-deep-agent-label">${t('start_deep_agent')}</span>
                    </span>
                    <span id="byo-deep-agent-sub" style="font:500 10px/1.2 'JetBrains Mono',monospace;color:rgba(244,241,234,0.5);letter-spacing:0.04em">${t('start_deep_agent_sub')}</span>
                  </label>

                  <div
                    id="byo-progress-box"
                    data-testid="byo-progress-box"
                    style="display:none;padding:12px 14px;background:var(--ink);color:var(--bone);border:2px solid var(--ink);font-family:'JetBrains Mono',monospace;font-size:11.5px;"
                  >
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                      <span id="byo-progress-label" style="color:var(--c1);font-weight:600;">Processing dataset...</span>
                      <span id="byo-progress-pct">0%</span>
                    </div>
                    <div style="width:100%;height:6px;background:#2A2A29;margin-top:8px;overflow:hidden;">
                      <div id="byo-progress-fill" style="width:0%;height:100%;background:var(--c1);transition:width 0.22s ease-out;"></div>
                    </div>
                    <div id="byo-deep-agent-notice" data-testid="byo-deep-agent-notice" style="display:none;margin-top:10px;padding-top:8px;border-top:1px solid rgba(243,240,230,0.16);flex-direction:column;gap:8px;">
                      <div style="font-size:10.5px;color:rgba(243,240,230,0.82);line-height:1.35;">Deep Agent Audit running in Python sandbox (can take up to 10 minutes)...</div>
                      <button type="button" id="byo-skip-agent-btn" data-testid="byo-skip-agent-btn" style="align-self:flex-start;padding:5px 10px;background:rgba(244,240,58,0.14);color:var(--c1);border:1px solid var(--c1);font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;cursor:pointer;">Skip wait &amp; open fast summary →</button>
                    </div>
                  </div>

                  <div
                    id="byo-status-msg"
                    data-testid="byo-status-msg"
                    style="display:none;padding:9px 12px;background:var(--ink);color:var(--c1);font-family:'JetBrains Mono',monospace;font-size:11.5px;letter-spacing:0.05em;text-transform:uppercase;"
                  ></div>
                </div>

                <button type="button" id="start-open-btn" data-testid="start-open-btn" class="mag" style="width:100%;padding:20px 28px;background:var(--ink);color:var(--bone);font-family:'JetBrains Mono',monospace;font-size:16px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;border:2px solid var(--ink);cursor:pointer;text-align:center;">
                  ${openBtnText} <span class="start-cta-arrow" style="display:inline-block">→</span>
                </button>
              </div>
            </div>
            <div style="height:16px"></div>
          </div>
        </div>
      </div>
    `;

    this.stageWrapEl = this.rootEl.querySelector<HTMLElement>('#stagewrap')!;
    this.stageEl = this.rootEl.querySelector<HTMLElement>('#stage')!;
    this.underLayerEl = this.rootEl.querySelector<HTMLElement>('#under')!;
    this.overLayerEl = this.rootEl.querySelector<HTMLElement>('#over')!;
    this.chromeLayerEl = this.rootEl.querySelector<HTMLElement>('#chrome')!;
    this.startScreenEl = this.rootEl.querySelector<HTMLElement>('#start-screen')!;
    this.chapterHostEl = this.rootEl.querySelector<HTMLElement>('#chapter-host')!;
  }

  private buildAskOverlayDom(): void {
    this.askLayerEl = document.createElement('div');
    this.askLayerEl.className = 'ch';
    this.askLayerEl.id = 'o-ask';
    this.askLayerEl.dataset.testid = 'ask-overlay';
    this.askLayerEl.style.cssText =
      'position:absolute;inset:0;visibility:hidden;pointer-events:none;z-index:20;';

    const sampleQuestions =
      this.data.plan.sample_questions && this.data.plan.sample_questions.length > 0
        ? this.data.plan.sample_questions
        : getLanguage() === 'ko'
          ? ASK_SAMPLE_QUESTIONS_KO
          : ASK_SAMPLE_QUESTIONS;

    const chipsHtml = sampleQuestions
      .map(
        (q) =>
          `<button type="button" class="chip mag" data-ask-q="${this.escapeHtml(q)}" style="cursor:pointer;pointer-events:auto;">${this.escapeHtml(q)}</button>`
      )
      .join('');

    this.askLayerEl.innerHTML = `
      <div class="blk ia" data-ax="l" style="position:absolute;left:64px;top:88px;width:1792px;height:164px;background:var(--bone);color:var(--ink);transform-origin:0 50%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:32px;top:18px;right:220px;display:flex;justify-content:space-between;align-items:center">
          <span id="ask-title-label">${t('ask_title')}</span>
          <button type="button" id="ask-close-btn" data-testid="ask-close-btn" style="font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 10px;border:1.5px solid #111;cursor:pointer;">${t('ask_back')}</button>
        </div>
        <input class="tx ia" id="askin" data-testid="ask-input" autocomplete="off" spellcheck="false" placeholder="${t('ask_placeholder')}" style="position:absolute;left:28px;top:54px;width:1480px;height:90px;font-size:56px;font-weight:300;letter-spacing:-0.03em;color:var(--ink);caret-color:var(--c4);outline:none" />
        <button type="button" class="tx ia mag" id="askgo" data-testid="ask-submit-btn" style="position:absolute;right:0;top:0;width:200px;height:164px;background:var(--ink);color:var(--bone);font-family:'JetBrains Mono',monospace;font-size:15px;letter-spacing:0.14em;cursor:pointer;">${t('ask_btn')}</button>
      </div>
      <div class="tx ia" id="asks" style="position:absolute;left:64px;top:274px;display:flex;gap:10px;flex-wrap:wrap;width:1792px;pointer-events:auto;">${chipsHtml}</div>
      <div class="lab tx" id="ask-ans-lab" style="position:absolute;left:64px;top:358px">${t('ask_answer_label')}</div>
      <div class="later" id="askans" data-testid="ask-answer-value" style="position:absolute;left:52px;top:384px">
        <div class="num" style="font-size:240px" id="asknum"></div>
      </div>
      <div class="later" id="askint" data-testid="ask-answer-interpretation" style="position:absolute;left:64px;top:654px;width:1300px">
        <div style="font-size:32px;letter-spacing:-0.015em;line-height:1.2" id="askintt"></div>
        <div class="lab" style="position:static;font-size:12px;margin-top:10px" id="askmeta"></div>
      </div>
      <div class="blk later ia" data-ax="b" id="askrc" data-testid="ask-receipts-block" style="position:absolute;left:1424px;top:358px;width:432px;height:620px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="tx" id="askrct" style="position:absolute;left:28px;top:24px;right:28px"></div>
      </div>
      ${this.grid.renderAnnotationsHtml(GRID_PRESETS.ask, { legend: false, dows: true })}
    `;

    this.overLayerEl.appendChild(this.askLayerEl);

    const inputEl = this.askLayerEl.querySelector<HTMLInputElement>('#askin')!;
    const submitBtn = this.askLayerEl.querySelector<HTMLButtonElement>('#askgo')!;
    const closeBtn = this.askLayerEl.querySelector<HTMLButtonElement>('#ask-close-btn')!;

    submitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.submitAskQuestion(inputEl.value, submitBtn);
    });

    inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        void this.submitAskQuestion(inputEl.value, submitBtn);
      } else if (e.key === 'Escape') {
        this.closeAsk();
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeAsk();
    });

    this.bindAskSampleChips();
  }

  private bindAskSampleChips(): void {
    const inputEl = this.askLayerEl?.querySelector<HTMLInputElement>('#askin');
    this.askLayerEl?.querySelectorAll<HTMLButtonElement>('[data-ask-q]').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const q = chip.dataset.askQ ?? '';
        if (inputEl) inputEl.value = q;
        void this.submitAskQuestion(q, chip);
      });
    });
  }

  private bindChapterNavButtons(): void {
    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-ch-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.chIndex);
        this.goToChapter(idx);
      });
    });
    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-prog-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.progIndex);
        this.goToChapter(idx);
      });
    });
  }

  private setByoStatusMessage(message: string | null, isError = false): void {
    const msgEl = this.rootEl.querySelector<HTMLElement>('#byo-status-msg');
    if (!msgEl) return;
    if (!message) {
      msgEl.style.display = 'none';
      msgEl.textContent = '';
      return;
    }
    msgEl.style.display = 'block';
    msgEl.style.color = isError ? '#FF6B57' : 'var(--c1)';
    msgEl.textContent = message;
  }

  private formatElapsedMmSs(elapsedMs: number): string {
    const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  private stopByoElapsedTimer(): void {
    if (this.byoElapsedTimer) {
      clearInterval(this.byoElapsedTimer);
      this.byoElapsedTimer = null;
    }
    this.byoDeepAgentActive = false;
    this.deepAgentAbortController = null;
    const noticeEl = this.rootEl.querySelector<HTMLElement>('#byo-deep-agent-notice');
    if (noticeEl) {
      noticeEl.style.display = 'none';
    }
  }

  private updateByoProgress(step: IngestProgressStep | null): void {
    const boxEl = this.rootEl.querySelector<HTMLElement>('#byo-progress-box');
    const labelEl = this.rootEl.querySelector<HTMLElement>('#byo-progress-label');
    const pctEl = this.rootEl.querySelector<HTMLElement>('#byo-progress-pct');
    const fillEl = this.rootEl.querySelector<HTMLElement>('#byo-progress-fill');
    const noticeEl = this.rootEl.querySelector<HTMLElement>('#byo-deep-agent-notice');
    if (!boxEl || !labelEl || !pctEl || !fillEl) return;

    if (!step) {
      boxEl.style.display = 'none';
      if (noticeEl) noticeEl.style.display = 'none';
      return;
    }
    boxEl.style.display = 'block';
    if (noticeEl) {
      noticeEl.style.display = this.byoDeepAgentActive ? 'flex' : 'none';
    }
    labelEl.textContent = step.label;
    const clampedPct = Math.max(0, Math.min(100, Math.round(step.progress_pct)));
    this.byoLastPct = clampedPct;
    if (this.byoDeepAgentActive) {
      const mmSs = this.formatElapsedMmSs(Date.now() - this.byoStartMs);
      pctEl.textContent = `${clampedPct}% · ${mmSs}`;
    } else {
      pctEl.textContent = `${clampedPct}%`;
    }
    fillEl.style.width = `${clampedPct}%`;
  }

  public async handleByoFileUpload(fileList: FileList | File[] | null): Promise<void> {
    if (!fileList || fileList.length === 0 || this.byoBusy) return;
    this.byoBusy = true;
    this.setByoStatusMessage(null);

    try {
      this.updateByoProgress({
        phase: 'parse',
        label: `Reading ${fileList.length} selected file${fileList.length === 1 ? '' : 's'}...`,
        progress_pct: 10,
      });
      const rawFiles = await readBrowserFiles(fileList);
      await this.runByoIngestionFiles(rawFiles);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to ingest uploaded files.';
      this.setByoStatusMessage(message, true);
      this.updateByoProgress(null);
    } finally {
      this.byoBusy = false;
    }
  }

  public async handleByoDriveFetch(): Promise<void> {
    if (this.byoBusy) return;
    const driveInput = this.rootEl.querySelector<HTMLInputElement>('#byo-drive-input');
    const rawUrl = driveInput?.value.trim() ?? '';
    if (!rawUrl) {
      this.setByoStatusMessage(
        'Paste a Google Drive file/folder link or Google Sheets URL first.',
        true
      );
      driveInput?.focus();
      return;
    }

    this.byoBusy = true;
    this.setByoStatusMessage(null);

    try {
      const files = await fetchGoogleDriveInput(rawUrl, undefined, (step) =>
        this.updateByoProgress(step)
      );
      await this.runByoIngestionFiles(files);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch from Google Drive / Sheets.';
      this.setByoStatusMessage(message, true);
      this.updateByoProgress(null);
    } finally {
      this.byoBusy = false;
    }
  }

  private async runByoIngestionFiles(files: RawIngestFile[]): Promise<void> {
    const entityInput = this.rootEl.querySelector<HTMLInputElement>('#byo-entity-input');
    const entityNameHint = entityInput?.value.trim() || undefined;
    const deepAgentAudit = Boolean(
      this.rootEl.querySelector<HTMLInputElement>('#byo-deep-agent-toggle')?.checked
    );

    this.stopByoElapsedTimer();
    this.byoDeepAgentActive = deepAgentAudit;
    this.byoStartMs = Date.now();

    if (deepAgentAudit) {
      this.deepAgentAbortController = new AbortController();
      this.byoElapsedTimer = setInterval(() => {
        const pctEl = this.rootEl.querySelector<HTMLElement>('#byo-progress-pct');
        if (pctEl && this.byoDeepAgentActive) {
          const mmSs = this.formatElapsedMmSs(Date.now() - this.byoStartMs);
          pctEl.textContent = `${this.byoLastPct}% · ${mmSs}`;
        }
      }, 1000);
    }

    try {
      const bundle = await processByoIngestion({
        files,
        entityNameHint,
        deepAgentAudit,
        abortSignal: this.deepAgentAbortController?.signal,
        onProgress: (step) => this.updateByoProgress(step),
      });

      this.loadDataset(bundle, true);
    } finally {
      this.stopByoElapsedTimer();
    }
  }

  /**
   * Hot-swaps the active `DatasetBundle` across the StoryPlayer, 53x7 InteractiveGrid,
   * ReceiptsDrawer, ExploreOverlay, and Ask engine, and optionally starts Chapter 1 (`PourChapter`).
   */
  public loadDataset(bundle: DatasetBundle, autoStart = true): void {
    this.timeline.pause();
    if (this.activeChapterModule) {
      this.activeChapterModule.unmount();
      this.activeChapterModule = null;
    }

    this.data = bundle;
    this.factMap = new Map(bundle.facts.map((f) => [f.id, f]));
    this.byoLoaded = true;
    this.currentChapterIdx = -1;

    const gridAny = this.grid as unknown as {
      setDataset?: (
        days: readonly Day[],
        transactions: readonly Transaction[],
        options?: {
          categoryLabels?: Record<string, string>;
          isB2B?: boolean;
          milestoneLabel?: string;
          currencySymbol?: string;
        }
      ) => void;
      initData?: (days: readonly Day[], transactions: readonly Transaction[]) => void;
      baseColors?: unknown[];
    };

    if (typeof gridAny.setDataset === 'function') {
      gridAny.setDataset(bundle.days, bundle.transactions, {
        categoryLabels: bundle.plan.category_labels,
        isB2B: Boolean(bundle.plan.business_meta),
        milestoneLabel: bundle.plan.business_meta?.milestone_singular ?? 'Settlement',
        currencySymbol: bundle.plan.business_meta?.currency_symbol ?? 'US$',
      });
    } else if (typeof gridAny.initData === 'function') {
      this.grid.days.length = 0;
      this.grid.particles.length = 0;
      this.grid.rings = [];
      this.grid.topDayIndex = 0;
      if (Array.isArray(gridAny.baseColors)) {
        gridAny.baseColors.length = 0;
      }
      gridAny.initData(bundle.days, bundle.transactions);
    }

    this.receiptsDrawer.setTransactions(
      bundle.transactions,
      bundle.plan.business_meta?.currency_symbol
    );
    this.exploreOverlay.setDataset(
      bundle.days,
      bundle.transactions,
      bundle.plan.category_labels,
      Boolean(bundle.plan.business_meta),
      bundle.plan.business_meta?.currency_symbol
    );

    const yearStr =
      this.factMap.get(bundle.plan.year_fact_id)?.formatted ?? String(bundle.plan.year);
    const spendFact = this.factMap.get('total_spend_usd');
    const txnsFact = this.factMap.get('total_transactions_count');
    const bizMeta = bundle.plan.business_meta;

    // Update top bar & chrome HUD labels
    const barTitleEl = this.rootEl.querySelector<HTMLElement>('#bar-brand-title');
    const barSubEl = this.rootEl.querySelector<HTMLElement>('#bar-brand-sub');
    const chromeBrandEl = this.rootEl.querySelector<HTMLElement>('#chrome-brand-label');

    if (barTitleEl) {
      barTitleEl.textContent = `${bundle.plan.person_name} · ${bizMeta?.fiscal_period_label ?? yearStr}`;
    }
    if (barSubEl) {
      barSubEl.textContent = `${bizMeta?.archetype_label ?? 'Finance Story'} · ledger analysis`;
    }
    if (chromeBrandEl) {
      chromeBrandEl.textContent = `${bundle.plan.person_name} · ${bizMeta?.fiscal_period_label ?? yearStr} · Finance Story`;
    }

    // Rebuild chapter nav buttons and progress bar segments
    const chnavEl = this.rootEl.querySelector<HTMLElement>('#chnav');
    if (chnavEl) {
      chnavEl.innerHTML = bundle.plan.chapters
        .map(
          (ch, i) =>
            `<button type="button" data-ch-index="${i}" data-testid="nav-chapter-${i}">${String(i + 1).padStart(2, '0')} ${this.escapeHtml((ch.params.kicker ?? ch.type).replace(/^\d+\s*(?:\/\s*\d+\s*)?·\s*/, ''))}</button>`
        )
        .join('');
    }
    const progEl = this.rootEl.querySelector<HTMLElement>('#prog');
    if (progEl) {
      progEl.innerHTML = bundle.plan.chapters
        .map(
          (ch, i) =>
            `<button type="button" data-prog-index="${i}" aria-label="Jump to ${this.escapeHtml(ch.id)}"><i></i></button>`
        )
        .join('');
    }
    this.bindChapterNavButtons();

    // Update Ask sample question chips
    const asksEl = this.askLayerEl?.querySelector<HTMLElement>('#asks');
    if (asksEl) {
      const dynamicQuestions =
        bundle.plan.sample_questions && bundle.plan.sample_questions.length > 0
          ? bundle.plan.sample_questions
          : this.buildDynamicAskSampleQuestions(bundle);
      asksEl.innerHTML = dynamicQuestions
        .map(
          (q) =>
            `<button type="button" class="chip mag" data-ask-q="${this.escapeHtml(q)}" style="cursor:pointer;pointer-events:auto;">${this.escapeHtml(q)}</button>`
        )
        .join('');
      this.bindAskSampleChips();
    }

    // Update Start Screen copy & stats
    const topLeftEl = this.rootEl.querySelector<HTMLElement>('#start-top-left-label');
    const topRightEl = this.rootEl.querySelector<HTMLElement>('#start-top-right-label');
    const heroKickerEl = this.rootEl.querySelector<HTMLElement>('#start-hero-kicker');
    const heroTitleEl = this.rootEl.querySelector<HTMLElement>('#start-hero-title');
    const heroCopyEl = this.rootEl.querySelector<HTMLElement>('#start-hero-copy');
    const ctaKickerEl = this.rootEl.querySelector<HTMLElement>('#start-cta-kicker');
    const statBoxEl = this.rootEl.querySelector<HTMLElement>('#start-stat-box');
    const statLabelEl = this.rootEl.querySelector<HTMLElement>('#start-stat-label');
    const statSupEl = this.rootEl.querySelector<HTMLElement>('#start-stat-sup');
    const spendValEl = this.rootEl.querySelector<HTMLElement>('#start-spend-val');
    const openBtnEl = this.rootEl.querySelector<HTMLButtonElement>('#start-open-btn');

    if (topLeftEl) {
      topLeftEl.textContent = `${bundle.plan.person_name.toUpperCase()} · ${bizMeta?.archetype_label?.toUpperCase() ?? 'FINANCE STORY'}`;
    }
    if (topRightEl) {
      topRightEl.textContent = `${txnsFact?.formatted ?? String(bundle.transactions.length)} RECORDS · ${bizMeta?.fiscal_period_label ?? yearStr}`;
    }
    if (heroKickerEl) {
      heroKickerEl.textContent = bizMeta
        ? `${bizMeta.entity_name.toUpperCase()} · ${bizMeta.fiscal_period_label}`
        : 'EXECUTIVE INTELLIGENCE';
    }
    if (heroTitleEl) {
      heroTitleEl.textContent = 'Finance Story.';
    }
    if (heroCopyEl) {
      heroCopyEl.textContent = this.resolveCopy(bundle.plan.one_line);
    }
    if (ctaKickerEl) {
      ctaKickerEl.textContent = 'LEDGER ANALYSIS · READY TO PLAY';
    }
    if (statBoxEl) {
      statBoxEl.style.display = 'block';
    }
    if (statLabelEl && bizMeta?.outflow_label) {
      statLabelEl.textContent = bizMeta.outflow_label.toUpperCase();
    }
    const currencySym = bizMeta?.currency_symbol ?? 'US$';
    if (statSupEl) {
      statSupEl.textContent = currencySym === 'US$' ? 'US' : currencySym;
    }
    if (spendValEl) {
      const rawFormatted = spendFact?.formatted ?? '';
      spendValEl.textContent =
        currencySym === 'US$' ? rawFormatted : rawFormatted.replace(/^\$/, '');
    }
    if (openBtnEl) {
      openBtnEl.innerHTML = `Open Finance Story <span class="start-cta-arrow" style="display:inline-block">→</span>`;
    }

    this.rootEl.dataset.ready = 'true';
    this.rootEl.dataset.transactions = String(bundle.transactions.length);
    this.rootEl.dataset.chapters = String(bundle.plan.chapters.length);
    this.rootEl.dataset.person = bundle.plan.person_name;

    this.grid.stepAndDraw(0);
    this.timeline.logEvent('dataset.load', {
      person: bundle.plan.person_name,
      year: bundle.plan.year,
      transactions: bundle.transactions.length,
    });

    if (autoStart) {
      this.startStory();
    }
  }

  private buildDynamicAskSampleQuestions(bundle: DatasetBundle): string[] {
    const topMerchant = this.factMap.get('top_merchant_name')?.formatted;
    const yearStr = String(bundle.plan.year);
    const questions: string[] = [];
    if (topMerchant) {
      questions.push(`How much did we spend at ${topMerchant}?`);
    }
    questions.push(`Show spending by month in ${yearStr}`);
    questions.push(`Show spending by category`);
    questions.push(`What was the biggest single payment?`);
    questions.push(`How much did we spend in Q1?`);
    questions.push(`What are our top vendors?`);
    return questions.slice(0, 6);
  }

  /**
   * Re-opens the Data Source screen on `#start-screen` at any time.
   */
  public openDataIngestion(): void {
    this.timeline.pause();
    this.updatePauseButtonLabel();
    if (this.mode === 'explore') {
      this.exploreOverlay.close();
    }
    if (this.mode === 'ask') {
      gsap.set(this.askLayerEl, { autoAlpha: 0 });
    }
    this.mode = 'start';
    this.byoMode = true;
    const topLeftEl = this.rootEl.querySelector<HTMLElement>('#start-top-left-label');
    const topRightEl = this.rootEl.querySelector<HTMLElement>('#start-top-right-label');
    if (topLeftEl) {
      topLeftEl.textContent = 'FINANCE STORY · INTERACTIVE SUMMARY';
    }
    if (topRightEl) {
      topRightEl.textContent = 'LEDGER ANALYSIS';
    }
    this.updateByoProgress(null);
    this.setByoStatusMessage('Upload a file or paste a Google Drive link to load a new dataset.');
    this.startScreenEl.style.display = 'flex';
    gsap.to(this.startScreenEl, {
      autoAlpha: 1,
      duration: this.timeline.isReducedMotion() ? 0.1 : 0.25,
      ease: 'power2.out',
    });
    const chlEl = this.rootEl.querySelector<HTMLElement>('#chl');
    if (chlEl) {
      chlEl.textContent = 'FINANCE STORY · SOURCE';
    }
  }

  private bindEvents(): void {
    // File Upload & Drag-and-Drop
    const dropzone = this.rootEl.querySelector<HTMLElement>('#byo-file-dropzone');
    const fileInput = this.rootEl.querySelector<HTMLInputElement>('#byo-file-input');
    const driveInput = this.rootEl.querySelector<HTMLInputElement>('#byo-drive-input');
    const driveFetchBtn = this.rootEl.querySelector<HTMLButtonElement>('#byo-drive-fetch-btn');
    const skipAgentBtn = this.rootEl.querySelector<HTMLButtonElement>('#byo-skip-agent-btn');

    skipAgentBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deepAgentAbortController?.abort();
    });

    dropzone?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });
    dropzone?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        fileInput?.click();
      }
    });
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.background = 'var(--c1)';
      dropzone.style.color = 'var(--ink)';
    });
    dropzone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.background = 'var(--ink)';
      dropzone.style.color = 'var(--bone)';
    });
    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.background = 'var(--ink)';
      dropzone.style.color = 'var(--bone)';
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        void this.handleByoFileUpload(e.dataTransfer.files);
      }
    });

    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        void this.handleByoFileUpload(fileInput.files);
      }
    });

    driveFetchBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.handleByoDriveFetch();
    });
    driveInput?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.handleByoDriveFetch();
      }
    });

    // Start Screen button
    const startBtn = this.rootEl.querySelector<HTMLButtonElement>('#start-open-btn');
    startBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.byoMode && !this.byoLoaded) {
        const pendingDriveUrl = driveInput?.value.trim() ?? '';
        if (pendingDriveUrl.length > 0) {
          void this.handleByoDriveFetch();
          return;
        }
        if (fileInput?.files && fileInput.files.length > 0) {
          void this.handleByoFileUpload(fileInput.files);
          return;
        }
        this.setByoStatusMessage(
          'Select an Excel (.xlsx), CSV, JSON, or PDF file or paste a Google Drive link to launch your Finance Story.',
          true
        );
        fileInput?.click();
        return;
      }

      if (
        typeof navigator !== 'undefined' &&
        !navigator.webdriver &&
        typeof document !== 'undefined' &&
        !document.fullscreenElement &&
        typeof document.documentElement?.requestFullscreen === 'function'
      ) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      this.startStory();
    });

    const openCurrentChapterReceipts = (): void => {
      const ch = this.data.plan.chapters[Math.max(0, this.currentChapterIdx)];
      if (ch) {
        this.openReceipts(this.resolveCopy(ch.headline), ch.txn_ids);
      }
    };

    // Top bar controls (kept in DOM for programmatic tests)
    this.rootEl.querySelector('#nav-prev-btn')?.addEventListener('click', () => this.prevChapter());
    this.rootEl.querySelector('#nav-next-btn')?.addEventListener('click', () => this.nextChapter());
    this.rootEl
      .querySelector('#nav-pause-btn')
      ?.addEventListener('click', () => this.togglePause());
    this.rootEl
      .querySelector('#nav-explore-btn')
      ?.addEventListener('click', () => this.openExplore());
    this.rootEl.querySelector('#nav-ask-btn')?.addEventListener('click', () => this.openAsk());
    this.rootEl
      .querySelector('#nav-receipts-btn')
      ?.addEventListener('click', openCurrentChapterReceipts);
    this.rootEl.querySelector('#nav-share-btn')?.addEventListener('click', () => {
      void this.exportShareCard('1080x1350');
    });
    this.rootEl
      .querySelector('#nav-data-btn')
      ?.addEventListener('click', () => this.openDataIngestion());

    // On-stage HUD controls (#stage-hud-nav)
    this.rootEl.querySelector('#hud-prev-btn')?.addEventListener('click', () => this.prevChapter());
    this.rootEl.querySelector('#hud-next-btn')?.addEventListener('click', () => this.nextChapter());
    this.rootEl
      .querySelector('#hud-pause-btn')
      ?.addEventListener('click', () => this.togglePause());
    this.rootEl
      .querySelector('#hud-explore-btn')
      ?.addEventListener('click', () => this.openExplore());
    this.rootEl.querySelector('#hud-ask-btn')?.addEventListener('click', () => this.openAsk());
    this.rootEl
      .querySelector('#hud-receipts-btn')
      ?.addEventListener('click', openCurrentChapterReceipts);
    this.rootEl.querySelector('#hud-share-btn')?.addEventListener('click', () => {
      void this.exportShareCard('1080x1350');
    });
    this.rootEl
      .querySelector('#hud-data-btn')
      ?.addEventListener('click', () => this.openDataIngestion());

    // Language toggle buttons (Korean / English)
    this.rootEl
      .querySelector('#nav-lang-btn')
      ?.addEventListener('click', () => this.toggleLanguage());
    this.rootEl
      .querySelector('#hud-lang-btn')
      ?.addEventListener('click', () => this.toggleLanguage());
    this.rootEl
      .querySelector('#start-lang-btn')
      ?.addEventListener('click', () => this.toggleLanguage());

    const rmInput = this.rootEl.querySelector<HTMLInputElement>('#rmtog');
    rmInput?.addEventListener('change', () => {
      this.setReducedMotion(Boolean(rmInput.checked));
    });

    // Chapter nav buttons & progress bar segments
    this.bindChapterNavButtons();

    // Stage pointer interactions (Explore + Phone gestures)
    let touchStartX = 0;
    let touchStartY = 0;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let heldPause = false;

    const toStageCoords = (e: PointerEvent): [number, number] => {
      const r = this.stageEl.getBoundingClientRect();
      const s = this.stageScale || 1;
      return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
    };

    this.stageEl.addEventListener('pointermove', (e) => {
      if (this.mode === 'explore') {
        const [x, y] = toStageCoords(e);
        this.exploreOverlay.handlePointerMove(x, y);
      }
    });

    this.stageEl.addEventListener('pointerleave', () => {
      if (this.mode === 'explore') {
        this.grid.clearHover();
        this.exploreOverlay.hideTooltip();
      }
    });

    this.stageEl.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, aside')) return;
      const [x, y] = toStageCoords(e);
      if (this.mode === 'explore') {
        this.exploreOverlay.handlePointerDown(x, y);
        return;
      }

      if (this.viewportMode === 'phone' && this.mode === 'story') {
        touchStartX = e.clientX;
        touchStartY = e.clientY;
        heldPause = false;
        holdTimer = setTimeout(() => {
          heldPause = true;
          this.timeline.pause();
          this.updatePauseButtonLabel();
        }, 280);
      }
    });

    this.stageEl.addEventListener('pointerup', (e) => {
      if (this.mode === 'explore') {
        this.exploreOverlay.handlePointerUp();
        return;
      }

      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }

      if (this.viewportMode === 'phone' && this.mode === 'story') {
        if (heldPause) {
          this.timeline.play();
          this.updatePauseButtonLabel();
          return;
        }
        const dy = e.clientY - touchStartY;
        const dx = e.clientX - touchStartX;
        if (dy < -50 && Math.abs(dy) > Math.abs(dx)) {
          this.openExplore();
          return;
        }
        if (Math.abs(dx) < 25 && Math.abs(dy) < 25) {
          const rect = this.stageEl.getBoundingClientRect();
          if (e.clientX - rect.left > rect.width / 2) {
            this.nextChapter();
          } else {
            this.prevChapter();
          }
        }
      }
    });

    // Keyboard navigation
    this.keydownBound = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Escape') {
        if (this.receiptsDrawer.isOpen()) {
          this.receiptsDrawer.close();
        } else if (this.exploreOverlay.flipCard.isOpen()) {
          this.exploreOverlay.flipCard.close();
        } else if (this.mode === 'ask') {
          this.closeAsk();
        } else if (this.mode === 'explore') {
          this.closeExplore();
        } else if (this.mode === 'start' && this.started) {
          this.startStory();
        }
        return;
      }
      if (!this.started && (e.key === 'Enter' || e.key === ' ')) {
        if (this.byoMode && !this.byoLoaded) {
          return;
        }
        e.preventDefault();
        this.startStory();
        return;
      }
      if (e.key === 'ArrowRight') {
        this.nextChapter();
      } else if (e.key === 'ArrowLeft') {
        this.prevChapter();
      } else if (e.key === ' ') {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === 'e' || e.key === 'E') {
        if (this.mode === 'explore') this.closeExplore();
        else this.openExplore();
      } else if (e.key === 'a' || e.key === 'A') {
        if (this.mode === 'ask') this.closeAsk();
        else this.openAsk();
      }
    };
    window.addEventListener('keydown', this.keydownBound);

    this.resizeBound = () => this.fitViewport();
    window.addEventListener('resize', this.resizeBound);

    // GSAP 60fps ticker loop
    this.lastFrameMs = typeof performance !== 'undefined' ? performance.now() : 0;
    this.tickerBound = () => {
      const nowMs =
        typeof performance !== 'undefined' ? performance.now() : this.lastFrameMs + 16.67;
      const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - this.lastFrameMs) / 1000));
      this.lastFrameMs = nowMs;
      if (!this.manualStepping) {
        this.exploreOverlay.step(dtSec);
        this.grid.stepAndDraw(dtSec);
      }
      this.updateChromeHud();
    };
    gsap.ticker.add(this.tickerBound);
  }

  private playStartScreenIntro(): void {
    if (this.timeline.isReducedMotion()) return;
    const heroBlock = this.startScreenEl.querySelector<HTMLElement>('#start-hero-block');
    const heroTitle = this.startScreenEl.querySelector<HTMLElement>('#start-hero-title');
    const heroCopy = this.startScreenEl.querySelector<HTMLElement>('#start-hero-copy');
    const ctaCard = this.startScreenEl.querySelector<HTMLElement>('#start-cta-card');
    const ctaArrow = this.startScreenEl.querySelector<HTMLElement>('.start-cta-arrow');
    const bgTiles = Array.from(
      this.startScreenEl.querySelectorAll<HTMLElement>('#start-bg-grid .start-bg-tile')
    );

    if (bgTiles.length > 0) {
      gsap.fromTo(
        bgTiles,
        { scale: 0 },
        {
          scale: 1,
          duration: 0.45,
          ease: 'back.out(1.4)',
          stagger: 0.02,
        }
      );
      gsap.to(bgTiles, {
        y: -10,
        scale: 1.08,
        duration: MOTION_TOKENS.beat,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        stagger: {
          each: 0.04,
          from: 'random',
        },
      });
    }

    if (heroBlock) {
      gsap.fromTo(heroBlock, { scaleY: 0 }, { scaleY: 1, duration: 0.52, ease: 'back.out(1.25)' });
    }
    if (heroTitle) {
      gsap.fromTo(
        heroTitle,
        { y: 28, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.48, delay: 0.14, ease: 'power3.out' }
      );
    }
    if (heroCopy) {
      gsap.fromTo(
        heroCopy,
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.42, delay: 0.24, ease: 'power3.out' }
      );
    }
    if (ctaCard) {
      gsap.fromTo(
        ctaCard,
        { scaleY: 0 },
        { scaleY: 1, duration: 0.54, delay: 0.1, ease: 'back.out(1.25)' }
      );
    }
    if (ctaArrow) {
      gsap.to(ctaArrow, {
        x: 7,
        duration: MOTION_TOKENS.beat,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    }
  }

  public fitViewport(): void {
    const isFilm = document.body.classList.contains('film');
    const barEl = this.rootEl.querySelector<HTMLElement>('#bar');
    const barH = isFilm || !barEl ? 0 : barEl.offsetHeight;
    const availW = Math.max(320, document.documentElement.clientWidth);
    const availH = Math.max(320, window.innerHeight - barH);

    this.viewportMode = document.documentElement.clientWidth < 768 ? 'phone' : 'desktop';
    const hasNativePhoneStage =
      this.viewportMode === 'phone' &&
      this.started &&
      this.mode === 'story' &&
      Boolean(this.chapterHostEl?.querySelector('[data-viewport="phone"]'));

    this.stageEl.classList.toggle('phone-layout', this.viewportMode === 'phone');
    this.stageWrapEl.classList.toggle('native-phone', hasNativePhoneStage);
    this.stageEl.classList.toggle('native-phone', hasNativePhoneStage);

    const baseW = hasNativePhoneStage ? 390 : 1920;
    const baseH = hasNativePhoneStage ? 844 : 1080;

    this.stageScale = isFilm
      ? Math.min(availW / baseW, availH / baseH)
      : Math.max(0.18, Math.min(availW / baseW, availH / baseH));

    this.stageWrapEl.style.setProperty('--s', String(this.stageScale));
    this.stageEl.style.setProperty('--s', String(this.stageScale));

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const bs = Math.min(2, Math.max(1, this.stageScale * dpr));
    this.grid.backingScale = bs;
    const targetW = Math.round(1920 * bs);
    const targetH = Math.round(1080 * bs);
    if (this.grid.canvas.width !== targetW || this.grid.canvas.height !== targetH) {
      this.grid.canvas.width = targetW;
      this.grid.canvas.height = targetH;
    }
  }

  public startStory(): void {
    if (!this.started) {
      this.started = true;
      this.audioCue.unlock();
      this.timeline.logEvent('start_open', { year: this.data.plan.year });
    }
    gsap.killTweensOf(this.startScreenEl.querySelectorAll('*'));
    if (this.timeline.isReducedMotion()) {
      gsap.set(this.startScreenEl, { autoAlpha: 0 });
      this.startScreenEl.style.display = 'none';
    } else {
      gsap.to(this.startScreenEl, {
        autoAlpha: 0,
        duration: 0.28,
        ease: 'power2.out',
        onComplete: () => {
          this.startScreenEl.style.display = 'none';
        },
      });
    }
    this.goToChapter(0);
  }

  public goToChapter(indexOrId: number | string): void {
    if (!this.started) {
      this.started = true;
      this.audioCue.unlock();
      this.timeline.logEvent('start_open', { year: this.data.plan.year });
      this.startScreenEl.style.display = 'none';
    }

    const chapters = this.data.plan.chapters;
    let targetIdx = 0;
    if (typeof indexOrId === 'number') {
      targetIdx = Math.max(0, Math.min(chapters.length - 1, indexOrId));
    } else {
      const found = chapters.findIndex((c) => c.id === indexOrId || c.type === indexOrId);
      targetIdx = found >= 0 ? found : 0;
    }

    if (this.mode === 'explore') {
      this.exploreOverlay.close();
    }
    if (this.mode === 'ask') {
      gsap.set(this.askLayerEl, { autoAlpha: 0 });
    }

    this.mode = 'story';
    const prevIdx = this.currentChapterIdx;
    this.currentChapterIdx = targetIdx;
    const chapter = chapters[targetIdx]!;

    // Interrupt immediately within 1 frame
    if (this.activeChapterModule) {
      this.activeChapterModule.unmount();
      this.activeChapterModule = null;
    }

    gsap.set(this.chapterHostEl, { autoAlpha: 1 });
    const tl = this.timeline.resetTimeline(chapter.id);
    this.timeline.play(1);
    this.updatePauseButtonLabel();

    const mod = this.resolveChapterModule(chapter);
    this.activeChapterModule = mod;

    const ctx = this.createChapterContext(chapter);
    mod.mount(this.chapterHostEl, ctx);
    this.fitChapterLayout(this.chapterHostEl);
    this.fitViewport();
    mod.play(this.timeline);

    this.timeline.logEvent('chapter.go', {
      from: prevIdx >= 0 ? (chapters[prevIdx]?.id ?? null) : null,
      to: chapter.id,
    });
    this.audioCue.triggerCue(`chapter.${chapter.id}`, Math.round(tl.time() * 1000), 0);
    this.updateNavigationState();
  }

  private fitChapterLayout(stageGroup: HTMLElement): void {
    if (!stageGroup || typeof stageGroup.querySelectorAll !== 'function') return;

    // 1. Auto-Fit .blk .num (and #swtot, #swloudv, #asknum)
    const numElements = new Set<HTMLElement>(
      Array.from(
        stageGroup.querySelectorAll<HTMLElement>(
          '.blk .num, [data-testid="sweep-running-total"], #swtot, #swloudv, #asknum'
        )
      )
    );

    numElements.forEach((el) => {
      const numEl =
        el.id === 'swtot' && el.parentElement?.classList.contains('num') ? el.parentElement : el;
      const blk = numEl.closest<HTMLElement>('.blk');
      const parentWidth = blk
        ? blk.clientWidth || Number.parseFloat(blk.style.width) || 0
        : numEl.id === 'asknum'
          ? 1368
          : 968;
      const availWidth = parentWidth - 48;
      if (availWidth <= 0) return;

      const inlinePx = Number.parseFloat(numEl.style.fontSize);
      const computedPx =
        typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
          ? Number.parseFloat(window.getComputedStyle(numEl).fontSize)
          : NaN;
      let currentPx = !Number.isNaN(inlinePx) && inlinePx > 0 ? inlinePx : computedPx || 64;

      const supText = Array.from(numEl.querySelectorAll('sup'))
        .map((s) => s.textContent ?? '')
        .join('');

      if (numEl.dataset.target !== undefined) {
        const finalStr =
          (numEl.dataset.prefix ?? '') +
          Number(numEl.dataset.target).toLocaleString('en-US') +
          (numEl.dataset.suffix ?? '') +
          supText;
        const estimatedWidth = finalStr.length * 0.56 * currentPx;
        if (estimatedWidth > availWidth) {
          currentPx = Math.max(24, Math.floor(currentPx * (availWidth / estimatedWidth) * 0.94));
          numEl.style.fontSize = `${currentPx}px`;
        }
      } else {
        const odoOrValEl = numEl.querySelector<HTMLElement>('.od, #swtot, #askodo');
        const odoText = odoOrValEl ? (odoOrValEl.dataset.v ?? odoOrValEl.textContent ?? '') : '';
        let siblingText = '';
        if (odoOrValEl && numEl.childNodes && typeof numEl.childNodes.length === 'number') {
          siblingText = Array.from(numEl.childNodes)
            .filter(
              (n) =>
                n !== odoOrValEl &&
                !(n.nodeType === 1 && (n as HTMLElement).tagName?.toUpperCase() === 'SUP') &&
                !(
                  n.nodeType === 1 &&
                  typeof (n as HTMLElement).contains === 'function' &&
                  (n as HTMLElement).contains(odoOrValEl)
                )
            )
            .map((n) => n.textContent ?? '')
            .join('')
            .trim();
        } else if (odoOrValEl) {
          const suffixMatch = /([×%]+)\s*$/.exec(numEl.textContent ?? '');
          if (suffixMatch && !odoText.endsWith(suffixMatch[1]!)) {
            siblingText = suffixMatch[1]!;
          }
        }
        const valText = odoText + siblingText;
        if (valText.length > 0) {
          const estimatedWidth = (valText.length + supText.length * 0.35) * 0.62 * currentPx;
          if (estimatedWidth > availWidth) {
            currentPx = Math.max(24, Math.floor(currentPx * (availWidth / estimatedWidth) * 0.94));
            numEl.style.fontSize = `${currentPx}px`;
          }
        }
      }

      for (let pass = 0; pass < 4; pass++) {
        if (numEl.scrollWidth <= availWidth) break;
        const cur = Number.parseFloat(numEl.style.fontSize) || currentPx;
        if (cur <= 20) break;
        const scaled = Math.max(
          20,
          Math.min(cur - 2, Math.floor(cur * (availWidth / numEl.scrollWidth) * 0.92))
        );
        numEl.style.fontSize = `${scaled}px`;
        currentPx = scaled;
      }
    });

    // 2. Auto-Fit .ch-header-stack Headlines
    const stacks = Array.from(stageGroup.querySelectorAll<HTMLElement>('.ch-header-stack'));
    const headlines = new Set<HTMLElement>(
      Array.from(stageGroup.querySelectorAll<HTMLElement>('[data-testid="chapter-headline"]'))
    );
    stacks.forEach((stack) => {
      const h = stack.querySelector<HTMLElement>('[data-testid="chapter-headline"]');
      if (h) headlines.add(h);
    });

    headlines.forEach((headlineEl) => {
      const stack = headlineEl.closest<HTMLElement>('.ch-header-stack');
      for (let step = 0; step < 5; step++) {
        const inlinePx = Number.parseFloat(headlineEl.style.fontSize);
        const computedStyle =
          typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(headlineEl)
            : null;
        const currentPx =
          !Number.isNaN(inlinePx) && inlinePx > 0
            ? inlinePx
            : Number.parseFloat(computedStyle?.fontSize ?? '88') || 88;
        const rawLh = Number.parseFloat(computedStyle?.lineHeight ?? '');
        const lineHeight = !Number.isNaN(rawLh) && rawLh > 0 ? rawLh : currentPx * 0.98;

        const stackOverflows = Boolean(
          stack && stack.clientHeight > 0 && stack.scrollHeight > stack.clientHeight
        );
        const headlineOverflows = headlineEl.scrollHeight > lineHeight * 2.4;

        if (!stackOverflows && !headlineOverflows) {
          break;
        }
        if (currentPx <= 24) {
          break;
        }
        const nextPx = Math.max(24, Math.floor(currentPx * 0.85));
        headlineEl.style.fontSize = `${nextPx}px`;
        if (nextPx <= 24) break;
      }

      if (stack && stack.clientHeight > 0 && stack.scrollHeight > stack.clientHeight) {
        const bodyEl = stack.querySelector<HTMLElement>('[data-testid="chapter-body"]');
        if (bodyEl) {
          for (let step = 0; step < 3; step++) {
            if (stack.scrollHeight <= stack.clientHeight) break;
            const bodyInlinePx = Number.parseFloat(bodyEl.style.fontSize);
            const bodyComputed =
              typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
                ? window.getComputedStyle(bodyEl)
                : null;
            const bodyPx =
              !Number.isNaN(bodyInlinePx) && bodyInlinePx > 0
                ? bodyInlinePx
                : Number.parseFloat(bodyComputed?.fontSize ?? '16') || 16;
            const nextBodyPx = Math.max(12, Math.floor(bodyPx * 0.88));
            bodyEl.style.fontSize = `${nextBodyPx}px`;
            if (nextBodyPx <= 12) break;
          }
        }
      }
    });
  }

  public nextChapter(): void {
    if (!this.started) {
      this.startStory();
      return;
    }
    if (this.currentChapterIdx < this.data.plan.chapters.length - 1) {
      this.goToChapter(this.currentChapterIdx + 1);
    }
  }

  public prevChapter(): void {
    if (!this.started) return;
    if (this.currentChapterIdx > 0) {
      this.goToChapter(this.currentChapterIdx - 1);
    }
  }

  public togglePause(): void {
    if (this.timeline.isPlaying()) {
      this.timeline.pause();
    } else {
      this.timeline.play();
    }
    this.updatePauseButtonLabel();
  }

  public toggleLanguage(): void {
    toggleLanguage();
    this.applyLanguage();
  }

  public applyLanguage(): void {
    const lang = getLanguage();
    const prevBtn = this.rootEl.querySelector<HTMLElement>('#nav-prev-btn');
    if (prevBtn) prevBtn.textContent = t('nav_prev');
    const pauseBtn = this.rootEl.querySelector<HTMLElement>('#nav-pause-btn');
    if (pauseBtn) pauseBtn.textContent = this.timeline.isPlaying() ? t('nav_pause') : t('nav_play');
    const nextBtn = this.rootEl.querySelector<HTMLElement>('#nav-next-btn');
    if (nextBtn) nextBtn.textContent = t('nav_next');
    const exploreBtn = this.rootEl.querySelector<HTMLElement>('#nav-explore-btn');
    if (exploreBtn) exploreBtn.textContent = t('nav_explore');
    const askBtn = this.rootEl.querySelector<HTMLElement>('#nav-ask-btn');
    if (askBtn) askBtn.textContent = t('nav_ask');
    const receiptsBtn = this.rootEl.querySelector<HTMLElement>('#nav-receipts-btn');
    if (receiptsBtn) receiptsBtn.textContent = t('nav_receipts');
    const shareBtn = this.rootEl.querySelector<HTMLElement>('#nav-share-btn');
    if (shareBtn) shareBtn.textContent = t('nav_share');
    const dataBtn = this.rootEl.querySelector<HTMLElement>('#nav-data-btn');
    if (dataBtn) dataBtn.textContent = t('nav_data');
    const langBtn = this.rootEl.querySelector<HTMLElement>('#nav-lang-btn');
    if (langBtn) langBtn.textContent = lang === 'ko' ? '🌐 한국어 (KO)' : '🌐 English (EN)';
    const rmLabel = this.rootEl.querySelector<HTMLElement>('#label-rmtog');
    if (rmLabel) rmLabel.textContent = t('reduced_motion');

    const hudPrev = this.rootEl.querySelector<HTMLElement>('#hud-prev-btn');
    if (hudPrev) hudPrev.textContent = t('nav_prev');
    const hudPause = this.rootEl.querySelector<HTMLElement>('#hud-pause-btn');
    if (hudPause) hudPause.textContent = this.timeline.isPlaying() ? t('nav_pause') : t('nav_play');
    const hudNext = this.rootEl.querySelector<HTMLElement>('#hud-next-btn');
    if (hudNext) hudNext.textContent = t('nav_next');
    const hudExplore = this.rootEl.querySelector<HTMLElement>('#hud-explore-btn');
    if (hudExplore) hudExplore.textContent = t('nav_explore');
    const hudAsk = this.rootEl.querySelector<HTMLElement>('#hud-ask-btn');
    if (hudAsk) hudAsk.textContent = t('nav_ask');
    const hudReceipts = this.rootEl.querySelector<HTMLElement>('#hud-receipts-btn');
    if (hudReceipts) hudReceipts.textContent = t('nav_receipts');
    const hudShare = this.rootEl.querySelector<HTMLElement>('#hud-share-btn');
    if (hudShare) hudShare.textContent = t('nav_share');
    const hudData = this.rootEl.querySelector<HTMLElement>('#hud-data-btn');
    if (hudData) hudData.textContent = t('nav_data');
    const hudLang = this.rootEl.querySelector<HTMLElement>('#hud-lang-btn');
    if (hudLang) hudLang.textContent = lang === 'ko' ? 'KO' : 'EN';
    const hudHints = this.rootEl.querySelector<HTMLElement>('#hud-hints-label');
    if (hudHints) hudHints.textContent = t('hud_hints');

    const startLangText = this.rootEl.querySelector<HTMLElement>('#start-lang-text');
    if (startLangText) startLangText.textContent = lang === 'ko' ? '한국어 / EN' : 'EN / 한국어';
    const topLeftEl = this.rootEl.querySelector<HTMLElement>('#start-top-left-label');
    if (topLeftEl && (this.byoMode || !this.byoLoaded)) topLeftEl.textContent = t('start_top_left');
    const topRightEl = this.rootEl.querySelector<HTMLElement>('#start-top-right-label');
    if (topRightEl && !this.byoLoaded) topRightEl.textContent = t('start_top_right');
    const heroKickerEl = this.rootEl.querySelector<HTMLElement>('#start-hero-kicker');
    if (heroKickerEl && (this.byoMode || !this.byoLoaded)) heroKickerEl.textContent = t('start_hero_kicker');
    const heroTitleEl = this.rootEl.querySelector<HTMLElement>('#start-hero-title');
    if (heroTitleEl && (this.byoMode || !this.byoLoaded)) heroTitleEl.textContent = t('start_hero_title');
    const heroCopyEl = this.rootEl.querySelector<HTMLElement>('#start-hero-copy');
    if (heroCopyEl && (this.byoMode || !this.byoLoaded)) heroCopyEl.textContent = t('start_hero_copy');
    const ctaKickerEl = this.rootEl.querySelector<HTMLElement>('#start-cta-kicker');
    if (ctaKickerEl && (this.byoMode || !this.byoLoaded)) ctaKickerEl.textContent = t('start_cta_kicker');
    const statLabelEl = this.rootEl.querySelector<HTMLElement>('#start-stat-label');
    if (statLabelEl) statLabelEl.textContent = t('start_stat_label');
    const dropzoneTitle = this.rootEl.querySelector<HTMLElement>('#byo-dropzone-title');
    if (dropzoneTitle) dropzoneTitle.textContent = t('start_dropzone_title');
    const dropzoneSub = this.rootEl.querySelector<HTMLElement>('#byo-dropzone-sub');
    if (dropzoneSub) dropzoneSub.textContent = t('start_dropzone_sub');
    const driveInput = this.rootEl.querySelector<HTMLInputElement>('#byo-drive-input');
    if (driveInput) driveInput.placeholder = t('start_drive_placeholder');
    const driveFetchBtn = this.rootEl.querySelector<HTMLButtonElement>('#byo-drive-fetch-btn');
    if (driveFetchBtn) driveFetchBtn.textContent = t('start_drive_import');
    const deepAgentLabel = this.rootEl.querySelector<HTMLElement>('#byo-deep-agent-label');
    if (deepAgentLabel) deepAgentLabel.textContent = t('start_deep_agent');
    const deepAgentSub = this.rootEl.querySelector<HTMLElement>('#byo-deep-agent-sub');
    if (deepAgentSub) deepAgentSub.textContent = t('start_deep_agent_sub');
    const startOpenBtn = this.rootEl.querySelector<HTMLButtonElement>('#start-open-btn');
    if (startOpenBtn && (this.byoMode || !this.byoLoaded)) {
      startOpenBtn.innerHTML = `${t('start_open_btn')} <span class="start-cta-arrow" style="display:inline-block">→</span>`;
    }

    // Refresh Ask overlay texts
    const askTitle = this.askLayerEl?.querySelector<HTMLElement>('#ask-title-label');
    if (askTitle) askTitle.textContent = t('ask_title');
    const askClose = this.askLayerEl?.querySelector<HTMLElement>('#ask-close-btn');
    if (askClose) askClose.textContent = t('ask_back');
    const askIn = this.askLayerEl?.querySelector<HTMLInputElement>('#askin');
    if (askIn) askIn.placeholder = t('ask_placeholder');
    const askGo = this.askLayerEl?.querySelector<HTMLElement>('#askgo');
    if (askGo) askGo.textContent = t('ask_btn');
    const askAnsLab = this.askLayerEl?.querySelector<HTMLElement>('#ask-ans-lab');
    if (askAnsLab) askAnsLab.textContent = t('ask_answer_label');

    // Refresh Ask sample chips
    const asksEl = this.askLayerEl?.querySelector<HTMLElement>('#asks');
    if (asksEl && (!this.data.plan.sample_questions || this.data.plan.sample_questions.length === 0)) {
      const sampleQuestions = lang === 'ko' ? ASK_SAMPLE_QUESTIONS_KO : ASK_SAMPLE_QUESTIONS;
      asksEl.innerHTML = sampleQuestions
        .map(
          (q) =>
            `<button type="button" class="chip mag" data-ask-q="${this.escapeHtml(q)}" style="cursor:pointer;pointer-events:auto;">${this.escapeHtml(q)}</button>`
        )
        .join('');
      this.bindAskSampleChips();
    }
  }

  private updatePauseButtonLabel(): void {
    const isPlaying = this.timeline.isPlaying();
    const label = isPlaying ? t('nav_pause') : t('nav_play');
    const btn = this.rootEl.querySelector<HTMLButtonElement>('#nav-pause-btn');
    if (btn) {
      btn.textContent = label;
    }
    const hudBtn = this.rootEl.querySelector<HTMLButtonElement>('#hud-pause-btn');
    if (hudBtn) {
      hudBtn.textContent = label;
    }
  }

  public openExplore(initialCategory?: Category): void {
    if (!this.started) {
      this.started = true;
      this.startScreenEl.style.display = 'none';
    }
    if (this.mode === 'ask') {
      gsap.set(this.askLayerEl, { autoAlpha: 0 });
    }
    this.timeline.pause();
    this.updatePauseButtonLabel();
    gsap.set(this.chapterHostEl, { autoAlpha: 0 });
    this.mode = 'explore';
    if (this.stageEl.classList.contains('native-phone')) {
      this.fitViewport();
    }
    this.exploreOverlay.open(initialCategory);
    this.updateNavigationState();
  }

  public closeExplore(): void {
    if (this.mode !== 'explore') return;
    this.exploreOverlay.close();
    this.mode = 'story';
    gsap.set(this.chapterHostEl, { autoAlpha: 1 });
    if (this.currentChapterIdx < 0) {
      this.goToChapter(0);
    } else {
      this.goToChapter(this.currentChapterIdx);
    }
  }

  public openAsk(prefillQuestion?: string): void {
    if (!this.started) {
      this.started = true;
      this.startScreenEl.style.display = 'none';
    }
    if (this.mode === 'explore') {
      this.exploreOverlay.close();
    }
    this.timeline.pause();
    this.updatePauseButtonLabel();
    gsap.set(this.chapterHostEl, { autoAlpha: 0 });
    this.mode = 'ask';
    if (this.stageEl.classList.contains('native-phone')) {
      this.fitViewport();
    }

    this.grid.hideAllParticles();
    this.grid.daysVisible = true;
    this.grid.setGridGeometry(GRID_PRESETS.ask, { dur: 0.45 });
    this.grid.resetToBaseColors();

    gsap.set(this.askLayerEl, { autoAlpha: 1 });
    const tl = this.manualStepping ? this.timeline.resetTimeline('ask') : gsap.timeline();
    enterStageGroup(this.askLayerEl, tl, 0, this.timeline.isReducedMotion());

    const inputEl = this.askLayerEl.querySelector<HTMLInputElement>('#askin');
    if (inputEl) {
      if (prefillQuestion) {
        inputEl.value = prefillQuestion;
        void this.submitAskQuestion(prefillQuestion);
      } else {
        inputEl.focus({ preventScroll: true });
      }
    }
    this.timeline.logEvent('ask.open', prefillQuestion ?? null);
    this.updateNavigationState();
  }

  public closeAsk(): void {
    if (this.mode !== 'ask') return;
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(this.askLayerEl, { autoAlpha: 0 });
      },
    });
    exitStageGroup(this.askLayerEl, tl, 0, this.timeline.isReducedMotion());
    this.mode = 'story';
    gsap.set(this.chapterHostEl, { autoAlpha: 1 });
    if (this.currentChapterIdx < 0) {
      this.goToChapter(0);
    } else {
      this.goToChapter(this.currentChapterIdx);
    }
  }

  public async submitAskQuestion(question: string, sourceEl?: HTMLElement): Promise<void> {
    const q = question.trim();
    if (!q) return;

    let ox = 960;
    let oy = 200;
    if (sourceEl) {
      const r = sourceEl.getBoundingClientRect();
      const sr = this.stageEl.getBoundingClientRect();
      const s = this.stageScale || 1;
      ox = (r.left + r.width / 2 - sr.left) / s;
      oy = (r.top + r.height / 2 - sr.top) / s;
    }

    let result: AskQueryResult;
    if (this.customAskExecutor) {
      const maybePromise = this.customAskExecutor(q);
      result = maybePromise instanceof Promise ? await maybePromise : maybePromise;
    } else {
      result = this.executeBuiltInAskQuery(q);
    }

    this.renderAskResult(result, ox, oy);
  }

  private executeBuiltInAskQuery(question: string): AskQueryResult {
    return answerQuestionDeterministically(question, this.data.transactions);
  }

  public renderAskResult(res: AskQueryResult, ox: number, oy: number): void {
    const ansEl = this.askLayerEl.querySelector<HTMLElement>('#askans')!;
    const numEl = this.askLayerEl.querySelector<HTMLElement>('#asknum')!;
    const intEl = this.askLayerEl.querySelector<HTMLElement>('#askint')!;
    const intTextEl = this.askLayerEl.querySelector<HTMLElement>('#askintt')!;
    const metaEl = this.askLayerEl.querySelector<HTMLElement>('#askmeta')!;
    const rcBlockEl = this.askLayerEl.querySelector<HTMLElement>('#askrc')!;
    const rcContentEl = this.askLayerEl.querySelector<HTMLElement>('#askrct')!;

    if (!res.answerable) {
      numEl.innerHTML = `<span style="font-size:0.48em;letter-spacing:-0.03em">Can’t tell</span>`;
      intTextEl.textContent = res.reason_if_not ?? 'This question cannot be answered from the CSV.';
      const alt = res.suggested_question ?? 'Eating out on weekends';
      metaEl.innerHTML = `Try instead: <button type="button" id="ask-alt-btn" style="text-decoration:underline;cursor:pointer;color:var(--c1);pointer-events:auto;">${this.escapeHtml(alt)}</button>`;
      gsap.fromTo([ansEl, intEl], { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.35 });
      gsap.to(rcBlockEl, { scaleY: 0, duration: 0.25 });
      this.grid.resetToBaseColors();

      this.askLayerEl.querySelector('#ask-alt-btn')?.addEventListener('click', () => {
        const inputEl = this.askLayerEl.querySelector<HTMLInputElement>('#askin');
        if (inputEl) inputEl.value = alt;
        void this.submitAskQuestion(alt);
      });
      this.timeline.logEvent('ask.unanswerable', res.question);
      return;
    }

    const matchDateSet = new Set(res.matching_dates);
    const catColor = res.query.filters.categories[0]
      ? hexToRgb(CATEGORY_COLORS[res.query.filters.categories[0]] ?? '#F4F03A')
      : RGB_PALETTE.c1;

    this.grid.applyHighlightDatesWave(matchDateSet, catColor, ox, oy);

    const isMoney = res.formatted_answer.startsWith('$');
    const cleanVal = res.formatted_answer.replace(/^\$/, '');
    const askCurrencySup = this.escapeHtml(this.data.plan.business_meta?.currency_symbol ?? 'US$');
    numEl.style.fontSize = '240px';
    numEl.innerHTML = `${isMoney ? `<sup>${askCurrencySup}</sup>` : ''}<span id="askodo" data-v="${this.escapeHtml(cleanVal)}">${this.escapeHtml(cleanVal)}</span>${!isMoney ? `<sup class="aft">${this.escapeHtml(res.unit_label)}</sup>` : ''}`;
    const odoEl = numEl.querySelector<HTMLElement>('#askodo')!;
    const odo = new Odometer(odoEl, cleanVal);
    this.fitChapterLayout(this.askLayerEl);

    intTextEl.textContent = res.interpretation;
    metaEl.textContent = `${res.matching_txn_ids.length} purchase${res.matching_txn_ids.length === 1 ? '' : 's'} on ${matchDateSet.size} day${matchDateSet.size === 1 ? '' : 's'} · computed deterministically by code`;

    const topRows = res.receipts
      .slice()
      .sort((a, b) => b.amount_minor - a.amount_minor)
      .slice(0, 11);

    rcContentEl.innerHTML = `
      <div class="lab" style="position:static;display:flex;justify-content:space-between;align-items:center">
        <span>RECEIPTS (${res.matching_txn_ids.length})</span>
        <button type="button" id="ask-open-drawer-btn" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;background:#111;color:#F3F0E6;cursor:pointer;">Full Drawer →</button>
      </div>
      <div style="margin-top:14px">
        ${topRows
          .map(
            (t) =>
              `<div class="rc ar" style="font:500 14px/1 'JetBrains Mono',monospace;display:flex;gap:8px;padding:7px 0;align-items:baseline;">
                <span>${this.escapeHtml(t.date.slice(5))}</span>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px">${this.escapeHtml(t.merchant)}</span>
                <span class="ld" style="flex:1;border-bottom:1.5px dotted currentColor;opacity:0.45"></span>
                <span>${formatMoneyMinor(t.amount_minor, { showCents: true, prefix: '' })}</span>
              </div>`
          )
          .join('')}
      </div>
    `;

    rcContentEl.querySelector('#ask-open-drawer-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openReceipts(`Ask: "${res.question}"`, res.matching_txn_ids);
    });

    const tl = this.manualStepping ? this.timeline.gsapTimeline : gsap.timeline();
    const baseAt = this.manualStepping ? 0.25 : 0;
    tl.fromTo(
      rcBlockEl,
      { scaleY: 0, autoAlpha: 1 },
      { scaleY: 1, duration: MOTION_TOKENS.tr.blockIn, ease: EASE.soft },
      baseAt
    );
    tl.set(ansEl, { autoAlpha: 1, y: 0 }, baseAt + 0.15);
    if (this.manualStepping) {
      odo.roll({ tl, at: baseAt + 0.15, reducedMotion: this.timeline.isReducedMotion() });
    } else {
      tl.call(
        () => odo.roll({ reducedMotion: this.timeline.isReducedMotion() }),
        [],
        baseAt + 0.15
      );
    }
    tl.fromTo(
      intEl,
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: MOTION_TOKENS.tr.textIn, ease: 'power3.out' },
      baseAt + 0.35
    );

    this.timeline.logEvent('ask.answer', {
      question: res.question,
      formatted: res.formatted_answer,
      days: matchDateSet.size,
    });
  }

  public openReceipts(title: string, txnIds: readonly string[]): void {
    this.receiptsDrawer.open(title, txnIds);
  }

  public async exportShareCard(size: ShareCardSize = '1080x1350'): Promise<string> {
    const ch =
      this.currentChapterIdx >= 0 ? this.data.plan.chapters[this.currentChapterIdx] : undefined;
    const dataUrl = await ShareExporter.downloadShareCard({
      size,
      plan: this.data.plan,
      facts: this.factMap,
      days: this.data.days,
      resolveCopy: (tpl) => this.resolveCopy(tpl),
      chapter: ch,
    });
    this.timeline.logEvent('share.export', size);
    return dataUrl;
  }

  public setReducedMotion(enabled: boolean): void {
    this.timeline.setReducedMotion(enabled);
    this.grid.reducedMotion = enabled;
    this.receiptsDrawer.reducedMotion = enabled;
    this.exploreOverlay.flipCard.reducedMotion = enabled;
    const rmInput = this.rootEl.querySelector<HTMLInputElement>('#rmtog');
    if (rmInput) rmInput.checked = enabled;
    if (this.started && this.mode === 'story' && this.currentChapterIdx >= 0) {
      this.goToChapter(this.currentChapterIdx);
    }
  }

  public setFakeCursor(x: number, y: number, clicking = false): void {
    const fcur = this.stageEl.querySelector<HTMLElement>('#fcur');
    const fclick = this.stageEl.querySelector<HTMLElement>('#fclick');
    if (fcur) {
      gsap.set(fcur, { autoAlpha: 1, x: x - 4, y: y - 3 });
    }
    if (clicking && fclick) {
      gsap.fromTo(
        fclick,
        { x, y, scale: 0.3, autoAlpha: 0.9 },
        { scale: 1, autoAlpha: 0, duration: 0.42, ease: 'power2.out' }
      );
    }
    if (this.mode === 'explore') {
      this.exploreOverlay.handlePointerMove(x, y);
    }
  }

  private resolveChapterModule(chapter: Chapter): ChapterModule {
    if (chapter.bespoke_module && this.customChapterRegistry.has(chapter.bespoke_module)) {
      return this.customChapterRegistry.get(chapter.bespoke_module)!();
    }
    if (this.customChapterRegistry.has(chapter.id)) {
      return this.customChapterRegistry.get(chapter.id)!();
    }
    return createCoreChapterModule(chapter.type);
  }

  private createChapterContext(chapter: Chapter): ExtendedChapterContext {
    const palette = DEFAULT_PALETTES[chapter.palette_id] ?? DEFAULT_PALETTES.ink_solar!;
    const allowedSet = new Set(chapter.txn_ids);
    const chapterTxns = this.data.transactions.filter((t) => allowedSet.has(t.id));

    return {
      chapter,
      plan: this.data.plan,
      palette,
      facts: this.factMap,
      days: this.data.days,
      transactions: chapterTxns,
      allTransactions: this.data.transactions,
      resolveCopy: (tpl) => this.resolveCopy(tpl),
      getFact: (fid) => this.getFact(fid),
      openReceipts: (title, ids) => this.openReceipts(title, ids),
      openExplore: (cat) => this.openExplore(cat),
      openAsk: (q) => this.openAsk(q),
      exportShareCard: (size) => this.exportShareCard(size),
      viewport: this.viewportMode,
      reducedMotion: this.timeline.isReducedMotion(),
      grid: this.grid,
      onReplayStory: () => this.goToChapter(0),
    };
  }

  private updateNavigationState(): void {
    const total = this.data.plan.chapters.length;
    const cur = Math.max(0, this.currentChapterIdx);
    const ch = this.data.plan.chapters[cur];

    const chlEl = this.rootEl.querySelector<HTMLElement>('#chl');
    if (chlEl) {
      if (this.mode === 'explore') {
        chlEl.textContent = 'EXPLORE MODE · 365 DAYS';
      } else if (this.mode === 'ask') {
        chlEl.textContent = 'ASK YOUR YEAR · QUERY DSL';
      } else if (ch) {
        const badge =
          !this.data.plan.business_meta && ch.params.badge
            ? ` · [${ch.params.badge.toUpperCase()}]`
            : '';
        const kickerClean = (ch.params.kicker ?? ch.type).replace(
          /^\d+\s*(?:\/\s*\d+\s*)?·\s*/,
          ''
        );
        chlEl.textContent = `${String(cur + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')} · ${kickerClean.toUpperCase()}${badge}`;
      }
    }

    this.rootEl.querySelectorAll<HTMLButtonElement>('[data-ch-index]').forEach((btn) => {
      const idx = Number(btn.dataset.chIndex);
      btn.setAttribute(
        'aria-current',
        this.mode === 'story' && idx === this.currentChapterIdx ? 'true' : 'false'
      );
    });
  }

  private updateChromeHud(): void {
    const progSegments = Array.from(this.rootEl.querySelectorAll<HTMLElement>('#prog button i'));
    const p = this.timeline.progress();
    progSegments.forEach((el, k) => {
      const scale = k < this.currentChapterIdx ? 1 : k === this.currentChapterIdx ? p : 0;
      el.style.transform = `scaleX(${scale.toFixed(3)})`;
    });

    const beat = Math.floor(this.grid.clockSec / MOTION_TOKENS.beat);
    const beatEl = this.rootEl.querySelector<HTMLElement>('#beatn');
    const dotEl = this.rootEl.querySelector<HTMLElement>('#beatdot');
    if (beatEl) {
      beatEl.textContent = String(beat % 1000).padStart(3, '0');
    }
    if (dotEl) {
      dotEl.style.opacity = beat % 2 === 0 ? '1' : '0.35';
    }
  }

  public getState(): {
    started: boolean;
    chapterIndex: number;
    chapterId: string | null;
    mode: 'start' | 'story' | 'explore' | 'ask';
    reducedMotion: boolean;
    paused: boolean;
  } {
    const ch = this.currentChapterIdx >= 0 ? this.data.plan.chapters[this.currentChapterIdx] : null;
    return {
      started: this.started,
      chapterIndex: this.currentChapterIdx,
      chapterId: ch?.id ?? null,
      mode: this.mode,
      reducedMotion: this.timeline.isReducedMotion(),
      paused: !this.timeline.isPlaying(),
    };
  }

  public getMotionEvents(): readonly MotionEvent[] {
    return this.timeline.getEvents();
  }

  public destroy(): void {
    this.stopByoElapsedTimer();
    if (this.tickerBound) {
      gsap.ticker.remove(this.tickerBound);
      this.tickerBound = null;
    }
    if (this.resizeBound) {
      window.removeEventListener('resize', this.resizeBound);
      this.resizeBound = null;
    }
    if (this.keydownBound) {
      window.removeEventListener('keydown', this.keydownBound);
      this.keydownBound = null;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
