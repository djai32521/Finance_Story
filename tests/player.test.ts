import { describe, expect, it } from 'vitest';
import type { Fact } from '../contracts/index.js';
import { formatMoneyMinor } from '../contracts/index.js';
import { buildMockDataset } from '../data/mock/index.js';
import { createCoreChapterModule } from '../src/chapters/core/index.js';
import { filterTransactionsByIds, summarizeReceipts } from '../src/explore/receipts-drawer.js';
import { aggregateDayRange } from '../src/grid/drag-selector.js';
import { buildSweepTimeRemap } from '../src/grid/scrub-bar.js';
import { AudioCueSlot } from '../src/player/audio-cue.js';
import {
  PlayerTimelineController,
  resolveCopyTemplate,
} from '../src/player/timeline-controller.js';

describe('Story Player, Explore & Grid Unit Tests (Workstream C)', () => {
  const mock = buildMockDataset();
  const factMap = new Map<string, Fact>(mock.facts.map((f) => [f.id, f]));

  describe('resolveCopyTemplate (Rule 1 Fact Placeholder Resolution)', () => {
    it('replaces {fact:id} placeholders with pre-formatted fact strings', () => {
      const resolved = resolveCopyTemplate(
        'In {fact:year_number}, you visited {fact:top_merchant_name} {fact:visits_top_merchant} times.',
        factMap
      );
      const visits = factMap.get('visits_top_merchant')!.formatted;
      expect(resolved).toBe(`In 2025, you visited Blue Bottle Coffee ${visits} times.`);
      expect(resolved).not.toContain('{fact:');
    });

    it('tracks referenced fact IDs via callback', () => {
      const seen: string[] = [];
      resolveCopyTemplate(
        '{fact:total_spend_usd} across {fact:total_transactions_count} movements.',
        factMap,
        {
          onReferencedFact: (id) => seen.push(id),
        }
      );
      expect(seen).toEqual(['total_spend_usd', 'total_transactions_count']);
    });

    it('throws in strict mode when referencing an unknown fact ID', () => {
      expect(() =>
        resolveCopyTemplate('Unknown {fact:does_not_exist}', factMap, { strict: true })
      ).toThrow(/Unknown fact referenced/);
    });
  });

  describe('PlayerTimelineController state transitions & motion logging', () => {
    it('manages play, pause, seek, reducedMotion, and 120 BPM beat event logging', () => {
      const soughtTimes: number[] = [];
      const controller = new PlayerTimelineController({
        reducedMotion: false,
        chapterId: 'pour',
        onSeek: (sec) => soughtTimes.push(sec),
      });

      expect(controller.isReducedMotion()).toBe(false);
      expect(controller.isPlaying()).toBe(false);

      controller.play(1.5);
      expect(controller.isPlaying()).toBe(true);
      expect(controller.getPlaybackRate()).toBe(1.5);

      controller.seek(2.5);
      expect(controller.currentTime()).toBe(2.5);
      expect(soughtTimes).toContain(2.5);

      // At t = 2.5s (2500ms) and 120 BPM (500ms/beat), beat index should be 5
      controller.logEvent('pour.collapse', 880);
      const events = controller.getEvents();
      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('pour.collapse');
      expect(events[0]?.timestamp).toBe(2500);
      expect(events[0]?.beat).toBe(5);
      expect(events[0]?.chapter_id).toBe('pour');
      expect(events[0]?.value).toBe(880);

      controller.pause();
      expect(controller.isPlaying()).toBe(false);

      controller.setReducedMotion(true);
      expect(controller.isReducedMotion()).toBe(true);
    });
  });

  describe('Receipts filtering & summarization (Rule 2 Traceability)', () => {
    it('filters transactions by txn_ids without duplicates and computes exact sums', () => {
      const sampleIds = mock.transactions.slice(0, 6).map((t) => t.id);
      const withDuplicateIds = [...sampleIds, sampleIds[0]!, 'NON-EXISTENT-ID'];

      const filtered = filterTransactionsByIds(mock.transactions, withDuplicateIds);
      expect(filtered.length).toBe(6);
      expect(filtered.map((t) => t.id)).toEqual(sampleIds);

      const summary = summarizeReceipts(filtered);
      const expectedOut = filtered
        .filter((t) => t.direction === 'out')
        .reduce((acc, t) => acc + t.amount_minor, 0);
      const expectedIn = filtered
        .filter((t) => t.direction === 'in')
        .reduce((acc, t) => acc + t.amount_minor, 0);

      expect(summary.count).toBe(6);
      expect(summary.totalOutMinor).toBe(expectedOut);
      expect(summary.totalInMinor).toBe(expectedIn);
      expect(summary.formattedTotalOut).toBe(formatMoneyMinor(expectedOut, { showCents: true }));
    });
  });

  describe('DragSelector range aggregation (aggregateDayRange)', () => {
    it('aggregates any day span (forward or backward drag) accurately in integer cents', () => {
      const forward = aggregateDayRange(mock.days, 10, 24);
      const backward = aggregateDayRange(mock.days, 24, 10);

      expect(forward).toEqual(backward);
      expect(forward.startDayIndex).toBe(10);
      expect(forward.endDayIndex).toBe(24);
      expect(forward.dayCount).toBe(15);
      expect(forward.startDate).toBe(mock.days[10]!.date);
      expect(forward.endDate).toBe(mock.days[24]!.date);

      const manualDiscretionary = mock.days
        .slice(10, 25)
        .reduce((acc, d) => acc + d.discretionary_out_minor, 0);
      const manualTxnCount = mock.days.slice(10, 25).reduce((acc, d) => acc + d.txn_ids.length, 0);

      expect(forward.discretionaryOutMinor).toBe(manualDiscretionary);
      expect(forward.formattedDiscretionary).toBe(
        formatMoneyMinor(manualDiscretionary, { showCents: false })
      );
      expect(forward.txnIds.length).toBe(manualTxnCount);
    });
  });

  describe('Sweep time remap & AudioCueSlot', () => {
    it('builds a strictly monotonic 365-day time remap aligned to the 120 BPM beat grid', () => {
      const remap = buildSweepTimeRemap(mock.days, 8000, 7.5, 0.5);
      expect(remap.times.length).toBe(366);
      expect(remap.dayAtTime(0)).toBe(0);
      expect(remap.dayAtTime(remap.totalDuration + 1)).toBe(365);

      for (let i = 0; i < 365; i++) {
        expect(remap.times[i + 1]!).toBeGreaterThan(remap.times[i]!);
      }

      // Paydays must land on multiples of 0.5s (120 BPM)
      mock.days.forEach((d, idx) => {
        if (d.is_payday) {
          const t = remap.times[idx]!;
          const remainder = Math.abs(t * 2 - Math.round(t * 2));
          expect(remainder).toBeLessThan(1e-6);
        }
      });
    });

    it('unlocks AudioCueSlot and records start_open cue event', () => {
      const cue = new AudioCueSlot();
      expect(cue.isUnlocked()).toBe(false);
      cue.unlock();
      expect(cue.isUnlocked()).toBe(true);
      expect(cue.getCueLog()[0]?.cue).toBe('start_open');
    });

    it('instantiates all 11 core chapter modules cleanly', () => {
      const types = [
        'pour',
        'year_as_squares',
        'your_place',
        'streak',
        'getaway',
        'heartbeat',
        'big_one',
        'shatter',
        'personality',
        'one_line',
        'share_card',
      ] as const;

      for (const t of types) {
        const mod = createCoreChapterModule(t);
        expect(typeof mod.mount).toBe('function');
        expect(typeof mod.play).toBe('function');
        expect(typeof mod.explore).toBe('function');
        expect(typeof mod.unmount).toBe('function');
      }
    });

    it('holds ShatterChapter in shattered state in interactive mode without snapping back', () => {
      const shatterMod = createCoreChapterModule('shatter');
      const fakeContainer = {
        innerHTML: '',
        querySelectorAll: () => [],
        querySelector: () => null,
      } as unknown as HTMLElement;

      const shatterChapter =
        mock.plan.chapters.find((c) => c.type === 'shatter') ?? mock.plan.chapters[0]!;
      shatterMod.mount(fakeContainer, {
        chapter: shatterChapter,
        plan: mock.plan,
        palette: {
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
          },
        },
        facts: factMap,
        days: mock.days,
        transactions: mock.transactions,
        allTransactions: mock.transactions,
        resolveCopy: (tpl) => resolveCopyTemplate(tpl, factMap),
        getFact: (id) => factMap.get(id)!,
        openReceipts: () => {},
        openExplore: () => {},
        openAsk: () => {},
        exportShareCard: async () => '',
        viewport: 'desktop',
        reducedMotion: false,
      });

      expect(fakeContainer.innerHTML).toContain('data-testid="shatter-takeaway"');
      expect(fakeContainer.innerHTML).toContain('#1 CATEGORY:');
      expect(fakeContainer.innerHTML).toContain(
        'Click any category column below to inspect its receipts, or press Next → when ready'
      );

      const controller = new PlayerTimelineController({
        reducedMotion: false,
        chapterId: 'shatter',
      });
      shatterMod.play(controller);
      controller.seek(6.0);

      const eventTypes = controller.getEvents().map((e) => e.type);
      expect(eventTypes).toContain('shatter.break');
      expect(eventTypes).toContain('shatter.hold');
      expect(eventTypes).not.toContain('shatter.snap');
    });

    it('renders PourChapter 2025 title with 1920x1080 canvas overlay and centered annotations', () => {
      const pourMod = createCoreChapterModule('pour');
      const fakeContainer = {
        innerHTML: '',
        querySelectorAll: () => [],
        querySelector: () => null,
      } as unknown as HTMLElement;

      const pourChapter =
        mock.plan.chapters.find((c) => c.type === 'pour') ?? mock.plan.chapters[0]!;
      pourMod.mount(fakeContainer, {
        chapter: pourChapter,
        plan: mock.plan,
        palette: {
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
          },
        },
        facts: factMap,
        days: mock.days,
        transactions: mock.transactions,
        allTransactions: mock.transactions,
        resolveCopy: (tpl) => resolveCopyTemplate(tpl, factMap),
        getFact: (id) => factMap.get(id)!,
        openReceipts: () => {},
        openExplore: () => {},
        openAsk: () => {},
        exportShareCard: async () => '',
        viewport: 'desktop',
        reducedMotion: false,
      });

      expect(fakeContainer.innerHTML).toContain('id="ttlt-canvas" width="1920" height="1080"');
      expect(fakeContainer.innerHTML).toContain('<span id="ttlt"');
      expect(fakeContainer.innerHTML).toContain(
        'id="ttlA" style="position:absolute;left:0;right:0;top:130px;text-align:center;font-size:13px"'
      );
      expect(fakeContainer.innerHTML).toContain(
        'id="ttlB" style="position:absolute;left:0;right:0;top:675px;text-align:center;font-size:13px"'
      );
    });
  });
});
