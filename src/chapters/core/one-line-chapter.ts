import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { GRID_PRESETS } from '../../grid/interactive-grid.js';
import {
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from './pour-chapter.js';

export class OneLineChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const oneLineText = ctx.resolveCopy(ctx.plan.one_line || ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const isB2B = Boolean(ctx.plan.business_meta);
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const headlineFontSize = oneLineText.length > 180 ? 44 : oneLineText.length > 120 ? 50 : 58;

    const referencedFacts = ctx.chapter.fact_ids
      .map((id) => ctx.facts.get(id))
      .filter((f): f is Fact => f !== undefined);

    const factPillsHtml = referencedFacts
      .map(
        (f) =>
          `<button type="button" class="chip receipt-trigger" data-fact-id="${this.escapeHtml(f.id)}" style="border-color:#111;color:#111;background:#F3F0E6;cursor:pointer;pointer-events:auto;">
            <span>${this.escapeHtml(f.label)}: <b>${this.escapeHtml(f.formatted)}</b></span>
            <span style="font-size:10px;opacity:0.7">Receipts (${f.txn_ids.length})</span>
          </button>`
      )
      .join('');

    container.innerHTML = `
      <div class="blk ia" data-ax="b" id="one-line-hero-block" data-testid="one-line-hero-block" style="position:absolute;left:64px;top:84px;width:1792px;height:616px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;display:flex;flex-direction:column;justify-content:space-between;padding:36px 40px 28px;box-sizing:border-box;">
        <div class="ch-header-stack" style="position:static;flex:1;justify-content:space-between;width:100%;gap:16px">
          <div style="display:flex;flex-direction:column;gap:16px;width:100%">
            <div class="lab tx" data-testid="chapter-kicker" style="position:static;max-width:none">${this.escapeHtml(ctx.chapter.params.kicker ?? 'YOUR ONE LINE')}</div>
            <div class="tx" data-testid="chapter-headline" style="position:static;font-size:${headlineFontSize}px;font-weight:300;letter-spacing:-0.035em;line-height:1.08">${this.escapeHtml(oneLineText)}</div>
          </div>
          <div class="tx" data-testid="chapter-body" style="position:static;width:100%;font-size:16px;line-height:1.35;background:#111111;color:#F3F0E6;border-left:4px solid #FF5A14;padding:12px 18px;margin-top:auto">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
        </div>
        <div class="tx" style="position:static;display:flex;gap:8px 10px;flex-wrap:wrap;margin-top:16px">${factPillsHtml}</div>
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
          ctx.openReceipts('Your One Line — Receipts', ctx.chapter.txn_ids);
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
      grid.hideAllParticles();
      grid.setGridGeometry(GRID_PRESETS.ask, { dur: 0.45 });
      grid.resetToBaseColors();
    }

    enterStageGroup(this.container, tl, 0, rm);
    timeline.logEvent('one_line.play');
  }

  public explore(): void {
    this.ctx?.openExplore();
  }

  public unmount(): void {
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
