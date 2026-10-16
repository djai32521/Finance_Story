import fs from 'node:fs';
import path from 'node:path';
import gsap from 'gsap';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  Chapter,
  Day,
  Fact,
  PaletteTheme,
  StoryPlan,
  Transaction,
} from '../contracts/index.js';
import { buildMockDataset } from '../data/mock/index.js';
import {
  BESPOKE_CHAPTER_REGISTRY,
  CoffeeChapter,
  GenericBespokeChapter,
  StudioChapter,
  createCoffeeChapter,
  createGenericBespokeChapter,
  createStudioChapter,
  registerBespokeChapters,
  resolveBespokeChapterModule,
} from '../src/chapters/bespoke/index.js';
import type { ExtendedChapterContext } from '../src/chapters/core/pour-chapter.js';
import type { DayVisual, InteractiveGrid } from '../src/grid/interactive-grid.js';
import {
  PlayerTimelineController,
  resolveCopyTemplate,
} from '../src/player/timeline-controller.js';

/**
 * Lightweight DOM element implementation for Node Vitest environment
 * supporting innerHTML parsing, querySelectorAll, dataset, classList, Odometer, and GSAP.
 */
class LiteElement {
  public tagName: string;
  public id = '';
  private _className = '';
  public style: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public attributes = new Map<string, string>();
  public children: LiteElement[] = [];
  public parentElement: LiteElement | null = null;
  public autoAlpha = 1;
  public scaleX = 1;
  public scaleY = 1;
  public x = 0;
  public y = 0;
  public yPercent = 0;
  public transformOrigin = '50% 50%';
  private _rawHtml = '';
  private _text = '';
  private listeners = new Map<string, Array<(e: { stopPropagation: () => void }) => void>>();

  public readonly classList = {
    add: (...tokens: string[]) => {
      const set = new Set(this.classListArray());
      tokens.forEach((t) => set.add(t));
      this._className = Array.from(set).join(' ');
    },
    remove: (...tokens: string[]) => {
      const set = new Set(this.classListArray());
      tokens.forEach((t) => set.delete(t));
      this._className = Array.from(set).join(' ');
    },
    contains: (token: string) => this.classListArray().includes(token),
    toggle: (token: string, force?: boolean) => {
      const has = this.classListArray().includes(token);
      const next = force ?? !has;
      if (next) this.classList.add(token);
      else this.classList.remove(token);
      return next;
    },
  };

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  public get className(): string {
    return this._className;
  }

  public set className(val: string) {
    this._className = val;
  }

  private classListArray(): string[] {
    return this._className.split(/\s+/).filter(Boolean);
  }

  public get firstElementChild(): LiteElement | null {
    return this.children[0] ?? null;
  }

  public get lastElementChild(): LiteElement | null {
    return this.children[this.children.length - 1] ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
    else if (name === 'class') this._className = value;
    else if (name === 'style') this.parseStyleString(value);
    else if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
      this.dataset[camel] = value;
    }
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  private parseStyleString(css: string): void {
    css.split(';').forEach((part) => {
      const idx = part.indexOf(':');
      if (idx > 0) {
        const k = part
          .slice(0, idx)
          .trim()
          .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        const v = part.slice(idx + 1).trim();
        this.style[k] = v;
      }
    });
  }

  public get innerHTML(): string {
    if (this._rawHtml) return this._rawHtml;
    if (this.children.length > 0) {
      return this.children.map((c) => c.outerHTML).join('');
    }
    return this._text;
  }

  public set innerHTML(html: string) {
    this._rawHtml = html;
    this._text = html.replace(/<[^>]+>/g, '');
    this.children = [];
    if (html.trim().length > 0) {
      parseHtmlInto(this, html);
    }
  }

  public get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const cls = this._className ? ` class="${this._className}"` : '';
    const idAttr = this.id ? ` id="${this.id}"` : '';
    return `<${tag}${idAttr}${cls}>${this.innerHTML}</${tag}>`;
  }

  public get textContent(): string {
    if (this.children.length > 0 && !this._rawHtml) {
      return this.children.map((c) => c.textContent).join('');
    }
    return this._text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ');
  }

  public set textContent(txt: string) {
    this._text = txt;
    this._rawHtml = txt;
    this.children = [];
  }

  public appendChild(child: LiteElement): LiteElement {
    this._rawHtml = '';
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public addEventListener(
    type: string,
    handler: (e: { stopPropagation: () => void }) => void
  ): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(handler);
    this.listeners.set(type, arr);
  }

  public click(): void {
    const arr = this.listeners.get('click') ?? [];
    const ev = { stopPropagation: () => {} };
    arr.forEach((fn) => fn(ev));
  }

  public closest(selector: string): LiteElement | null {
    if (matchesSimpleSelector(this, selector)) return this;
    let cur = this.parentElement;
    while (cur) {
      if (matchesSimpleSelector(cur, selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  public querySelector<T = LiteElement>(selector: string): T | null {
    return (this.querySelectorAll<T>(selector)[0] ?? null) as T | null;
  }

  public querySelectorAll<T = LiteElement>(selector: string): T[] {
    const groups = selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const out: LiteElement[] = [];
    const visit = (node: LiteElement) => {
      for (const child of node.children) {
        if (groups.some((g) => matchesSimpleSelector(child, g))) {
          out.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return out as unknown as T[];
  }
}

function matchesSingleToken(el: LiteElement, token: string): boolean {
  if (!token) return false;
  let rest = token;
  let notToken: string | null = null;
  const notMatch = rest.match(/:not\(([^)]+)\)/);
  if (notMatch) {
    notToken = notMatch[1]!;
    rest = rest.replace(notMatch[0], '');
  }
  if (notToken && matchesSingleToken(el, notToken)) {
    return false;
  }

  const attrRegex = /\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]+)["']?)?\]/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(rest)) !== null) {
    const attrName = m[1]!;
    const attrVal = m[2];
    const actual = el.getAttribute(attrName);
    if (actual === null) return false;
    if (attrVal !== undefined && actual !== attrVal) return false;
  }
  const withoutAttrs = rest.replace(attrRegex, '');
  if (!withoutAttrs) return true;

  if (withoutAttrs.startsWith('#')) {
    return el.id === withoutAttrs.slice(1);
  }
  if (withoutAttrs.startsWith('.')) {
    const classes = withoutAttrs.slice(1).split('.');
    return classes.every((c) => el.classList.contains(c));
  }
  if (withoutAttrs.includes('.')) {
    const [tagPart, ...clsParts] = withoutAttrs.split('.');
    if (tagPart && el.tagName.toLowerCase() !== tagPart.toLowerCase()) return false;
    return clsParts.every((c) => el.classList.contains(c));
  }
  return el.tagName.toLowerCase() === withoutAttrs.toLowerCase();
}

function matchesSimpleSelector(el: LiteElement, selector: string): boolean {
  const parts = selector.trim().split(/\s+/);
  if (parts.length === 1) {
    return matchesSingleToken(el, parts[0]!);
  }
  if (!matchesSingleToken(el, parts[parts.length - 1]!)) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    const target = parts[i]!;
    while (cur && !matchesSingleToken(cur, target)) {
      cur = cur.parentElement;
    }
    if (!cur) return false;
    cur = cur.parentElement;
  }
  return true;
}

function parseAttributes(el: LiteElement, attrStr: string): void {
  const re = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const name = m[1]!;
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    el.setAttribute(name, val);
  }
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'path', 'line', 'circle', 'rect']);

function parseHtmlInto(root: LiteElement, html: string): void {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  const stack: LiteElement[] = [root];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const isClosing = full.startsWith('</');
    const tagName = m[1]!;
    const attrStr = m[2] ?? '';
    const isSelfClosing =
      m[3] === '/' || VOID_TAGS.has(tagName.toLowerCase()) || attrStr.trim().endsWith('/');

    const parent = stack[stack.length - 1] ?? root;
    const textBefore = html.slice(lastIndex, m.index);
    if (textBefore && stack.length > 1) {
      parent.setAttribute('_text', (parent.getAttribute('_text') ?? '') + textBefore);
    }

    if (!isClosing) {
      const el = new LiteElement(tagName);
      parseAttributes(el, attrStr);
      el.parentElement = parent;
      parent.children.push(el);
      if (!isSelfClosing) {
        stack.push(el);
      } else {
        (el as unknown as { _rawHtml: string })._rawHtml = '';
      }
    } else {
      if (stack.length > 1) {
        const closed = stack.pop()!;
        const innerStart = (closed as unknown as { _innerStart?: number })._innerStart;
        if (innerStart !== undefined) {
          const slice = html.slice(innerStart, m.index);
          (closed as unknown as { _rawHtml: string })._rawHtml = slice;
          (closed as unknown as { _text: string })._text = slice.replace(/<[^>]+>/g, '');
        }
      }
    }

    if (!isClosing && !isSelfClosing) {
      const top = stack[stack.length - 1];
      if (top) {
        (top as unknown as { _innerStart?: number })._innerStart = tagRe.lastIndex;
      }
    }

    lastIndex = tagRe.lastIndex;
  }
}

beforeAll(() => {
  gsap.config({ nullTargetWarn: false });
  if (typeof globalThis.document === 'undefined') {
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new LiteElement(tag),
    };
  }
});

const DEFAULT_PALETTE: PaletteTheme = {
  id: 'solar_ember',
  name: 'Solar Ember',
  bg: '#111111',
  fg: '#F3F0E6',
  accent: '#F4F03A',
  secondary: '#FF5A14',
  muted: '#8E8A7F',
  blocks: {
    primary: { bg: '#F4F03A', fg: '#111111' },
    secondary: { bg: '#FF5A14', fg: '#111111' },
    tertiary: { bg: '#FFA8E4', fg: '#111111' },
    quaternary: { bg: '#A9A2E0', fg: '#111111' },
  },
};

function loadRealFactsAndData(): {
  facts: Fact[];
  days: Day[];
  transactions: Transaction[];
  plan: StoryPlan;
} {
  const mock = buildMockDataset();
  const rootDir = path.resolve(import.meta.dirname, '..');
  const factsPath = path.join(rootDir, 'data', 'facts.json');
  const daysPath = path.join(rootDir, 'data', 'days.json');
  const txnsPath = path.join(rootDir, 'data', 'transactions.json');

  const facts = fs.existsSync(factsPath)
    ? (JSON.parse(fs.readFileSync(factsPath, 'utf8')) as Fact[])
    : mock.facts;
  const days = fs.existsSync(daysPath)
    ? (JSON.parse(fs.readFileSync(daysPath, 'utf8')) as Day[])
    : mock.days;
  const transactions = fs.existsSync(txnsPath)
    ? (JSON.parse(fs.readFileSync(txnsPath, 'utf8')) as Transaction[])
    : mock.transactions;

  return {
    facts,
    days,
    transactions,
    plan: mock.plan,
  };
}

function createMockInteractiveGrid(days: readonly Day[]): {
  grid: InteractiveGrid;
  tweenedColors: number;
  poppedVisuals: number;
  lastPreset: unknown;
} {
  const state = {
    tweenedColors: 0,
    poppedVisuals: 0,
    lastPreset: null as unknown,
  };

  const dayVisuals: DayVisual[] = days.map((d, idx) => ({
    day: d,
    index: idx,
    month: parseInt(d.date.slice(5, 7), 10) - 1,
    dom: parseInt(d.date.slice(8, 10), 10),
    x: 64 + d.week_index * 10,
    y: 880 + d.weekday * 10,
    s: 8.4,
    k: 1,
    r: 44,
    g: 44,
    b: 42,
    hov: 0,
    hovT: 0,
    pt: null,
    pa: 0,
    rt: null,
    ra: 0,
    A: null,
    landedMinor: 0,
    nland: 0,
    stepBucket: 0,
    txns: [],
  }));

  const grid = {
    days: dayVisuals,
    particles: [],
    rings: [],
    hideAllParticles: vi.fn(),
    setGridGeometry: vi.fn((preset: unknown) => {
      state.lastPreset = preset;
    }),
    tweenColor: vi.fn(() => {
      state.tweenedColors++;
    }),
    popVisual: vi.fn(() => {
      state.poppedVisuals++;
    }),
    resetToBaseColors: vi.fn(),
  } as unknown as InteractiveGrid;

  return {
    grid,
    get tweenedColors() {
      return state.tweenedColors;
    },
    get poppedVisuals() {
      return state.poppedVisuals;
    },
    get lastPreset() {
      return state.lastPreset;
    },
  };
}

function buildTestChapterContext(opts: {
  chapter: Chapter;
  facts: readonly Fact[];
  days: readonly Day[];
  transactions: readonly Transaction[];
  plan: StoryPlan;
  viewport: 'desktop' | 'phone';
  reducedMotion?: boolean;
  grid?: InteractiveGrid;
  onOpenReceipts?: (title: string, txnIds: string[]) => void;
  onOpenExplore?: (cat?: string) => void;
}): ExtendedChapterContext {
  const factMap = new Map<string, Fact>(opts.facts.map((f) => [f.id, f]));
  const allowedIds = new Set(opts.chapter.txn_ids);
  const chapterTxns = opts.transactions.filter((t) => allowedIds.has(t.id));

  return {
    chapter: opts.chapter,
    plan: opts.plan,
    palette: DEFAULT_PALETTE,
    facts: factMap,
    days: opts.days,
    transactions: chapterTxns,
    allTransactions: opts.transactions,
    resolveCopy: (tpl: string) => resolveCopyTemplate(tpl, factMap),
    getFact: (fid: string) => {
      const f = factMap.get(fid);
      if (!f) throw new Error(`Missing fact: ${fid}`);
      return f;
    },
    openReceipts: (title: string, txnIds: string[]) => {
      opts.onOpenReceipts?.(title, txnIds);
    },
    openExplore: (cat) => {
      opts.onOpenExplore?.(cat);
    },
    openAsk: () => {},
    exportShareCard: async () => 'data:image/png;base64,',
    viewport: opts.viewport,
    reducedMotion: opts.reducedMotion ?? false,
    grid: opts.grid,
  };
}

describe('Bespoke Chapters Unit Tests (Workstream E)', () => {
  const dataset = loadRealFactsAndData();
  const factMap = new Map<string, Fact>(dataset.facts.map((f) => [f.id, f]));

  const studioChapterSpec: Chapter = {
    id: 'bespoke_0',
    type: 'bespoke',
    bespoke_module: 'studio',
    palette_id: 'paper_studio',
    headline: 'Room to make noise: {fact:studio_total_spend} at Monarch Acoustic.',
    body: 'Takeaway for Sam — From the {fact:studio_deposit_spend} May deposit to the {fact:studio_final_spend} August completion and {fact:studio_gear_count} gear buys totaling {fact:studio_total_with_gear_spend}.',
    fact_ids: [
      'studio_total_spend',
      'studio_deposit_spend',
      'studio_final_spend',
      'studio_synth_spend',
      'studio_gear_count',
      'studio_total_with_gear_spend',
    ],
    txn_ids: factMap.get('studio_total_with_gear_spend')?.txn_ids ?? [
      'SAV-2025052401',
      'SAV-2025081101',
    ],
    params: {
      kicker: '05 · ROOM TO MAKE NOISE',
      badge: 'only in your app',
      focus_category: 'shopping',
    },
  };

  const coffeeChapterSpec: Chapter = {
    id: 'bespoke_1',
    type: 'bespoke',
    bespoke_module: 'coffee',
    palette_id: 'solar_ember',
    headline: 'Two cafés, {fact:coffee_total_visits} cups, {fact:coffee_total_spend}.',
    body: 'Takeaway for Sam — {fact:top_merchant_name} won on habit ({fact:visits_top_merchant} visits, {fact:spend_top_merchant}), while {fact:second_coffee_merchant_name} won on spend ({fact:second_coffee_visits} visits, {fact:second_coffee_spend}) across {fact:coffee_merchants_count} cafés.',
    fact_ids: [
      'coffee_total_visits',
      'coffee_total_spend',
      'top_merchant_name',
      'visits_top_merchant',
      'spend_top_merchant',
      'second_coffee_merchant_name',
      'second_coffee_visits',
      'second_coffee_spend',
      'coffee_merchants_count',
      'longest_coffee_streak_days',
    ],
    txn_ids: factMap.get('coffee_total_visits')?.txn_ids ?? [],
    params: {
      kicker: '06 · THE MORNING RIVALRY',
      badge: 'only in your app',
      focus_category: 'coffee',
    },
  };

  describe('BESPOKE_CHAPTER_REGISTRY & Module Resolution', () => {
    it('registers studio, coffee, and generic fallback factories and resolves keys cleanly', () => {
      expect(typeof BESPOKE_CHAPTER_REGISTRY.bespoke_0).toBe('function');
      expect(typeof BESPOKE_CHAPTER_REGISTRY.studio).toBe('function');
      expect(typeof BESPOKE_CHAPTER_REGISTRY.monarch_acoustic).toBe('function');
      expect(typeof BESPOKE_CHAPTER_REGISTRY.bespoke_1).toBe('function');
      expect(typeof BESPOKE_CHAPTER_REGISTRY.coffee).toBe('function');
      expect(typeof BESPOKE_CHAPTER_REGISTRY.generic).toBe('function');

      expect(createStudioChapter()).toBeInstanceOf(StudioChapter);
      expect(createCoffeeChapter()).toBeInstanceOf(CoffeeChapter);
      expect(createGenericBespokeChapter()).toBeInstanceOf(GenericBespokeChapter);

      expect(resolveBespokeChapterModule('studio')).toBeInstanceOf(StudioChapter);
      expect(resolveBespokeChapterModule('bespoke_0')).toBeInstanceOf(StudioChapter);
      expect(resolveBespokeChapterModule('coffee')).toBeInstanceOf(CoffeeChapter);
      expect(resolveBespokeChapterModule('bespoke_1')).toBeInstanceOf(CoffeeChapter);
      expect(resolveBespokeChapterModule('alex_custom_habit')).toBeInstanceOf(
        GenericBespokeChapter
      );

      const registered = new Map<string, () => unknown>();
      registerBespokeChapters({
        registerChapterModule: (k, fn) => registered.set(k, fn),
      });
      expect(registered.has('studio')).toBe(true);
      expect(registered.has('coffee')).toBe(true);
      expect(registered.has('bespoke_0')).toBe(true);
      expect(registered.has('bespoke_1')).toBe(true);
    });
  });

  describe('StudioChapter ("Room to Make Noise" — bespoke_0 / studio)', () => {
    it('mounts and plays on desktop viewport with resolved facts, badge, custom SVG, odometers, and receipt triggers', () => {
      const container = new LiteElement('div') as unknown as HTMLElement;
      const receiptCalls: Array<{ title: string; txnIds: string[] }> = [];
      let exploredCategory: string | undefined;
      const mockGrid = createMockInteractiveGrid(dataset.days);

      const ctx = buildTestChapterContext({
        chapter: studioChapterSpec,
        facts: dataset.facts,
        days: dataset.days,
        transactions: dataset.transactions,
        plan: dataset.plan,
        viewport: 'desktop',
        grid: mockGrid.grid,
        onOpenReceipts: (title, txnIds) => receiptCalls.push({ title, txnIds }),
        onOpenExplore: (cat) => {
          exploredCategory = cat;
        },
      });

      const mod = createStudioChapter();
      mod.mount(container, ctx);

      const html = container.innerHTML;
      // 1) "ONLY IN YOUR APP" badge & KEY TAKEAWAY FOR SAM banner presence
      const badgeEl = container.querySelector('[data-testid="bespoke-badge"]');
      expect(badgeEl).not.toBeNull();
      expect(html).toContain('ONLY IN YOUR APP');
      expect(html).toContain('KEY TAKEAWAY FOR SAM');

      // 2) Rule 1 {fact:id} resolution (no unresolved {fact:...} placeholders)
      expect(html).not.toContain('{fact:');
      expect(html).toContain('$11,596');
      expect(html).toContain('$2,535');
      expect(html).toContain('$9,061.87');
      expect(html).toContain('$445');
      expect(html).toContain('$15,496');

      // 3) Custom SVG Studio Signal / Acoustic Blueprint Timeline
      const svgEl = container.querySelector('[data-testid="studio-blueprint-svg"]');
      expect(svgEl).not.toBeNull();
      const signalBars = container.querySelectorAll('.studio-signal-bar');
      expect(signalBars.length).toBe(12);

      // 4) Flat metric blocks & odometers
      expect(container.querySelector('[data-testid="studio-block-build"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="studio-block-total-gear"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="studio-block-final"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="studio-block-gear-count"]')).not.toBeNull();

      const odos = Array.from(container.querySelectorAll<HTMLElement>('.od'));
      expect(odos.length).toBe(4);
      const odoValues = odos.map((o) => o.dataset.v);
      expect(odoValues).toEqual(['11,596', '15,496', '9,061.87', '15']);

      // 5) Receipt trigger callbacks
      const triggers = container.querySelectorAll<HTMLButtonElement>('.receipt-trigger');
      expect(triggers.length).toBeGreaterThanOrEqual(4);
      triggers.forEach((btn) => btn.click());
      expect(receiptCalls.length).toBe(triggers.length);
      expect(receiptCalls.some((c) => c.txnIds.includes('SAV-2025052401'))).toBe(true);
      expect(receiptCalls.some((c) => c.txnIds.includes('SAV-2025081101'))).toBe(true);

      // 6) Play timeline & verify grid sync + motion events
      const timeline = new PlayerTimelineController({
        reducedMotion: false,
        chapterId: 'bespoke_0',
      });
      mod.play(timeline);
      expect(mockGrid.tweenedColors).toBe(dataset.days.length);
      expect(mockGrid.poppedVisuals).toBeGreaterThan(0);
      expect(timeline.getEvents().some((e) => e.type === 'bespoke.studio.play')).toBe(true);

      // 7) Explore & unmount
      mod.explore();
      expect(exploredCategory).toBe('shopping');
      mod.unmount();
      expect(container.innerHTML).toBe('');
    });

    it('mounts and plays cleanly on phone viewport (390×844) with reduced motion', () => {
      const container = new LiteElement('div') as unknown as HTMLElement;
      const mockGrid = createMockInteractiveGrid(dataset.days);

      const ctx = buildTestChapterContext({
        chapter: studioChapterSpec,
        facts: dataset.facts,
        days: dataset.days,
        transactions: dataset.transactions,
        plan: dataset.plan,
        viewport: 'phone',
        reducedMotion: true,
        grid: mockGrid.grid,
      });

      const mod = createStudioChapter();
      mod.mount(container, ctx);

      const stage = container.querySelector('[data-testid="studio-chapter-stage"]');
      expect(stage?.getAttribute('data-viewport')).toBe('phone');
      expect(container.querySelector('[data-testid="bespoke-badge"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="studio-blueprint-svg"]')).not.toBeNull();

      const timeline = new PlayerTimelineController({
        reducedMotion: true,
        chapterId: 'bespoke_0',
      });
      mod.play(timeline);
      expect(timeline.getEvents().some((e) => e.type === 'bespoke.studio.play')).toBe(true);
      mod.unmount();
    });
  });

  describe('CoffeeChapter ("The Morning Rivalry" — bespoke_1 / coffee)', () => {
    it('mounts and plays on desktop viewport comparing Blue Bottle Coffee vs Sightglass Coffee across 163 cups', () => {
      const container = new LiteElement('div') as unknown as HTMLElement;
      const receiptCalls: Array<{ title: string; txnIds: string[] }> = [];
      let exploredCategory: string | undefined;
      const mockGrid = createMockInteractiveGrid(dataset.days);

      const ctx = buildTestChapterContext({
        chapter: coffeeChapterSpec,
        facts: dataset.facts,
        days: dataset.days,
        transactions: dataset.transactions,
        plan: dataset.plan,
        viewport: 'desktop',
        grid: mockGrid.grid,
        onOpenReceipts: (title, txnIds) => receiptCalls.push({ title, txnIds }),
        onOpenExplore: (cat) => {
          exploredCategory = cat;
        },
      });

      const mod = createCoffeeChapter();
      mod.mount(container, ctx);

      const html = container.innerHTML;
      // 1) "ONLY IN YOUR APP" badge & KEY TAKEAWAY FOR SAM banner presence
      expect(container.querySelector('[data-testid="bespoke-badge"]')).not.toBeNull();
      expect(html).toContain('ONLY IN YOUR APP');
      expect(html).toContain('KEY TAKEAWAY FOR SAM');

      // 2) Rule 1 {fact:id} resolution
      expect(html).not.toContain('{fact:');
      expect(html).toContain('Blue Bottle Coffee');
      expect(html).toContain('Sightglass Coffee');
      expect(html).toContain('163');
      expect(html).toContain('$2,264');
      expect(html).toContain('$572.80');
      expect(html).toContain('$634.27');

      // 3) Custom SVG Head-to-Head Café Split Bar & 53-Week Dual-Track Matrix
      const svgEl = container.querySelector('[data-testid="coffee-rivalry-svg"]');
      expect(svgEl).not.toBeNull();
      const splitBars = container.querySelectorAll('.rivalry-split-bar');
      expect(splitBars.length).toBe(6);
      const weekCells = container.querySelectorAll('.rivalry-week-cell');
      expect(weekCells.length).toBe(53 * 3);
      const calDots = container.querySelectorAll('.coffee-cal-dot');
      expect(calDots.length).toBe(dataset.days.length);

      // 4) Flat blocks & odometers
      expect(container.querySelector('[data-testid="coffee-block-total-visits"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="coffee-block-top-cafe"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="coffee-block-second-cafe"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="coffee-block-total-spend"]')).not.toBeNull();

      const odos = Array.from(container.querySelectorAll<HTMLElement>('.od'));
      expect(odos.length).toBe(4);
      const odoValues = odos.map((o) => o.dataset.v);
      expect(odoValues).toEqual(['163', '72', '41', '2,264']);

      // 5) Receipt triggers
      const triggers = container.querySelectorAll<HTMLButtonElement>('.receipt-trigger');
      expect(triggers.length).toBeGreaterThanOrEqual(4);
      triggers.forEach((btn) => btn.click());
      expect(receiptCalls.length).toBe(triggers.length);
      expect(receiptCalls.some((c) => c.title.includes('$572.80'))).toBe(true);
      expect(receiptCalls.some((c) => c.title.includes('$634.27'))).toBe(true);

      // 6) Play timeline & verify grid sync + motion events
      const timeline = new PlayerTimelineController({
        reducedMotion: false,
        chapterId: 'bespoke_1',
      });
      mod.play(timeline);
      expect(mockGrid.tweenedColors).toBe(dataset.days.length);
      expect(mockGrid.poppedVisuals).toBeGreaterThan(0);
      expect(timeline.getEvents().some((e) => e.type === 'bespoke.coffee.play')).toBe(true);

      mod.explore();
      expect(exploredCategory).toBe('coffee');
      mod.unmount();
      expect(container.innerHTML).toBe('');
    });

    it('mounts and plays cleanly on phone viewport (390×844)', () => {
      const container = new LiteElement('div') as unknown as HTMLElement;
      const mockGrid = createMockInteractiveGrid(dataset.days);

      const ctx = buildTestChapterContext({
        chapter: coffeeChapterSpec,
        facts: dataset.facts,
        days: dataset.days,
        transactions: dataset.transactions,
        plan: dataset.plan,
        viewport: 'phone',
        reducedMotion: false,
        grid: mockGrid.grid,
      });

      const mod = createCoffeeChapter();
      mod.mount(container, ctx);

      const stage = container.querySelector('[data-testid="coffee-chapter-stage"]');
      expect(stage?.getAttribute('data-viewport')).toBe('phone');
      expect(container.querySelector('[data-testid="bespoke-badge"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="coffee-rivalry-svg"]')).not.toBeNull();

      const timeline = new PlayerTimelineController({
        reducedMotion: false,
        chapterId: 'bespoke_1',
      });
      mod.play(timeline);
      expect(timeline.getEvents().some((e) => e.type === 'bespoke.coffee.play')).toBe(true);
      mod.unmount();
    });
  });

  describe('GenericBespokeChapter Fallback (Contrast Persona Support)', () => {
    it('renders data-driven bespoke blocks, badge, SVG, and receipts on desktop and phone', () => {
      const mock = buildMockDataset();
      const customBespokeChapter: Chapter = {
        id: 'bespoke_alex_0',
        type: 'bespoke',
        bespoke_module: 'generic',
        palette_id: 'ink_solar',
        headline: 'Your signature ritual: {fact:top_merchant_name}.',
        body: '{fact:visits_top_merchant} visits totaling {fact:spend_top_merchant} across {fact:year_number}.',
        fact_ids: ['visits_top_merchant', 'spend_top_merchant', 'total_spend_usd', 'payday_count'],
        txn_ids: mock.transactions.slice(0, 12).map((t) => t.id),
        params: {
          kicker: 'BESPOKE RITUAL',
          badge: 'only in your app',
        },
      };

      for (const viewport of ['desktop', 'phone'] as const) {
        const container = new LiteElement('div') as unknown as HTMLElement;
        const receiptCalls: Array<{ title: string; txnIds: string[] }> = [];
        const ctx = buildTestChapterContext({
          chapter: customBespokeChapter,
          facts: mock.facts,
          days: mock.days,
          transactions: mock.transactions,
          plan: mock.plan,
          viewport,
          onOpenReceipts: (title, txnIds) => receiptCalls.push({ title, txnIds }),
        });

        const mod = resolveBespokeChapterModule('generic');
        mod.mount(container, ctx);

        expect(container.querySelector('[data-testid="bespoke-badge"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="generic-bespoke-svg"]')).not.toBeNull();
        expect(container.innerHTML).not.toContain('{fact:');

        const triggers = container.querySelectorAll<HTMLButtonElement>('.receipt-trigger');
        expect(triggers.length).toBeGreaterThanOrEqual(4);
        triggers[0]?.click();
        expect(receiptCalls.length).toBe(1);

        const timeline = new PlayerTimelineController({
          reducedMotion: false,
          chapterId: customBespokeChapter.id,
        });
        mod.play(timeline);
        expect(timeline.getEvents().some((e) => e.type === 'bespoke.generic.play')).toBe(true);
        mod.unmount();
      }
    });
  });
});
