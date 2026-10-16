import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { formatMoneyMinor } from '../../../contracts/index.js';
import { EASE, GRID_PRESETS, RGB_PALETTE, formatDayLabel } from '../../grid/interactive-grid.js';
import { buildSweepTimeRemap, type SweepTimeRemap } from '../../grid/scrub-bar.js';
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

function pickFact(ctx: ChapterContext, ids: string[], fallbackIdx = 0): Fact {
  for (const id of ids) {
    const f = ctx.facts.get(id);
    if (f) return f;
  }
  const fb = ctx.chapter.fact_ids[fallbackIdx] ?? ctx.chapter.fact_ids[0];
  if (fb && ctx.facts.has(fb)) return ctx.facts.get(fb)!;
  return (
    ctx.facts.values().next().value ?? {
      id: 'fallback',
      label: 'Total',
      value: 0,
      unit: 'usd_cents',
      formatted: '$0',
      txn_ids: [],
      computation: '',
    }
  );
}

export class SquaresChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private remap: SweepTimeRemap | null = null;
  private sweepState = {
    t: 0,
    lastDay: -1,
    paydaysSeen: 0,
    bestSpendMinor: 0,
    monthSeen: -1,
    weekSeen: -1,
  };

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;
    const grid = this.ctx.grid;

    const spendFact = pickFact(ctx, ['total_spend_usd', 'total_discretionary_spend'], 0);
    const paydayFact = pickFact(ctx, ['payday_count'], 1);
    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const isB2B = Boolean(ctx.plan.business_meta);
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const milestoneLabel = this.escapeHtml(
      ctx.chapter.params.blocks?.[0]?.label ?? ctx.plan.business_meta?.milestone_label ?? 'Paydays'
    );
    const loudestLabel = this.escapeHtml(
      ctx.chapter.params.blocks?.[1]?.label ?? (isB2B ? 'Peak day so far' : 'Loudest day so far')
    );
    const runningPrefix = isB2B ? 'Outflow YTD' : 'Spent so far';

    this.remap = buildSweepTimeRemap(
      ctx.days,
      grid ? grid.p95Minor : 8000,
      7.2,
      MOTION_TOKENS.beat
    );

    const weekDurations = new Array<number>(53).fill(0);
    ctx.days.forEach((d, i) => {
      const dt = (this.remap!.times[i + 1] ?? 0) - (this.remap!.times[i] ?? 0);
      weekDurations[d.week_index] = (weekDurations[d.week_index] ?? 0) + dt;
    });
    const maxWeekDur = Math.max(0.01, ...weekDurations);
    const remapBarsSvg = weekDurations
      .map((v, c) => {
        const h = (v / maxWeekDur) * 40;
        return `<rect class="remap-bar" x="${c * 32}" y="${(44 - h).toFixed(1)}" width="28" height="${h.toFixed(1)}" fill="#3A3A38"/>`;
      })
      .join('');

    const gridAnnoHtml = grid
      ? grid.renderAnnotationsHtml(GRID_PRESETS.sweep, {
          legend: true,
          ribbon: false,
          note: 'squares fill as the playhead passes',
        })
      : '';

    const spendDigits = spendFact.formatted.replace(/^(?:US\$|€|£|¥|₹|CA\$|A\$|CHF\s*|\$)/, '');

    container.innerHTML = `
      <div class="num gh" style="position:absolute;right:-30px;top:-210px;font-size:880px;color:var(--ghost, #1C1C1B);pointer-events:none"><span id="mghost">01</span></div>
      <div class="lab tx" data-testid="chapter-kicker" style="position:absolute;left:52px;top:92px">${this.escapeHtml(ctx.chapter.params.kicker ?? '02 · THE YEAR AS SQUARES')}</div>
      <div class="num tx" data-testid="sweep-running-total" style="position:absolute;left:52px;top:132px;font-size:196px"><sup>${currencySup}</sup><span id="swtot">${this.escapeHtml(spendDigits)}</span></div>
      <div class="ch-header-stack" style="left:52px;top:346px;max-width:920px;max-height:120px;gap:8px">
        <div class="lab tx" id="swdate" data-testid="chapter-headline">${runningPrefix} · day 001 / ${ctx.days.length} · ${this.escapeHtml(headlineText)}</div>
        <div class="tx" data-testid="chapter-body" style="max-width:920px;font-size:15px;line-height:1.32;color:#F3F0E6;background:#1C1C1B;border-left:3px solid #F4F03A;padding:8px 14px">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
      </div>
      <div class="blk ia" data-ax="b" id="swpay" data-testid="sweep-paydays-block" style="position:absolute;left:1440px;top:110px;width:416px;height:245px;background:var(--c4);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center">
          <span>${milestoneLabel}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(paydayFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="num tx" style="position:absolute;left:22px;bottom:18px;font-size:140px"><span id="swpayn">${this.escapeHtml(paydayFact.formatted)}</span><sup class="aft">/${this.escapeHtml(paydayFact.formatted)}</sup></div>
      </div>
      <div class="blk ia" data-ax="b" id="swloud" data-testid="sweep-loudest-block" style="position:absolute;left:1024px;top:205px;width:400px;height:150px;background:var(--c2);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:20px;top:16px;right:16px;font-size:12px;display:flex;justify-content:space-between;align-items:center">
          <span>${loudestLabel}</span>
          <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(spendFact.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 6px;border:1px solid #111;cursor:pointer;flex-shrink:0">Receipts</button>
        </div>
        <div class="tx" id="swloudv" style="position:absolute;left:20px;bottom:18px;font-size:${isB2B ? 28 : 32}px;font-weight:300;letter-spacing:-0.03em;white-space:nowrap;max-width:348px;overflow:hidden;text-overflow:ellipsis">—</div>
      </div>
      ${gridAnnoHtml}
      <div class="dt" id="remap" style="position:absolute;left:${GRID_PRESETS.sweep.x}px;top:${GRID_PRESETS.sweep.y + 6 * 32 + 28 + 52}px">
        <svg width="${53 * 32}" height="46" style="display:block">${remapBarsSvg}</svg>
        <div class="lab" style="position:static;font-size:11px;margin-top:6px">Weekly outflow intensity</div>
      </div>
      <div class="dt" id="ph" style="position:absolute;left:0;top:${GRID_PRESETS.sweep.y - 44}px;height:${7 * 32 + 62}px;width:2px;background:var(--bone);pointer-events:none">
        <div class="lab" id="phl" style="position:absolute;left:-1px;top:-6px;transform:translateX(-50%);background:var(--bone);color:var(--ink);padding:4px 8px;font-size:12px;white-space:nowrap">1 JAN</div>
      </div>
    `;

    initOdometers(container);

    container.querySelectorAll<HTMLButtonElement>('.receipt-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = btn.dataset.factId;
        if (fid && ctx.facts.has(fid)) {
          const f = ctx.facts.get(fid)!;
          ctx.openReceipts(`${f.label} (${f.formatted})`, f.txn_ids);
        } else {
          ctx.openReceipts(headlineText, ctx.chapter.txn_ids);
        }
      });
    });
  }

  public play(timeline: TimelineController): void {
    if (!this.container || !this.ctx || !this.remap) return;
    const tl = (timeline as PlayerTimelineController).gsapTimeline ?? gsap.timeline();
    const rm = timeline.isReducedMotion();
    const grid = this.ctx.grid;

    this.sweepState = {
      t: 0,
      lastDay: -1,
      paydaysSeen: 0,
      bestSpendMinor: 0,
      monthSeen: -1,
      weekSeen: -1,
    };

    if (grid) {
      grid.hideAllParticles();
      grid.setGridGeometry(GRID_PRESETS.sweep, { dur: 0.45 });
      if (rm) {
        grid.resetToBaseColors(true);
      } else {
        grid.days.forEach((v) => {
          grid.tweenProp(v, 'k', 0.45, 0.25, v.day.week_index * 0.003);
          grid.tweenColor(v, RGB_PALETTE.empty, 0.25, v.day.week_index * 0.003);
        });
      }
    }

    const endEnter = enterStageGroup(this.container, tl, 0, rm);
    const startSweepAt = Math.ceil(endEnter / MOTION_TOKENS.beat) * MOTION_TOKENS.beat;

    if (rm) {
      this.finishSweepImmediately();
      return;
    }

    const swTotEl = this.container.querySelector<HTMLElement>('#swtot');
    const swPayEl = this.container.querySelector<HTMLElement>('#swpayn');
    const phEl = this.container.querySelector<HTMLElement>('#ph');
    if (swTotEl) swTotEl.textContent = '0';
    if (swPayEl) swPayEl.textContent = '0';
    if (phEl) {
      const firstWeekday = this.ctx.days[0]?.weekday ?? 2;
      gsap.set(phEl, {
        autoAlpha: 1,
        x: GRID_PRESETS.sweep.x + (firstWeekday / 7) * GRID_PRESETS.sweep.p,
      });
    }

    const totalDur = this.remap.totalDuration;
    tl.call(() => timeline.logEvent('sweep.start', totalDur), [], startSweepAt);
    tl.to(
      this.sweepState,
      {
        t: totalDur,
        duration: totalDur,
        ease: 'none',
        onUpdate: () => this.stepSweep(timeline),
      },
      startSweepAt
    );
    if (phEl) {
      tl.to(phEl, { autoAlpha: 0, duration: 0.25 }, startSweepAt + totalDur + 0.1);
    }
  }

  private stepSweep(timeline: TimelineController): void {
    if (!this.container || !this.ctx || !this.remap) return;
    const grid = this.ctx.grid;
    const dFloat = this.remap.dayAtTime(this.sweepState.t);
    const maxIdx = Math.min(this.ctx.days.length - 1, Math.floor(dFloat));

    const swTotEl = this.container.querySelector<HTMLElement>('#swtot');
    const swDateEl = this.container.querySelector<HTMLElement>('#swdate');
    const swPayEl = this.container.querySelector<HTMLElement>('#swpayn');
    const swLoudEl = this.container.querySelector<HTMLElement>('#swloudv');
    const mGhostEl = this.container.querySelector<HTMLElement>('#mghost');
    const phEl = this.container.querySelector<HTMLElement>('#ph');
    const phlEl = this.container.querySelector<HTMLElement>('#phl');
    const remapBars = Array.from(this.container.querySelectorAll<SVGElement>('.remap-bar'));

    while (this.sweepState.lastDay < maxIdx) {
      this.sweepState.lastDay++;
      const i = this.sweepState.lastDay;
      const d = this.ctx.days[i]!;
      const dv = grid?.days[i];

      if (grid && dv) {
        if (dv.A) delete dv.A.k;
        dv.k = 0.45;
        grid.tweenProp(dv, 'k', 1, MOTION_TOKENS.spring.settle, 0, EASE.spring);
        grid.setColorImmediate(dv, RGB_PALETTE.bone);
        grid.tweenColor(dv, grid.getBaseColor(i), 0.26, 0.04);
        grid.popVisual(dv, 0.08 + 0.45 * Math.min(1, d.discretionary_out_minor / grid.p97Minor));
      }

      if (d.is_payday) {
        this.sweepState.paydaysSeen++;
        if (swPayEl) {
          swPayEl.textContent = String(this.sweepState.paydaysSeen);
        }
        if (grid && dv) {
          grid.addRing(dv.x, dv.y, { r1: 110, d: 0.7 });
          grid.addRing(dv.x, dv.y, { r1: 70, d: 0.5, delay: 0.1, lw: 1.5 });
        }
        const swPayBlock = this.container.querySelector('#swpay');
        if (swPayBlock) {
          gsap.fromTo(
            swPayBlock,
            { backgroundColor: '#F4F03A' },
            { backgroundColor: '#FF5A14', duration: 0.42, ease: 'power2.out' }
          );
        }
        timeline.logEvent('sweep.payday', {
          day: formatDayLabel(d),
          spend: +(d.discretionary_out_minor / 100).toFixed(2),
        });
      }

      if (d.discretionary_out_minor > this.sweepState.bestSpendMinor) {
        this.sweepState.bestSpendMinor = d.discretionary_out_minor;
        if (swLoudEl) {
          const currencySup = this.ctx.plan.business_meta?.currency_symbol ?? 'US$';
          swLoudEl.textContent = `${formatDayLabel(d)} · ${currencySup}${formatMoneyMinor(d.discretionary_out_minor, { showCents: false, prefix: '' })}`;
        }
      }

      const m = parseInt(d.date.slice(5, 7), 10) - 1;
      if (m !== this.sweepState.monthSeen) {
        this.sweepState.monthSeen = m;
        if (mGhostEl) {
          mGhostEl.textContent = String(m + 1).padStart(2, '0');
        }
      }

      if (d.week_index !== this.sweepState.weekSeen) {
        this.sweepState.weekSeen = d.week_index;
        for (let c = 0; c <= d.week_index; c++) {
          remapBars[c]?.setAttribute('fill', '#F3F0E6');
        }
      }
    }

    const firstWeekday = this.ctx.days[0]?.weekday ?? 2;
    const totalDays = this.ctx.days.length;
    const x =
      GRID_PRESETS.sweep.x +
      ((Math.min(dFloat, totalDays) + firstWeekday) / 7) * GRID_PRESETS.sweep.p;
    if (phEl) {
      phEl.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    }

    const curDay = this.ctx.days[maxIdx];
    if (curDay) {
      const m = parseInt(curDay.date.slice(5, 7), 10) - 1;
      const dom = parseInt(curDay.date.slice(8, 10), 10);
      if (phlEl) {
        phlEl.textContent = `${dom} ${MONTH_UPPER[m] ?? 'JAN'}`;
      }
      if (swDateEl) {
        const prefix = this.ctx.plan.business_meta ? 'Outflow YTD' : 'Spent so far';
        swDateEl.textContent = `${prefix} · day ${String(maxIdx + 1).padStart(3, '0')} / ${totalDays} · ${formatDayLabel(curDay)}`;
      }
      if (grid && swTotEl) {
        const cumMinor = grid.cumulativeSpendMinor[maxIdx + 1] ?? 0;
        swTotEl.textContent = formatMoneyMinor(cumMinor, { showCents: false, prefix: '' });
      }
    }
  }

  private finishSweepImmediately(): void {
    if (!this.container || !this.ctx) return;
    const grid = this.ctx.grid;
    if (grid) {
      grid.resetToBaseColors(true);
      const topDay = grid.days[grid.topDayIndex];
      const swLoudEl = this.container.querySelector<HTMLElement>('#swloudv');
      if (topDay && swLoudEl) {
        const currencySup = this.ctx.plan.business_meta?.currency_symbol ?? 'US$';
        swLoudEl.textContent = `${formatDayLabel(topDay.day)} · ${currencySup}${formatMoneyMinor(topDay.day.discretionary_out_minor, { showCents: false, prefix: '' })}`;
      }
    }
  }

  public explore(): void {
    this.finishSweepImmediately();
    this.ctx?.openExplore();
  }

  public unmount(): void {
    this.finishSweepImmediately();
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
