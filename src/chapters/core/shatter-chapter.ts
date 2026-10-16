import gsap from 'gsap';
import type {
  Category,
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
  Transaction,
} from '../../../contracts/index.js';
import { formatMoneyMinor, getCategoryDisplayLabel } from '../../../contracts/index.js';
import {
  CATEGORY_COLORS,
  DISPLAY_CATEGORIES,
  EASE,
  GRID_PRESETS,
  hexToRgb,
  type InteractiveGrid,
} from '../../grid/interactive-grid.js';
import {
  MOTION_TOKENS,
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from './pour-chapter.js';

interface CategoryColumnSpec {
  key: Category;
  label: string;
  color: string;
  txns: Transaction[];
  totalMinor: number;
  fact?: Fact;
}

export class ShatterChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private columns: CategoryColumnSpec[] = [];
  private particleSlots = new Map<string, [number, number, number]>();
  private phase = 0;

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const isB2B = Boolean(ctx.plan.business_meta);
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');
    const hasCustomCats = Boolean(ctx.plan.category_labels);

    const outTxns = ctx.allTransactions.filter((t) => t.direction === 'out' && !t.is_transfer);

    const buildColSpec = (catKey: Category): CategoryColumnSpec => {
      const txns = outTxns.filter((t) => t.category === catKey);
      const totalMinor = txns.reduce((acc, t) => acc + t.amount_minor, 0);
      const matchingFact = Array.from(ctx.facts.values()).find(
        (f) =>
          f.id.includes(catKey.replace(/\s+/g, '_')) && (f.unit === 'usd_cents' || f.unit === 'usd')
      );
      const rawLabel = getCategoryDisplayLabel(catKey, ctx.plan.category_labels, isB2B);
      const defaultLabel =
        DISPLAY_CATEGORIES.find((d) => d.key === catKey)?.label ??
        catKey.charAt(0).toUpperCase() + catKey.slice(1);
      return {
        key: catKey,
        label: rawLabel !== catKey ? rawLabel : defaultLabel,
        color: CATEGORY_COLORS[catKey] ?? '#F4F03A',
        txns,
        totalMinor,
        fact: matchingFact,
      };
    };

    const allNonZeroCatKeys = Array.from(new Set(outTxns.map((t) => t.category)));
    const candidateSpecs =
      isB2B || hasCustomCats
        ? allNonZeroCatKeys
            .map(buildColSpec)
            .filter((c) => c.totalMinor > 0)
            .sort((a, b) => b.totalMinor - a.totalMinor)
        : DISPLAY_CATEGORIES.map((dc) => buildColSpec(dc.key))
            .filter((c) => c.totalMinor > 0)
            .sort((a, b) => b.totalMinor - a.totalMinor);

    if (candidateSpecs.length < 8) {
      const seen = new Set(candidateSpecs.map((c) => c.key));
      const extraNonZero = allNonZeroCatKeys
        .filter((k) => !seen.has(k))
        .map(buildColSpec)
        .filter((c) => c.totalMinor > 0)
        .sort((a, b) => b.totalMinor - a.totalMinor);
      for (const spec of extraNonZero) {
        if (candidateSpecs.length >= 8) break;
        seen.add(spec.key);
        candidateSpecs.push(spec);
      }
      for (const dc of DISPLAY_CATEGORIES.slice(0, 8)) {
        if (candidateSpecs.length >= 8) break;
        if (!seen.has(dc.key)) {
          seen.add(dc.key);
          candidateSpecs.push(buildColSpec(dc.key));
        }
      }
    }

    this.columns = candidateSpecs.sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 8);

    const maxTotalMinor = Math.max(10000, ...this.columns.map((c) => c.totalMinor));
    const x0 = 180;
    const colW = 162;
    const gap = 46;
    const baseY = 810;
    const maxH = 490;
    const scale = maxH / maxTotalMinor;

    this.particleSlots.clear();
    this.columns.forEach((col, k) => {
      const H = Math.max(32, col.totalMinor * scale);
      const n = Math.max(1, col.txns.length);
      let s = Math.sqrt((colW * H) / n);
      const perRow = Math.max(1, Math.round(colW / s));
      s = colW / perRow;
      const cellGap = s > 8 ? 1.5 : 0.8;
      const startX = x0 + k * (colW + gap);

      col.txns.forEach((t, j) => {
        const cx = startX + ((j % perRow) + 0.5) * s;
        const cy = baseY - (Math.floor(j / perRow) + 0.5) * s;
        this.particleSlots.set(t.id, [cx, cy, Math.max(3, s - cellGap)]);
      });
    });

    const axisLinesHtml = [0, 0.25, 0.5, 0.75, 1]
      .map((ratio) => {
        const y = Math.round(baseY - ratio * maxH);
        return `<div class="dt sx" style="position:absolute;left:120px;top:${y}px;width:1690px;height:1px;background:#3A3A38;transform-origin:0 50%"></div>`;
      })
      .join('');

    const colLabelsHtml = this.columns
      .map((col, k) => {
        const x = x0 + k * (colW + gap);
        const formatted =
          col.fact?.formatted ?? formatMoneyMinor(col.totalMinor, { showCents: false });
        const rawDigits = formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');
        const numFontSize = formatted.length >= 10 ? 26 : formatted.length >= 8 ? 31 : 38;
        return `
          <div class="later ia" data-cat-col="${this.escapeHtml(col.key)}" style="position:absolute;left:${x}px;top:${baseY + 18}px;width:${colW + 30}px;cursor:pointer;pointer-events:auto;">
            <div class="lab tx" style="position:static;font-size:12px;display:flex;gap:8px;align-items:center;max-width:184px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <i style="width:10px;height:10px;background:${col.color};display:block;flex-shrink:0"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(col.label)}</span>
            </div>
            <div class="num tx" style="position:static;font-size:${numFontSize}px;margin-top:8px">
              <sup>${currencySup}</sup><span class="od" data-v="${this.escapeHtml(rawDigits)}">${this.escapeHtml(rawDigits)}</span>
            </div>
            <div class="lab tx" style="position:static;font-size:10px;margin-top:6px;text-decoration:underline">Receipts (${col.txns.length})</div>
          </div>
        `;
      })
      .join('');

    const totalAllMinor = Math.max(
      1,
      outTxns.reduce((acc, t) => acc + t.amount_minor, 0)
    );
    const topCol = this.columns[0];
    const topSharePct = topCol ? Math.round((topCol.totalMinor / totalAllMinor) * 100) : 0;
    const topFormatted = topCol
      ? (topCol.fact?.formatted ?? formatMoneyMinor(topCol.totalMinor, { showCents: false }))
      : '$0';
    const takeawayBannerHtml = topCol
      ? `<div id="shatter-takeaway" data-testid="shatter-takeaway" aria-label="Click any category column below to inspect its receipts, or press Next → when ready" class="later ia" style="max-width:1792px;display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:6px 16px;padding:8px 14px;background:#1C1C1B;border-left:4px solid var(--c1);color:var(--bone);pointer-events:auto;">
          <span class="lab tx" style="position:static;font-size:11.5px;display:inline-flex;align-items:center;gap:8px;color:var(--c1);flex-shrink:0;">
            <i style="width:10px;height:10px;background:${topCol.color};display:inline-block"></i>
            #1 CATEGORY: ${this.escapeHtml(topCol.label)} (${this.escapeHtml(topFormatted)} · ${topSharePct}% OF ${isB2B ? 'OUTFLOW' : 'SPEND'})
          </span>
          <span class="tx" data-testid="chapter-body" style="position:static;font-size:14.5px;line-height:1.3;color:var(--bone);">
            ${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}
          </span>
        </div>`
      : '';

    container.innerHTML = `
      <div class="ch-header-stack" style="left:60px;top:64px;max-width:1792px;max-height:220px;gap:10px">
        <div class="lab tx">${this.escapeHtml(ctx.chapter.params.kicker ?? '04 · THE SHATTER')}</div>
        <div class="split tx" data-testid="chapter-headline" style="font-size:62px;font-weight:300;letter-spacing:-0.035em;line-height:1.04;max-width:1792px">${this.escapeHtml(headlineText)}</div>
        ${takeawayBannerHtml}
      </div>
      ${axisLinesHtml}
      ${colLabelsHtml}
    `;

    initOdometers(container);

    container.querySelectorAll<HTMLElement>('[data-cat-col]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const catKey = el.dataset.catCol as Category;
        const col = this.columns.find((c) => c.key === catKey);
        if (col) {
          ctx.openReceipts(
            `${col.label} — ${formatMoneyMinor(col.totalMinor, { showCents: true })}`,
            col.txns.map((t) => t.id)
          );
        }
      });
    });
  }

  public play(timeline: TimelineController): void {
    if (!this.container || !this.ctx) return;
    const tl = (timeline as PlayerTimelineController).gsapTimeline ?? gsap.timeline();
    const rm = timeline.isReducedMotion();
    const grid = this.ctx.grid;

    if (grid) {
      grid.setGridGeometry(GRID_PRESETS.sweep, { dur: 0.45 });
      grid.resetToBaseColors();
    }

    const endEnter = enterStageGroup(this.container, tl, 0, rm);
    const breakAt = Math.ceil(endEnter / MOTION_TOKENS.beat) * MOTION_TOKENS.beat;
    const laterEls = Array.from(this.container.querySelectorAll<HTMLElement>('.later'));
    if (laterEls.length) {
      gsap.set(laterEls, { autoAlpha: 0 });
    }

    if (rm) {
      if (grid) {
        this.placeParticlesInSlotsImmediate(grid);
      }
      tl.to(laterEls, { autoAlpha: 1, duration: 0.3 }, breakAt);
      return;
    }

    // 1) Break day squares into category columns
    tl.call(
      () => {
        this.phase = 1;
        timeline.logEvent('shatter.break', this.particleSlots.size);
        if (!grid) return;
        grid.activateParticles();
        grid.particles.forEach((p, idx) => {
          const dv = grid.days[p.dayIndex] ?? grid.days[0];
          if (!dv) return;
          const slot = this.particleSlots.get(p.txn.id);
          if (!slot) {
            p.v = 0;
            return;
          }
          p.v = 1;
          p.A = null;
          p.pt = null;
          p.x = dv.x;
          p.y = dv.y;
          p.w = Math.max(4, dv.s * 0.45);
          p.h = Math.max(4, dv.s * 0.45);
          p.sc = 1;
          grid.setColorImmediate(p, [dv.r, dv.g, dv.b]);

          const [tx, ty, ts] = slot;
          const dl = dv.day.week_index * 0.01 + ((idx % 13) / 13) * 0.12;
          const d = 0.48 + ((idx % 9) / 9) * 0.14;
          const arc = (idx % 2 === 0 ? -1 : 1) * (0.08 + ((idx % 7) / 7) * 0.14);
          const catRgb = hexToRgb(CATEGORY_COLORS[p.txn.category] ?? '#F4F03A');

          grid.flyParticle(p, tx, ty, d, dl, arc, EASE.inOut3, (pp) => {
            grid.popVisual(pp, 0.3);
          });
          grid.tweenProp(p, 'w', ts, d, dl, EASE.inOut3);
          grid.tweenProp(p, 'h', ts, d, dl, EASE.inOut3);
          grid.tweenColor(p, catRgb, d * 0.6, dl + 0.06);
        });

        grid.days.forEach((v) => {
          v.k = 0;
          if (v.A) delete v.A.k;
        });
      },
      [],
      breakAt
    );

    // 2) Hold in category columns and animate labels/odometers
    tl.call(
      () => {
        this.phase = 2;
        timeline.logEvent('shatter.hold', {
          columns: this.columns.map((c) => Math.round(c.totalMinor / 100)),
        });
      },
      [],
      breakAt + 1.3
    );

    if (laterEls.length) {
      tl.set(laterEls, { autoAlpha: 1 }, breakAt + 0.95);
      enterStageGroup(laterEls, tl, breakAt + 0.95, false);
    }

    // 3) Only snap back automatically when in automated film / loop capture mode (body.film)
    // In interactive mode, keep the shattered columns & receipts interactive until the user clicks Next
    const isFilmMode = typeof document !== 'undefined' && document.body.classList.contains('film');
    if (isFilmMode) {
      tl.to(laterEls, { autoAlpha: 0, duration: MOTION_TOKENS.tr.textOut }, breakAt + 4.2);
      tl.call(
        () => {
          this.phase = 3;
          timeline.logEvent('shatter.snap', this.particleSlots.size);
          if (!grid) return;
          grid.particles.forEach((p, idx) => {
            if (!p.v) return;
            const dv = grid.days[p.dayIndex] ?? grid.days[0];
            if (!dv) return;
            const dl = (52 - dv.day.week_index) * 0.005 + ((idx % 11) / 11) * 0.09;
            const d = 0.44 + ((idx % 7) / 7) * 0.1;
            const arc = (idx % 2 === 0 ? -1 : 1) * 0.08;
            const baseRgb = grid.getBaseColor(dv.index);
            grid.flyParticle(p, dv.x, dv.y, d, dl, arc, EASE.spring, (pp) => {
              pp.v = 0;
              dv.k = 1;
              grid.setColorImmediate(dv, baseRgb);
              grid.popVisual(dv, 0.22);
            });
            grid.tweenProp(p, 'w', dv.s * 0.45, d * 0.8, dl);
            grid.tweenProp(p, 'h', dv.s * 0.45, d * 0.8, dl);
            grid.tweenColor(p, baseRgb, d * 0.6, dl);
          });
        },
        [],
        breakAt + 4.4
      );

      tl.call(
        () => {
          this.finishShatterImmediately();
        },
        [],
        breakAt + 5.3
      );
    }
  }

  private placeParticlesInSlotsImmediate(grid: InteractiveGrid): void {
    grid.days.forEach((v) => {
      v.k = 0;
    });
    grid.activateParticles();
    grid.particles.forEach((p) => {
      const slot = this.particleSlots.get(p.txn.id);
      if (!slot) {
        p.v = 0;
        return;
      }
      p.v = 1;
      p.x = slot[0];
      p.y = slot[1];
      p.w = slot[2];
      p.h = slot[2];
      p.sc = 1;
      p.A = null;
      p.F = null;
      grid.setColorImmediate(p, hexToRgb(CATEGORY_COLORS[p.txn.category] ?? '#F4F03A'));
    });
  }

  private finishShatterImmediately(): void {
    this.phase = 0;
    const grid = this.ctx?.grid;
    if (grid) {
      grid.hideAllParticles();
      grid.resetToBaseColors(true);
    }
  }

  public explore(): void {
    this.finishShatterImmediately();
    this.ctx?.openExplore();
  }

  public unmount(): void {
    this.finishShatterImmediately();
    if (this.container) {
      this.container.innerHTML = '';
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
