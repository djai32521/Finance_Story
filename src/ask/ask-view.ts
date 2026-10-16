/**
 * Interactive "Ask Your Year" View Component (`src/ask/ask-view.ts`)
 *
 * Implements Section 3.3 & Section 4 ("Ask your year"):
 * - Text input + preset question chips
 * - Structured no-key fallback chip builder (Category, Merchant, Month, Measure)
 * - Giant odometer answer slam with Inter Tight Light display numerals & JetBrains Mono superscripts
 * - Plain-English interpretation + unanswerable reason + clickable suggested question
 * - 53×7 matching day grid highlight wave (via InteractiveGrid callback + built-in SVG grid)
 * - Traceable receipts list & drawer trigger
 *
 * All motion durations, springs, and staggers come exclusively from `src/design/motion.ts`.
 */

import gsap from 'gsap';
import { formatMoneyMinor, type Category, type Transaction } from '../../contracts/data.js';
import type {
  AskQueryDSL,
  AskQueryResult,
  QueryGroupBy,
  QueryMeasure,
} from '../../contracts/query.js';
import { isReducedMotion, MOTION_TOKENS, SOFT, SPR } from '../design/motion.js';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CORE_COLORS,
  hexToRgb,
  type RGBTuple,
} from '../design/palette.js';
import { executeAskQuery, getIsoWeekday, MONTH_LABELS_SHORT } from './executor.js';
import {
  buildQueryFromSelection,
  MONTH_NAMES_SHORT,
  parseQuestionToDSL,
  type StructuredBuilderSelection,
} from './nl-parser.js';

export const PRESET_QUESTIONS: readonly string[] = [
  'How much did I spend on takeaway in November?',
  'How many times did I visit Blue Bottle Coffee?',
  'How much did I spend on eating out on weekends?',
  'What was my biggest single purchase?',
  'What was my average coffee spend?',
  'How much did I spend after 10pm?',
] as const;

export const BUILDER_CATEGORIES: readonly Category[] = [
  'coffee',
  'takeaway',
  'eating out',
  'groceries',
  'shopping',
  'transport',
  'travel',
  'bills',
  'subscriptions',
  'health',
  'fun',
  'fees',
  'savings',
  'income',
] as const;

export const BUILDER_MERCHANTS: readonly string[] = [
  'Blue Bottle Coffee',
  "Trader Joe's",
  'Uber Eats',
  'B&H Photo',
  'Monarch Acoustic',
  'Sightglass Coffee',
  'Shell',
  'Brightpath',
  'Northgate Brewing',
  'Adobe',
] as const;

export interface AskViewOptions {
  transactions: readonly Transaction[];
  initialQuestion?: string;
  /** Optional callback to highlight matching dates on the stage 53×7 canvas grid */
  onHighlightDates?: (
    matchingDates: ReadonlySet<string>,
    highlightRgb: RGBTuple,
    originX: number,
    originY: number
  ) => void;
  /** Optional callback to reset the stage 53×7 canvas grid to base colors */
  onResetGrid?: () => void;
  /** Optional callback to open the full receipts drawer for a claim */
  onOpenReceipts?: (title: string, txnIds: string[]) => void;
  /** Optional callback when a motion event is logged */
  onMotionEvent?: (type: string, value?: number | string | Record<string, unknown> | null) => void;
  /** Optional API endpoint URL (defaults to `/api/ask` when `preferServer` is true) */
  apiEndpoint?: string;
  /** Whether to also query `/api/ask` in the background when a server is running */
  preferServer?: boolean;
}

const DIGIT_STRIP_HTML = Array.from({ length: 30 }, (_, i) => `<i>${i % 10}</i>`).join('');

/**
 * Lightweight deterministic odometer roller for the giant Ask answer number,
 * driven entirely by `MOTION_TOKENS` from `src/design/motion.ts`.
 */
class AskOdometer {
  private digitTrackEls: Array<{
    wrap: HTMLElement;
    strip: HTMLElement;
    pos: number;
  }> = [];

  constructor(
    private readonly container: HTMLElement,
    templateStr: string
  ) {
    this.container.classList.add('odo');
    this.build(templateStr);
  }

  private build(templateStr: string): void {
    this.container.innerHTML = '';
    this.digitTrackEls = [];

    for (const ch of templateStr) {
      if (/\d/.test(ch)) {
        const wrap = document.createElement('span');
        wrap.className = 'dg';
        wrap.style.display = 'inline-block';
        wrap.style.height = '1em';
        wrap.style.overflow = 'hidden';

        const strip = document.createElement('span');
        strip.className = 'st';
        strip.style.display = 'block';
        strip.style.willChange = 'transform';
        strip.innerHTML = DIGIT_STRIP_HTML;
        for (const iEl of Array.from(strip.querySelectorAll('i'))) {
          const el = iEl as HTMLElement;
          el.style.display = 'block';
          el.style.height = '1em';
          el.style.lineHeight = '1em';
          el.style.fontStyle = 'normal';
          el.style.textAlign = 'center';
        }
        wrap.appendChild(strip);
        this.container.appendChild(wrap);
        this.digitTrackEls.push({ wrap, strip, pos: 0 });
      } else {
        const sep = document.createElement('span');
        sep.className = 'sp';
        sep.style.display = 'inline-block';
        sep.style.height = '1em';
        sep.style.lineHeight = '1em';
        sep.textContent = ch;
        this.container.appendChild(sep);
      }
    }
  }

  private applyTransform(index: number): void {
    const item = this.digitTrackEls[index];
    if (!item) return;
    item.strip.style.transform = `translate3d(0, ${(-item.pos).toFixed(4)}em, 0)`;
  }

  public rollTo(targetDigitsStr: string): void {
    const cleanDigits = targetDigitsStr.replace(/\D/g, '');
    const padded = cleanDigits
      .padStart(this.digitTrackEls.length, '0')
      .slice(-this.digitTrackEls.length);

    if (isReducedMotion()) {
      this.digitTrackEls.forEach((item, k) => {
        gsap.killTweensOf(item);
        item.pos = Number(padded[k] ?? 0);
        this.applyTransform(k);
      });
      return;
    }

    this.digitTrackEls.forEach((item, k) => {
      const targetDigit = Number(padded[k] ?? 0);
      gsap.killTweensOf(item);
      item.pos = 0;
      this.applyTransform(k);
      gsap.to(item, {
        pos: targetDigit + 10,
        duration: MOTION_TOKENS.tr.blockIn + MOTION_TOKENS.dur.xs,
        delay: k * MOTION_TOKENS.tr.textStagger,
        ease: 'power4.out',
        onUpdate: () => this.applyTransform(k),
        onComplete: () => {
          item.pos = targetDigit;
          this.applyTransform(k);
        },
      });
    });
  }
}

export class AskView {
  private rootEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private builderDrawerEl: HTMLElement | null = null;
  private answerBlockEl: HTMLElement | null = null;
  private answerNumEl: HTMLElement | null = null;
  private interpWrapEl: HTMLElement | null = null;
  private interpTextEl: HTMLElement | null = null;
  private metaTextEl: HTMLElement | null = null;
  private breakdownEl: HTMLElement | null = null;
  private receiptsBlockEl: HTMLElement | null = null;
  private receiptsContentEl: HTMLElement | null = null;
  private miniGridEl: SVGSVGElement | null = null;
  private activeTimeline: gsap.core.Timeline | null = null;
  private lastResult: AskQueryResult | null = null;
  private builderOpen = false;

  private builderSelection: StructuredBuilderSelection = {
    category: '',
    merchant: '',
    month: null,
    weekdayMode: 'all',
    measure: 'sum',
    group_by: 'none',
  };

  constructor(private readonly options: AskViewOptions) {}

  public mount(container: HTMLElement): void {
    this.rootEl = container;
    this.renderShell();
    if (this.options.initialQuestion) {
      this.setQuestion(this.options.initialQuestion);
      this.askQuestion(this.options.initialQuestion);
    }
  }

  public unmount(): void {
    if (this.activeTimeline) {
      this.activeTimeline.kill();
      this.activeTimeline = null;
    }
    if (this.rootEl) {
      this.rootEl.innerHTML = '';
      this.rootEl = null;
    }
  }

  public getLastResult(): AskQueryResult | null {
    return this.lastResult;
  }

  public setQuestion(question: string): void {
    if (this.inputEl) {
      this.inputEl.value = question;
    }
  }

  public focusInput(): void {
    if (this.inputEl) {
      this.inputEl.focus({ preventScroll: true });
    }
  }

  /**
   * Execute a plain-English question synchronously against the loaded transactions,
   * immediately updating the UI and grid highlights within a single frame.
   */
  public askQuestion(questionText: string, triggerEl?: HTMLElement | null): AskQueryResult {
    const q = questionText.trim();
    if (this.inputEl && this.inputEl.value !== q) {
      this.inputEl.value = q;
    }
    const dsl = parseQuestionToDSL(q, this.options.transactions);
    const result = executeAskQuery(dsl, this.options.transactions, {
      question: q,
      source: 'deterministic',
    });
    this.presentResult(result, triggerEl);

    if (this.options.preferServer && q.length > 0) {
      void this.upgradeFromServerIfAvailable(q, triggerEl);
    }
    return result;
  }

  /**
   * Execute a pre-constructed `AskQueryDSL` directly (e.g. from the structured chip builder).
   */
  public runDSL(
    dsl: AskQueryDSL,
    questionLabel?: string,
    source: 'model' | 'deterministic' | 'builder' = 'builder',
    triggerEl?: HTMLElement | null
  ): AskQueryResult {
    const q = questionLabel ?? dsl.interpretation;
    if (this.inputEl) {
      this.inputEl.value = q;
    }
    const result = executeAskQuery(dsl, this.options.transactions, {
      question: q,
      source,
    });
    this.presentResult(result, triggerEl);
    return result;
  }

  private async upgradeFromServerIfAvailable(
    question: string,
    triggerEl?: HTMLElement | null
  ): Promise<void> {
    const endpoint = this.options.apiEndpoint ?? 'api/ask';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        query?: AskQueryDSL;
        source?: 'model' | 'deterministic' | 'builder';
      };
      if (payload.query && payload.source === 'model') {
        const modelResult = executeAskQuery(payload.query, this.options.transactions, {
          question,
          source: 'model',
        });
        if (
          this.lastResult &&
          this.lastResult.question === question &&
          this.lastResult.formatted_answer !== modelResult.formatted_answer
        ) {
          this.presentResult(modelResult, triggerEl);
        }
      }
    } catch {
      // Offline or no local server running — deterministic result is already displayed.
    }
  }

  private renderShell(): void {
    if (!this.rootEl) return;

    this.rootEl.innerHTML = `
      <div class="ask-view-stage" data-testid="ask-view" style="position:relative;width:100%;height:100%;color:${CORE_COLORS.bone};font-family:'Inter Tight',system-ui,sans-serif;user-select:none;">
        <!-- Top Input Bar Block -->
        <div class="blk" data-ax="l" style="position:absolute;left:64px;top:88px;width:1792px;height:156px;background:${CORE_COLORS.bone};color:${CORE_COLORS.ink};overflow:hidden;">
          <div class="lab tx" style="position:absolute;left:32px;top:18px;font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;display:flex;gap:16px;align-items:center;">
            <span>07 · ASK YOUR YEAR</span>
            <span style="opacity:0.65;">DETERMINISTIC DSL · NUMBERS FROM CODE</span>
          </div>
          <input
            class="tx ia"
            id="askin"
            data-testid="ask-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="Ask your year anything…"
            aria-label="Ask your year anything"
            style="position:absolute;left:28px;top:50px;width:1360px;height:88px;font-size:54px;font-weight:300;letter-spacing:-0.03em;color:${CORE_COLORS.ink};caret-color:${CORE_COLORS.ember};background:transparent;border:0;outline:none;"
          />
          <button
            type="button"
            class="tx ia"
            id="ask-builder-toggle"
            data-testid="ask-builder-toggle"
            aria-expanded="false"
            style="position:absolute;right:204px;top:0;width:184px;height:156px;background:${CORE_COLORS.paper};color:${CORE_COLORS.ink};border-left:1.5px solid ${CORE_COLORS.ink};font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;"
          >
            QUERY BUILDER ▾
          </button>
          <button
            type="button"
            class="tx ia mag"
            id="askgo"
            data-testid="ask-submit"
            style="position:absolute;right:0;top:0;width:204px;height:156px;background:${CORE_COLORS.ink};color:${CORE_COLORS.bone};font-family:'JetBrains Mono',monospace;font-size:15px;letter-spacing:0.14em;text-transform:uppercase;cursor:pointer;border:0;"
          >
            ASK ↵
          </button>
        </div>

        <!-- Preset Sample Chips -->
        <div
          class="tx ia"
          id="asks"
          data-testid="ask-presets"
          style="position:absolute;left:64px;top:262px;display:flex;gap:10px;flex-wrap:wrap;width:1792px;"
        >
          ${PRESET_QUESTIONS.map(
            (q) =>
              `<button type="button" class="chip mag" data-testid="ask-preset-chip" data-q="${q.replace(/"/g, '&quot;')}" style="display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border:1.5px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;">${q}</button>`
          ).join('')}
        </div>

        <!-- Structured Fallback Query Builder Panel (Category, Merchant, Month, Measure) -->
        <div
          id="ask-builder-drawer"
          data-testid="ask-builder"
          style="position:absolute;left:64px;top:314px;width:1330px;background:${CORE_COLORS.ink};border:1.5px solid ${CORE_COLORS.bone};padding:16px 20px;z-index:12;display:none;"
        >
          <div style="display:grid;grid-template-columns:110px 1fr;gap:10px 14px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">
            <span style="color:${CORE_COLORS.solar};">CATEGORY</span>
            <div data-builder-group="category" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" data-builder-cat="" aria-pressed="true" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:${CORE_COLORS.bone};color:${CORE_COLORS.ink};cursor:pointer;">ALL</button>
              ${BUILDER_CATEGORIES.map(
                (c) =>
                  `<button type="button" data-builder-cat="${c}" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">${(CATEGORY_LABELS[c] ?? c).toUpperCase()}</button>`
              ).join('')}
            </div>

            <span style="color:${CORE_COLORS.rose};">MERCHANT</span>
            <div data-builder-group="merchant" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" data-builder-mer="" aria-pressed="true" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:${CORE_COLORS.bone};color:${CORE_COLORS.ink};cursor:pointer;">ANY</button>
              ${BUILDER_MERCHANTS.map(
                (m) =>
                  `<button type="button" data-builder-mer="${m}" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">${m.toUpperCase()}</button>`
              ).join('')}
            </div>

            <span style="color:${CORE_COLORS.mint};">MONTH / DAY</span>
            <div data-builder-group="month" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" data-builder-mon="all" aria-pressed="true" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:${CORE_COLORS.bone};color:${CORE_COLORS.ink};cursor:pointer;">ALL 2025</button>
              ${MONTH_NAMES_SHORT.map(
                (m, idx) =>
                  `<button type="button" data-builder-mon="${idx}" aria-pressed="false" style="padding:5px 8px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">${m.toUpperCase()}</button>`
              ).join('')}
              <button type="button" data-builder-wk="weekends" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.ember};background:transparent;color:${CORE_COLORS.ember};cursor:pointer;">WEEKENDS</button>
            </div>

            <span style="color:${CORE_COLORS.lavender};">MEASURE</span>
            <div data-builder-group="measure" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" data-builder-meas="sum" data-builder-grp="none" aria-pressed="true" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:${CORE_COLORS.bone};color:${CORE_COLORS.ink};cursor:pointer;">TOTAL ($)</button>
              <button type="button" data-builder-meas="count" data-builder-grp="none" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">COUNT / VISITS</button>
              <button type="button" data-builder-meas="average" data-builder-grp="none" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">AVERAGE ($)</button>
              <button type="button" data-builder-meas="max" data-builder-grp="none" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">BIGGEST ($)</button>
              <button type="button" data-builder-meas="min" data-builder-grp="none" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">SMALLEST ($)</button>
              <button type="button" data-builder-meas="sum" data-builder-grp="month" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">BY MONTH</button>
              <button type="button" data-builder-meas="sum" data-builder-grp="weekday" aria-pressed="false" style="padding:5px 9px;border:1px solid ${CORE_COLORS.bone};background:transparent;color:${CORE_COLORS.bone};cursor:pointer;">BY WEEKDAY</button>
            </div>
          </div>
        </div>

        <!-- Answer Kicker -->
        <div class="lab tx" style="position:absolute;left:64px;top:340px;font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:${CORE_COLORS.mutedTextOnInk};">
          ANSWER
        </div>

        <!-- Giant Answer Slam -->
        <div
          class="later"
          id="askans"
          data-testid="ask-answer-block"
          style="position:absolute;left:56px;top:366px;max-width:1340px;"
        >
          <div
            class="num"
            id="asknum"
            data-testid="ask-answer"
            style="font-size:240px;font-weight:300;letter-spacing:-0.045em;line-height:0.95;display:flex;align-items:flex-start;font-feature-settings:'tnum';"
          ></div>
        </div>

        <!-- Plain-English Interpretation & Breakdown Strip -->
        <div
          class="later"
          id="askint"
          data-testid="ask-interpretation-block"
          style="position:absolute;left:64px;top:636px;width:1320px;"
        >
          <div
            id="askintt"
            data-testid="ask-interpretation"
            style="font-size:32px;font-weight:300;letter-spacing:-0.015em;line-height:1.22;color:${CORE_COLORS.bone};"
          ></div>
          <div
            class="lab"
            id="askmeta"
            data-testid="ask-meta"
            style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;margin-top:8px;color:${CORE_COLORS.mutedTextOnInk};"
          ></div>
          <div
            id="askbreakdown"
            data-testid="ask-breakdown"
            style="margin-top:12px;display:flex;gap:8px;align-items:flex-end;height:58px;"
          ></div>
        </div>

        <!-- 53x7 Matching Days Mini-Grid (always visible at bottom of Ask view) -->
        <div
          id="ask-grid-wrap"
          style="position:absolute;left:112px;top:790px;width:1260px;height:210px;"
        >
          <div class="lab" style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${CORE_COLORS.mutedTextOnInk};margin-bottom:8px;">
            MATCHING DAYS IN 2025 · 53 WEEKS × 7 DAYS (MON AT TOP)
          </div>
          <svg
            id="ask-mini-grid"
            data-testid="ask-mini-grid"
            width="1220"
            height="164"
            viewBox="0 0 1220 164"
            style="display:block;overflow:visible;"
          ></svg>
        </div>

        <!-- Right-hand Receipts Flat Block -->
        <div
          class="blk later"
          data-ax="b"
          id="askrc"
          data-testid="ask-receipts"
          style="position:absolute;left:1424px;top:340px;width:432px;height:668px;background:${CORE_COLORS.solar};color:${CORE_COLORS.ink};transform-origin:50% 100%;overflow:hidden;"
        >
          <div
            class="tx"
            id="askrct"
            style="position:absolute;left:28px;top:24px;right:28px;bottom:24px;display:flex;flex-direction:column;"
          ></div>
        </div>
      </div>
    `;

    this.inputEl = this.rootEl.querySelector<HTMLInputElement>('#askin');
    this.builderDrawerEl = this.rootEl.querySelector<HTMLElement>('#ask-builder-drawer');
    this.answerBlockEl = this.rootEl.querySelector<HTMLElement>('#askans');
    this.answerNumEl = this.rootEl.querySelector<HTMLElement>('#asknum');
    this.interpWrapEl = this.rootEl.querySelector<HTMLElement>('#askint');
    this.interpTextEl = this.rootEl.querySelector<HTMLElement>('#askintt');
    this.metaTextEl = this.rootEl.querySelector<HTMLElement>('#askmeta');
    this.breakdownEl = this.rootEl.querySelector<HTMLElement>('#askbreakdown');
    this.receiptsBlockEl = this.rootEl.querySelector<HTMLElement>('#askrc');
    this.receiptsContentEl = this.rootEl.querySelector<HTMLElement>('#askrct');
    this.miniGridEl = this.rootEl.querySelector<SVGSVGElement>('#ask-mini-grid');

    this.renderMiniGrid(new Set(), CORE_COLORS.solar);
    this.bindEvents();
  }

  private renderMiniGrid(matchingDates: ReadonlySet<string>, highlightHex: string): void {
    if (!this.miniGridEl) return;

    const pitch = 22;
    const cellSize = 18;
    const startDate = new Date('2025-01-01T00:00:00Z');
    const firstWeekday = 2; // 2025-01-01 is Wednesday (0 = Mon)

    let svgHtml = '';
    const seenMonths = new Set<number>();

    for (let d = 0; d < 365; d++) {
      const cur = new Date(startDate.getTime() + d * 86400000);
      const isoDate = cur.toISOString().slice(0, 10);
      const month = cur.getUTCMonth();
      const col = Math.floor((d + firstWeekday) / 7);
      const row = (d + firstWeekday) % 7;
      const x = 24 + col * pitch;
      const y = 18 + row * pitch;

      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        svgHtml += `<text x="${x}" y="11" fill="${CORE_COLORS.mutedTextOnInk}" font-family="JetBrains Mono, monospace" font-size="10">${MONTH_LABELS_SHORT[month]?.toUpperCase() ?? ''}</text>`;
      }

      const isMatch = matchingDates.has(isoDate);
      const fill = isMatch
        ? highlightHex
        : matchingDates.size > 0
          ? CORE_COLORS.dimCell
          : CORE_COLORS.quietCell;

      svgHtml += `<rect data-date="${isoDate}" data-matched="${isMatch ? 'true' : 'false'}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${fill}" />`;
    }

    'MTWTFSS'.split('').forEach((ch, row) => {
      const y = 18 + row * pitch + 13;
      svgHtml += `<text x="2" y="${y}" fill="${CORE_COLORS.mutedTextOnInk}" font-family="JetBrains Mono, monospace" font-size="10">${ch}</text>`;
    });

    this.miniGridEl.innerHTML = svgHtml;
  }

  private bindEvents(): void {
    if (!this.rootEl) return;

    const askBtn = this.rootEl.querySelector<HTMLButtonElement>('#askgo');
    askBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const q = this.inputEl?.value ?? '';
      if (q.trim().length > 0) {
        this.askQuestion(q, askBtn);
      }
    });

    this.inputEl?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const q = this.inputEl?.value ?? '';
        if (q.trim().length > 0) {
          this.askQuestion(q, askBtn);
        }
      }
    });

    // Preset chips
    const presetButtons = Array.from(this.rootEl.querySelectorAll<HTMLButtonElement>('[data-q]'));
    for (const btn of presetButtons) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const q = btn.dataset.q ?? '';
        if (q) {
          this.askQuestion(q, btn);
        }
      });
    }

    // Builder toggle
    const builderToggle = this.rootEl.querySelector<HTMLButtonElement>('#ask-builder-toggle');
    builderToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.builderOpen = !this.builderOpen;
      builderToggle.setAttribute('aria-expanded', String(this.builderOpen));
      builderToggle.textContent = this.builderOpen ? 'QUERY BUILDER ▴' : 'QUERY BUILDER ▾';
      if (this.builderDrawerEl) {
        this.builderDrawerEl.style.display = this.builderOpen ? 'block' : 'none';
      }
    });

    // Builder chip interactions
    const catBtns = Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-cat]')
    );
    for (const btn of catBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cat = (btn.dataset.builderCat ?? '') as Category | '';
        this.builderSelection.category = cat;
        if (cat) {
          this.builderSelection.merchant = '';
        }
        this.syncBuilderChipStyles();
        this.triggerBuilderQuery(btn);
      });
    }

    const merBtns = Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-mer]')
    );
    for (const btn of merBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mer = btn.dataset.builderMer ?? '';
        this.builderSelection.merchant = mer;
        if (mer) {
          this.builderSelection.category = '';
        }
        this.syncBuilderChipStyles();
        this.triggerBuilderQuery(btn);
      });
    }

    const monBtns = Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-mon]')
    );
    for (const btn of monBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rawMon = btn.dataset.builderMon ?? 'all';
        this.builderSelection.month = rawMon === 'all' ? null : Number(rawMon);
        this.syncBuilderChipStyles();
        this.triggerBuilderQuery(btn);
      });
    }

    const wkBtns = Array.from(this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-wk]'));
    for (const btn of wkBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.builderSelection.weekdayMode =
          this.builderSelection.weekdayMode === 'weekends' ? 'all' : 'weekends';
        this.syncBuilderChipStyles();
        this.triggerBuilderQuery(btn);
      });
    }

    const measBtns = Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-meas]')
    );
    for (const btn of measBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.builderSelection.measure = (btn.dataset.builderMeas ?? 'sum') as QueryMeasure;
        this.builderSelection.group_by = (btn.dataset.builderGrp ?? 'none') as QueryGroupBy;
        this.syncBuilderChipStyles();
        this.triggerBuilderQuery(btn);
      });
    }
  }

  private syncBuilderChipStyles(): void {
    if (!this.rootEl) return;

    const styleChip = (btn: HTMLButtonElement, active: boolean, accentHex?: string) => {
      btn.setAttribute('aria-pressed', String(active));
      const baseColor = accentHex ?? CORE_COLORS.bone;
      btn.style.background = active ? baseColor : 'transparent';
      btn.style.color = active ? CORE_COLORS.ink : baseColor;
    };

    for (const btn of Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-cat]')
    )) {
      styleChip(btn, (btn.dataset.builderCat ?? '') === (this.builderSelection.category ?? ''));
    }

    for (const btn of Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-mer]')
    )) {
      styleChip(btn, (btn.dataset.builderMer ?? '') === (this.builderSelection.merchant ?? ''));
    }

    for (const btn of Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-mon]')
    )) {
      const val = btn.dataset.builderMon ?? 'all';
      const active =
        val === 'all'
          ? this.builderSelection.month === null
          : Number(val) === this.builderSelection.month;
      styleChip(btn, active);
    }

    for (const btn of Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-wk]')
    )) {
      styleChip(btn, this.builderSelection.weekdayMode === 'weekends', CORE_COLORS.ember);
    }

    for (const btn of Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('[data-builder-meas]')
    )) {
      const active =
        btn.dataset.builderMeas === this.builderSelection.measure &&
        (btn.dataset.builderGrp ?? 'none') === (this.builderSelection.group_by ?? 'none');
      styleChip(btn, active);
    }
  }

  private triggerBuilderQuery(triggerEl: HTMLElement): void {
    const { question, query } = buildQueryFromSelection(this.builderSelection);
    this.runDSL(query, question, 'builder', triggerEl);
  }

  private presentResult(result: AskQueryResult, _triggerEl?: HTMLElement | null): void {
    this.lastResult = result;
    this.options.onMotionEvent?.('ask.query', {
      question: result.question,
      answerable: result.answerable,
      measure: result.query.measure,
      value_minor: result.value_minor,
    });

    if (this.activeTimeline) {
      this.activeTimeline.kill();
      this.activeTimeline = null;
    }

    const ansEl = this.answerBlockEl;
    const numEl = this.answerNumEl;
    const intWrapEl = this.interpWrapEl;
    const intTextEl = this.interpTextEl;
    const metaEl = this.metaTextEl;
    const breakdownEl = this.breakdownEl;
    const rcBlockEl = this.receiptsBlockEl;
    const rcContentEl = this.receiptsContentEl;

    if (
      !ansEl ||
      !numEl ||
      !intWrapEl ||
      !intTextEl ||
      !metaEl ||
      !breakdownEl ||
      !rcBlockEl ||
      !rcContentEl
    ) {
      return;
    }

    // 1. Handle unanswerable query (e.g. time-of-day filter)
    if (!result.answerable) {
      numEl.innerHTML = `<span style="font-size:0.46em;letter-spacing:-0.03em;color:${CORE_COLORS.coral};">Can’t tell</span>`;
      intTextEl.textContent =
        result.reason_if_not ??
        'This data has dates but no times, so it cannot be split by time of day.';

      const suggested =
        result.suggested_question ?? 'How much did I spend on eating out on weekends?';
      metaEl.innerHTML = `TRY INSTEAD: <button type="button" id="askalt" data-testid="ask-suggested-question" style="background:transparent;border:0;color:${CORE_COLORS.solar};font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.1em;text-decoration:underline;cursor:pointer;text-transform:uppercase;">${suggested}</button>`;
      breakdownEl.innerHTML = '';
      rcContentEl.innerHTML = '';

      const altBtn = metaEl.querySelector<HTMLButtonElement>('#askalt');
      altBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.askQuestion(suggested, altBtn);
      });

      this.renderMiniGrid(new Set(), CORE_COLORS.solar);
      this.options.onResetGrid?.();

      const tl = gsap.timeline();
      this.activeTimeline = tl;
      if (isReducedMotion()) {
        tl.set([ansEl, intWrapEl], { autoAlpha: 1, y: 0 });
        tl.set(rcBlockEl, { scaleY: 0, autoAlpha: 0 });
      } else {
        tl.fromTo(
          [ansEl, intWrapEl],
          { autoAlpha: 0, y: 16 },
          {
            autoAlpha: 1,
            y: 0,
            duration: MOTION_TOKENS.tr.textIn,
            stagger: MOTION_TOKENS.tr.textStagger,
            ease: SPR,
          }
        );
        tl.to(rcBlockEl, { scaleY: 0, duration: MOTION_TOKENS.tr.blockOut, ease: 'power3.in' }, 0);
      }
      return;
    }

    // 2. Answerable query: determine highlight color & update 53×7 grid
    const primaryCat = result.query.filters.categories[0] ?? result.receipts[0]?.category;
    const highlightHex = primaryCat
      ? (CATEGORY_COLORS[primaryCat] ?? CORE_COLORS.solar)
      : CORE_COLORS.solar;
    const highlightRgb = hexToRgb(highlightHex);
    const matchingDatesSet = new Set(result.matching_dates);

    this.renderMiniGrid(matchingDatesSet, highlightHex);
    this.options.onHighlightDates?.(matchingDatesSet, highlightRgb, 960, 240);

    // 3. Build giant answer numeral + odometer
    const isMoneyMeasure = result.query.measure !== 'count' && result.query.measure !== 'list';
    const rawNumberPart = result.formatted_answer.replace(/^\$/, '');
    const templateDigits = rawNumberPart.replace(/\d/g, '0');

    numEl.innerHTML = `
      ${isMoneyMeasure ? `<sup style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:500;letter-spacing:0.06em;line-height:1;margin:0.32em 0.16em 0 0;">US$</sup>` : ''}
      <span id="askodo" data-testid="ask-odometer">${rawNumberPart}</span>
      ${!isMoneyMeasure ? `<sup class="aft" style="font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:500;letter-spacing:0.06em;line-height:1;margin:0.34em 0 0 0.14em;">${result.unit_label}</sup>` : ''}
    `;

    const odoSpan = numEl.querySelector<HTMLElement>('#askodo');
    const odo = odoSpan ? new AskOdometer(odoSpan, templateDigits) : null;

    // 4. Plain-English interpretation & metadata
    intTextEl.textContent = result.interpretation;
    const txnCount = result.receipts.length;
    const dayCount = matchingDatesSet.size;
    metaEl.textContent = `${txnCount} ${txnCount === 1 ? 'PURCHASE' : 'PURCHASES'} ON ${dayCount} ${dayCount === 1 ? 'DAY' : 'DAYS'} · COUNTED BY CODE, NOT GUESSED`;

    // 5. Render breakdown buckets if group_by !== 'none'
    if (result.breakdown.length > 0) {
      const topBuckets = result.breakdown.slice(0, 12);
      const maxVal = Math.max(1, ...topBuckets.map((b) => b.value_minor));
      breakdownEl.innerHTML = topBuckets
        .map((b) => {
          const barH = Math.max(4, Math.round((b.value_minor / maxVal) * 34));
          return `
            <div style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:46px;">
              <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:${CORE_COLORS.bone};">${b.formatted_value}</span>
              <div style="width:28px;height:${barH}px;background:${highlightHex};"></div>
              <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:${CORE_COLORS.mutedTextOnInk};text-transform:uppercase;">${b.label.slice(0, 6)}</span>
            </div>
          `;
        })
        .join('');
    } else {
      breakdownEl.innerHTML = '';
    }

    // 6. Render Receipts list in right-hand flat block
    const topRows = result.receipts.slice(0, 12);
    rcContentEl.innerHTML = `
      <div class="lab" style="font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;">
        <span>RECEIPTS</span>
        <span>${txnCount}</span>
      </div>
      <div style="margin-top:14px;flex:1;overflow:hidden;">
        ${
          topRows.length === 0
            ? `<div style="font-family:'JetBrains Mono',monospace;font-size:13px;opacity:0.75;margin-top:12px;">No matching transactions.</div>`
            : topRows
                .map((t) => {
                  const mIdx = Number(t.date.slice(5, 7)) - 1;
                  const dom = Number(t.date.slice(8, 10));
                  const dateShort = `${String(dom).padStart(2, '0')} ${MONTH_LABELS_SHORT[mIdx]?.toUpperCase() ?? ''}`;
                  const catSw = CATEGORY_COLORS[t.category] ?? CORE_COLORS.ink;
                  const amtStr = formatMoneyMinor(t.amount_minor, {
                    showCents: true,
                    prefix: '$',
                  });
                  return `
                    <div class="rc ar" data-testid="ask-receipt-row" data-txn-id="${t.id}" style="font-family:'JetBrains Mono',monospace;font-size:14px;line-height:1;display:flex;gap:8px;padding:7px 0;align-items:baseline;">
                      <i style="width:9px;height:9px;background:${catSw};outline:1px solid ${CORE_COLORS.ink};display:inline-block;flex:none;"></i>
                      <span style="opacity:0.75;">${dateShort}</span>
                      <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;">${t.merchant}</span>
                      <span style="flex:1;border-bottom:1.5px dotted currentColor;opacity:0.4;transform:translateY(-3px);"></span>
                      <span style="font-weight:600;">${amtStr}</span>
                    </div>
                  `;
                })
                .join('')
        }
        ${
          txnCount > 12
            ? `<div class="rc ar" style="font-family:'JetBrains Mono',monospace;font-size:12px;opacity:0.75;padding-top:6px;">+ ${txnCount - 12} MORE MATCHING RECEIPTS</div>`
            : ''
        }
      </div>
      ${
        txnCount > 0
          ? `<button type="button" id="ask-open-receipts" data-testid="ask-open-receipts" style="margin-top:12px;width:100%;padding:11px 14px;background:${CORE_COLORS.ink};color:${CORE_COLORS.bone};border:0;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;">VIEW ALL RECEIPTS (${txnCount}) →</button>`
          : ''
      }
    `;

    const openReceiptsBtn = rcContentEl.querySelector<HTMLButtonElement>('#ask-open-receipts');
    openReceiptsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.options.onOpenReceipts?.(result.interpretation, result.matching_txn_ids);
    });

    // 7. Calm staged transition using MOTION_TOKENS
    const tl = gsap.timeline();
    this.activeTimeline = tl;

    if (isReducedMotion()) {
      tl.set(rcBlockEl, { scaleY: 1, autoAlpha: 1 });
      tl.set([ansEl, intWrapEl, rcContentEl], { autoAlpha: 1, y: 0 });
      odo?.rollTo(rawNumberPart);
    } else {
      tl.fromTo(
        rcBlockEl,
        { scaleY: 0, autoAlpha: 1 },
        {
          scaleY: 1,
          duration: MOTION_TOKENS.tr.blockIn,
          ease: SOFT,
        },
        0
      );
      tl.set(ansEl, { autoAlpha: 1, y: 0 }, MOTION_TOKENS.dur.s);
      tl.call(
        () => {
          odo?.rollTo(rawNumberPart);
        },
        [],
        MOTION_TOKENS.dur.s
      );
      tl.fromTo(
        intWrapEl,
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1,
          y: 0,
          duration: MOTION_TOKENS.tr.textIn,
          ease: SPR,
        },
        MOTION_TOKENS.tr.blockIn * 0.85
      );
      const receiptRows = Array.from(rcContentEl.querySelectorAll<HTMLElement>('.ar'));
      if (receiptRows.length > 0) {
        tl.fromTo(
          receiptRows,
          { autoAlpha: 0, y: 10 },
          {
            autoAlpha: 1,
            y: 0,
            duration: MOTION_TOKENS.tr.detailIn,
            stagger: MOTION_TOKENS.st.letter,
            ease: 'power3.out',
          },
          MOTION_TOKENS.tr.blockIn * 0.9
        );
      }
    }

    this.options.onMotionEvent?.('ask.answer', {
      formatted_answer: result.formatted_answer,
      value_minor: result.value_minor,
      matching_days: dayCount,
      matching_txns: txnCount,
    });
  }
}

export function mountAskView(container: HTMLElement, options: AskViewOptions): AskView {
  const view = new AskView(options);
  view.mount(container);
  return view;
}

export { getIsoWeekday };
