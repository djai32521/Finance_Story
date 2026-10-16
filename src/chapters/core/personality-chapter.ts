import gsap from 'gsap';
import type {
  Category,
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { getCategoryDisplayLabel } from '../../../contracts/index.js';
import {
  CATEGORY_COLORS,
  DISPLAY_CATEGORIES,
  EASE,
  GRID_PRESETS,
} from '../../grid/interactive-grid.js';
import {
  MOTION_TOKENS,
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from './pour-chapter.js';

const MONTH_UPPER = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

export class PersonalityChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private shapeCanvas: HTMLCanvasElement | null = null;
  private shapeState = {
    ring: 0,
    bars: 0,
    spk: 0,
    petals: new Array<number>(8).fill(0),
  };
  private categoryShares: Array<{ label: string; color: string; share: number; radius: number }> =
    [];

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const titleText = ctx.resolveCopy(ctx.plan.personality.title || ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body || ctx.plan.personality.subtitle)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const takeawayPrefix = `${ctx.plan.business_meta ? 'EXECUTIVE TAKEAWAY' : 'KEY TAKEAWAY'} FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const isB2B = Boolean(ctx.plan.business_meta);
    const hasCustomCats = Boolean(ctx.plan.category_labels);
    const ratioFact: Fact =
      ctx.facts.get(ctx.plan.personality.payday_spike_ratio_fact_id) ??
      ctx.facts.get('payday_spike_ratio') ??
      ctx.facts.values().next().value!;

    const outTxns = ctx.allTransactions.filter((t) => t.direction === 'out' && !t.is_transfer);
    const totalOutMinor = Math.max(
      1,
      outTxns.reduce((acc, t) => acc + t.amount_minor, 0)
    );

    const buildCatShare = (catKey: Category) => {
      const sum = outTxns
        .filter((t) => t.category === catKey)
        .reduce((acc, t) => acc + t.amount_minor, 0);
      const rawLabel = getCategoryDisplayLabel(catKey, ctx.plan.category_labels, isB2B);
      const defaultLabel =
        DISPLAY_CATEGORIES.find((d) => d.key === catKey)?.label ??
        catKey.charAt(0).toUpperCase() + catKey.slice(1);
      return {
        key: catKey,
        label: rawLabel !== catKey ? rawLabel : defaultLabel,
        color: CATEGORY_COLORS[catKey] ?? '#F4F03A',
        share: sum / totalOutMinor,
      };
    };

    const allNonZeroCatKeys = Array.from(new Set(outTxns.map((t) => t.category)));
    const candidateShares =
      isB2B || hasCustomCats
        ? allNonZeroCatKeys
            .map(buildCatShare)
            .filter((c) => c.share > 0)
            .sort((a, b) => b.share - a.share)
        : DISPLAY_CATEGORIES.map((dc) => buildCatShare(dc.key))
            .filter((c) => c.share > 0)
            .sort((a, b) => b.share - a.share);

    if (candidateShares.length < 8) {
      const seen = new Set(candidateShares.map((c) => c.key));
      const extraNonZero = allNonZeroCatKeys
        .filter((k) => !seen.has(k))
        .map(buildCatShare)
        .filter((c) => c.share > 0)
        .sort((a, b) => b.share - a.share);
      for (const spec of extraNonZero) {
        if (candidateShares.length >= 8) break;
        seen.add(spec.key);
        candidateShares.push(spec);
      }
      for (const dc of DISPLAY_CATEGORIES.slice(0, 8)) {
        if (candidateShares.length >= 8) break;
        if (!seen.has(dc.key)) {
          seen.add(dc.key);
          candidateShares.push(buildCatShare(dc.key));
        }
      }
    }

    const catTotals = candidateShares.sort((a, b) => b.share - a.share).slice(0, 8);

    const maxShare = Math.max(0.01, ...catTotals.map((c) => c.share));
    this.categoryShares = catTotals.map((c) => ({
      ...c,
      radius: 170 * Math.sqrt(c.share / maxShare),
    }));

    const legendHtml = this.categoryShares
      .map(
        (c) =>
          `<div class="lab dt" style="position:static;font-size:11.5px;display:flex;gap:8px;align-items:center;color:var(--ink)">
            <i style="width:13px;height:13px;background:${c.color};display:block;outline:1px solid #111;flex-shrink:0"></i>${this.escapeHtml(c.label)}
          </div>`
      )
      .join('');

    const totalDays = Math.max(1, ctx.days.length);
    const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const monthsHtml = monthStarts
      .map((s, m) => {
        const a = -Math.PI / 2 + ((s + 15) / 365) * Math.PI * 2;
        const x = (370 + Math.cos(a) * 344).toFixed(1);
        const y = (370 + Math.sin(a) * 344).toFixed(1);
        return `<div class="lab dt" style="position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);font-size:11px;color:var(--ink)">${MONTH_UPPER[m]}</div>`;
      })
      .join('');

    const ratioDigits = ratioFact.formatted.replace(/×$/, '');
    const splitTitle =
      titleText.length > 26
        ? this.escapeHtml(titleText)
        : this.escapeHtml(titleText).replace(/\s+([^\s]+)$/, '<br>$1');
    const titleFontSize = titleText.length > 28 ? 68 : titleText.length > 20 ? 84 : 98;
    const youAreLabel = isB2B ? 'OPERATING PROFILE' : 'YOU ARE';
    const sprintsLabel = isB2B
      ? 'Operating cycles · settlements in orange'
      : 'The sprints · paydays in orange';
    const ratioBlockLabel =
      ctx.chapter.params.blocks?.[0]?.label ??
      (isB2B ? 'Post-settlement vs baseline' : 'Payday vs normal');
    const takeawayDisplay = isB2B ? '' : takeawayPrefix;

    container.innerHTML = `
      <div class="lab tx" style="position:absolute;left:60px;top:92px">${this.escapeHtml(ctx.chapter.params.kicker ?? '05 · YOUR MONEY PERSONALITY')}</div>
      <div class="ch-header-stack" style="left:60px;top:172px;max-width:860px;max-height:540px;gap:14px">
        <div class="lab tx" style="font-size:16px">${youAreLabel}</div>
        <div class="split tx" data-testid="chapter-headline" style="font-size:${titleFontSize}px;font-weight:300;letter-spacing:-0.045em;line-height:1.04;max-width:860px">${splitTitle}</div>
        <div class="tx" data-testid="chapter-body" style="max-width:840px;font-size:16px;line-height:1.35;color:#F3F0E6;background:#1C1C1B;border-left:4px solid #F4F03A;padding:12px 18px">${takeawayDisplay ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayDisplay}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
      </div>
      <div class="lab dt" style="position:absolute;left:64px;top:836px;font-size:12px">${sprintsLabel}</div>

      <div class="blk" data-ax="r" id="pshape" data-testid="personality-shape-block" style="position:absolute;left:980px;top:68px;width:876px;height:944px;background:var(--bone);color:var(--ink);transform-origin:100% 50%">
        <div class="lab dt" style="position:absolute;left:28px;top:18px;font-size:12px;color:var(--ink)">${totalDays} days, clockwise from Jan · Inner petals = category mix</div>
        <div style="position:absolute;left:68px;top:52px;width:740px;height:740px;">
          <canvas id="pc" width="740" height="740" style="position:absolute;left:0;top:0;width:740px;height:740px"></canvas>
          ${monthsHtml}
        </div>
        <div style="position:absolute;left:40px;right:40px;bottom:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px 14px;">
          ${legendHtml}
        </div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="personality-ratio-block" style="position:absolute;left:616px;top:760px;width:304px;height:210px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:22px;top:18px;right:18px;font-size:12px;display:flex;justify-content:space-between;align-items:center">
          <span>${this.escapeHtml(ratioBlockLabel)}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(ratioFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 6px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:18px;bottom:14px;font-size:108px"><span class="od" data-v="${this.escapeHtml(ratioDigits)}">${this.escapeHtml(ratioDigits)}</span><sup class="aft">×</sup></div>
      </div>
    `;

    initOdometers(container);
    this.shapeCanvas = container.querySelector<HTMLCanvasElement>('#pc');

    container.querySelector('.receipt-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.openReceipts(`${ratioFact.label} (${ratioFact.formatted})`, ratioFact.txn_ids);
    });
  }

  public play(timeline: TimelineController): void {
    if (!this.container || !this.ctx) return;
    const tl = (timeline as PlayerTimelineController).gsapTimeline ?? gsap.timeline();
    const rm = timeline.isReducedMotion();
    const grid = this.ctx.grid;

    if (grid) {
      grid.hideAllParticles();
      grid.setGridGeometry(GRID_PRESETS.mini, { dur: 0.5, st: 0.002 });
      grid.resetToBaseColors();
    }

    this.shapeState.ring = 0;
    this.shapeState.bars = 0;
    this.shapeState.spk = 0;
    this.shapeState.petals = new Array<number>(8).fill(0);

    enterStageGroup(this.container, tl, 0, rm);

    if (rm) {
      this.shapeState.ring = 1;
      this.shapeState.bars = 1;
      this.shapeState.spk = 1;
      this.shapeState.petals = new Array<number>(8).fill(1);
      this.drawRadialPoster();
      return;
    }

    const d0 = 0.65;
    tl.call(() => timeline.logEvent('personality.shape', this.categoryShares.length), [], d0);
    tl.to(
      this.shapeState,
      {
        ring: 1,
        duration: 0.9,
        ease: 'power2.inOut',
        onUpdate: () => this.drawRadialPoster(),
      },
      d0
    );
    tl.to(
      this.shapeState,
      {
        bars: 1,
        duration: 1.6,
        ease: 'none',
        onUpdate: () => this.drawRadialPoster(),
      },
      d0 + 0.15
    );
    this.categoryShares.forEach((_, k) => {
      const proxy = { v: 0 };
      tl.to(
        proxy,
        {
          v: 1,
          duration: MOTION_TOKENS.spring.settle + 0.1,
          ease: EASE.spring,
          onUpdate: () => {
            this.shapeState.petals[k] = proxy.v;
            this.drawRadialPoster();
          },
        },
        d0 + 0.4 + k * 0.11
      );
    });
    tl.to(
      this.shapeState,
      {
        spk: 1,
        duration: 0.35,
        ease: EASE.spring,
        onUpdate: () => this.drawRadialPoster(),
      },
      d0 + 1.75
    );
  }

  private drawRadialPoster(): void {
    if (!this.shapeCanvas || !this.ctx) return;
    const c = this.shapeCanvas.getContext('2d');
    if (!c) return;

    const cx = 370;
    const cy = 370;
    const R0 = 188;
    const RR = 316;
    const TAU = Math.PI * 2;
    c.clearRect(0, 0, 740, 740);

    // 1. Inner category petals
    this.categoryShares.forEach((ct, k) => {
      const r = ct.radius * (this.shapeState.petals[k] ?? 0);
      if (r < 1) return;
      const a0 = -Math.PI / 2 + (k * TAU) / 8 + 0.014;
      const a1 = a0 + TAU / 8 - 0.028;
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, r, a0, a1);
      c.closePath();
      c.fillStyle = ct.color;
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = '#111111';
      c.stroke();
    });

    // 2. Daily radial bars
    const totalDays = Math.max(1, this.ctx.days.length);
    const maxDayMinor = Math.max(100, ...this.ctx.days.map((d) => d.discretionary_out_minor));
    const n = Math.floor(this.shapeState.bars * this.ctx.days.length);
    c.lineWidth = 2;
    c.strokeStyle = '#111111';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const d = this.ctx.days[i]!;
      if (d.is_payday) continue;
      const a = -Math.PI / 2 + ((i + 0.5) / totalDays) * TAU;
      const l = 5 + 74 * Math.sqrt(Math.max(0, d.discretionary_out_minor) / maxDayMinor);
      c.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
      c.lineTo(cx + Math.cos(a) * (R0 + l), cy + Math.sin(a) * (R0 + l));
    }
    c.stroke();

    // 3. Payday spikes in orange
    c.strokeStyle = '#FF5A14';
    c.lineWidth = 6;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const d = this.ctx.days[i]!;
      if (!d.is_payday) continue;
      const a = -Math.PI / 2 + ((i + 0.5) / totalDays) * TAU;
      const baseL = 5 + 74 * Math.sqrt(Math.max(0, d.discretionary_out_minor) / maxDayMinor);
      const l = baseL * (0.4 + 0.6 * this.shapeState.spk) + 32 * this.shapeState.spk;
      c.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
      c.lineTo(cx + Math.cos(a) * (R0 + l), cy + Math.sin(a) * (R0 + l));
    }
    c.stroke();

    // 4. Outer & inner rings
    if (this.shapeState.ring > 0) {
      c.lineWidth = 1.5;
      c.strokeStyle = '#111111';
      c.beginPath();
      c.arc(cx, cy, RR, -Math.PI / 2, -Math.PI / 2 + this.shapeState.ring * TAU);
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, R0 - 10, -Math.PI / 2, -Math.PI / 2 + this.shapeState.ring * TAU);
      c.stroke();
    }

    c.fillStyle = '#111111';
    c.fillRect(cx - 4, cy - 4, 8, 8);
  }

  public explore(): void {
    this.ctx?.openExplore();
  }

  public unmount(): void {
    if (this.ctx?.grid) {
      this.ctx.grid.resetToBaseColors(true);
    }
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
