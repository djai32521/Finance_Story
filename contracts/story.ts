/**
 * Story Plan and Chapter contracts for "An app just for me" — a year in money.
 */

import type { BusinessMetadata, Category, Day, Fact, Transaction } from './data.js';

export type FixedChapterType = 'pour' | 'year_as_squares' | 'one_line' | 'share_card';

export type ChosenChapterType =
  | 'your_place'
  | 'streak'
  | 'getaway'
  | 'heartbeat'
  | 'shatter'
  | 'big_one'
  | 'personality';

export type BespokeChapterType = 'bespoke';

export type ChapterType = FixedChapterType | ChosenChapterType | BespokeChapterType;

export interface PaletteTheme {
  id: string;
  name: string;
  bg: string;
  fg: string;
  accent: string;
  secondary: string;
  muted: string;
  blocks: {
    primary: { bg: string; fg: string };
    secondary: { bg: string; fg: string };
    tertiary: { bg: string; fg: string };
    quaternary?: { bg: string; fg: string };
  };
}

export interface ChapterMetricBlock {
  label: string;
  fact_id: string;
  unit_sup?: string;
  sublabel_fact_ids?: string[];
  sublabel_template?: string;
  color_role?: 'primary' | 'secondary' | 'tertiary' | 'quaternary' | 'ink' | 'bone';
}

export interface ChapterParams {
  chapter_number?: string;
  kicker?: string;
  subheadline?: string;
  badge?: string; // e.g., "only in your app" or "executive audit" for bespoke chapters
  focus_category?: Category;
  focus_merchant?: string;
  highlight_dates?: string[];
  blocks?: ChapterMetricBlock[];
  extra?: Record<string, string | number | boolean | string[]>;
}

export interface Chapter {
  id: string;
  type: ChapterType;
  palette_id: string;
  /**
   * Copy template referencing facts ONLY via `{fact:id}` placeholders.
   * Must not contain raw un-sourced digits (enforced by fact-lint).
   */
  headline: string;
  body: string;
  fact_ids: string[];
  txn_ids: string[];
  params: ChapterParams;
  bespoke_module?: string;
}

export interface PersonalityProfile {
  title: string; // e.g. "The High-Velocity Margin Builder" or "The Studio-Building Sprinter"
  subtitle: string; // Template using {fact:...} placeholders
  dominant_categories: Category[];
  payday_spike_ratio_fact_id: string;
  shape_seed: number;
}

export interface StoryPlan {
  person_name: string;
  year_fact_id: string; // e.g. "year_number" -> 2025
  year: number;
  palette_ids: string[];
  chapters: Chapter[];
  one_line: string; // Template using {fact:...} placeholders
  personality: PersonalityProfile;
  /** Optional B2B / procedural metadata for dynamic labels, currencies, and archetypes */
  business_meta?: BusinessMetadata;
  /** Optional display labels mapping Category keys to discovered business category names */
  category_labels?: Record<string, string>;
  /** Optional dynamically generated sample questions for Ask mode */
  sample_questions?: string[];
}

export interface DatasetBundle {
  transactions: Transaction[];
  days: Day[];
  facts: Fact[];
  plan: StoryPlan;
}

export interface MotionEvent {
  type: string;
  timestamp: number; // ms since timeline start
  beat: number; // 120 BPM beat index
  chapter_id?: string;
  value?: number | string | Record<string, unknown> | null;
}

export interface TimelineController {
  /** Advance or seek timeline to a specific time in seconds (used by capture mode & scrub) */
  seek(seconds: number): void;
  /** Play timeline at given playback rate */
  play(rate?: number): void;
  /** Pause timeline */
  pause(): void;
  /** Total duration of current chapter animation in seconds */
  duration(): number;
  /** Log a deterministic motion event for audio sync */
  logEvent(type: string, value?: MotionEvent['value']): void;
  /** Whether reduced motion is active */
  isReducedMotion(): boolean;
}

export interface ChapterContext {
  chapter: Chapter;
  plan: StoryPlan;
  palette: PaletteTheme;
  facts: ReadonlyMap<string, Fact>;
  days: readonly Day[];
  /** Subset of transactions this chapter is allowed to see (plus full year for grid chapters) */
  transactions: readonly Transaction[];
  allTransactions: readonly Transaction[];
  /** Resolve `{fact:id}` placeholders in copy string and register referenced fact IDs */
  resolveCopy(template: string): string;
  /** Retrieve a Fact by ID (throws if missing) */
  getFact(factId: string): Fact;
  /** Open the receipts drawer for a specific set of transaction IDs and claim title */
  openReceipts(title: string, txnIds: string[]): void;
  /** Trigger explore mode for the current chapter */
  openExplore(initialCategory?: Category): void;
  /** Open Ask Your Year modal/panel */
  openAsk(prefillQuestion?: string): void;
  /** Export a share card PNG for the given chapter or summary */
  exportShareCard(size?: '1080x1350' | '1080x1920'): Promise<string>;
  /** Viewport mode */
  viewport: 'desktop' | 'phone';
  reducedMotion: boolean;
}

export interface ChapterModule {
  mount(container: HTMLElement, ctx: ChapterContext): void;
  play(timeline: TimelineController): void;
  explore(): void;
  unmount(): void;
}
