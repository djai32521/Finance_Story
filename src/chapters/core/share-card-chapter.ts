import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  TimelineController,
} from '../../../contracts/index.js';
import { ShareExporter, type ShareCardSize } from '../../explore/share-exporter.js';
import { GRID_PRESETS } from '../../grid/interactive-grid.js';
import {
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from './pour-chapter.js';

export class ShareCardChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private activeSize: ShareCardSize = '1080x1350';

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
    const exploreCtaLabel = isB2B ? 'EXPLORE LEDGER →' : 'EXPLORE YOUR YEAR →';
    const askCtaLabel = isB2B ? 'ASK AI ANALYST' : 'ASK YOUR YEAR';

    container.innerHTML = `
      <div class="ch-header-stack" style="left:60px;top:92px;max-width:820px;max-height:290px">
        <div class="lab tx">${this.escapeHtml(ctx.chapter.params.kicker ?? 'SHARE YOUR YEAR')}</div>
        <div class="split tx" data-testid="chapter-headline" style="max-width:820px;font-size:70px;font-weight:300;letter-spacing:-0.045em;line-height:1.04">${this.escapeHtml(headlineText)}</div>
        <div class="tx" data-testid="chapter-body" style="max-width:780px;font-size:16px;line-height:1.35;color:${isB2B ? '#C9C5BA' : '#F3F0E6'};${isB2B ? '' : 'background:#1C1C1B;border-left:4px solid #F4F03A;padding:12px 18px'}">${takeawayPrefix ? `<strong style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#F4F03A;margin-right:8px">${takeawayPrefix}</strong>` : ''}${this.escapeHtml(bodyText)}</div>
      </div>

      <div class="blk ia" data-ax="b" data-testid="end-cta-block" style="position:absolute;left:64px;top:424px;width:780px;height:380px;background:var(--c1);color:var(--ink);transform-origin:50% 100%;pointer-events:auto;padding:36px">
        <div class="lab tx" style="position:static;font-size:12px">WHAT NEXT · INTERACTIVE MODE</div>
        <div class="tx" style="position:static;font-size:46px;font-weight:300;letter-spacing:-0.03em;margin-top:12px;line-height:1.08">Dive into every day, category, and receipt.</div>
        <div class="tx" style="position:static;display:flex;gap:16px;flex-wrap:wrap;margin-top:34px">
          <button type="button" class="btn primary mag" id="end-explore-cta" data-testid="end-explore-cta" style="font-size:15px;padding:18px 30px;background:#111;color:#F3F0E6;border:2px solid #111;cursor:pointer;">${exploreCtaLabel}</button>
          <button type="button" class="btn mag" id="end-ask-cta" data-testid="end-ask-cta" style="font-size:14px;padding:18px 24px;border:2px solid #111;color:#111;cursor:pointer;">${askCtaLabel}</button>
          <button type="button" class="btn" id="end-replay-btn" data-testid="end-replay-btn" style="font-size:13px;padding:18px 22px;border:1.5px solid #111;color:#111;cursor:pointer;">↻ REPLAY STORY</button>
        </div>
        <div class="tx" style="position:static;display:flex;gap:12px;margin-top:24px;align-items:center">
          <button type="button" class="btn" id="dl-1350-btn" data-testid="export-1080x1350-btn" style="padding:10px 16px;border:1.5px solid #111;color:#111;font-size:11px;cursor:pointer;">⬇ PNG 1080 × 1350 (4:5)</button>
          <button type="button" class="btn" id="dl-1920-btn" data-testid="export-1080x1920-btn" style="padding:10px 16px;border:1.5px solid #111;color:#111;font-size:11px;cursor:pointer;">⬇ PNG 1080 × 1920 (9:16)</button>
          <button type="button" class="btn" id="share-receipts-btn" style="padding:10px 16px;border:1.5px solid #111;color:#111;font-size:11px;cursor:pointer;">Receipts (${ctx.chapter.txn_ids.length})</button>
        </div>
      </div>

      <div class="blk ia" data-ax="r" id="share-preview-wrap" data-testid="share-card-preview" style="position:absolute;left:940px;top:64px;width:916px;height:952px;background:#191918;border:2px solid var(--bone);transform-origin:100% 50%;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto;">
        <div class="lab tx" style="position:absolute;left:28px;top:20px;color:var(--bone);font-size:11px">SUMMARY CARD PREVIEW · HIGH-RESOLUTION EXPORT</div>
        <canvas id="share-preview-canvas" width="1080" height="1350" style="width:620px;height:775px;border:1.5px solid #3A3A38;margin-top:24px"></canvas>
      </div>
    `;

    initOdometers(container);
    this.renderPreviewCanvas();

    container.querySelector('#end-explore-cta')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.openExplore();
    });

    container.querySelector('#end-ask-cta')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.openAsk();
    });

    container.querySelector('#end-replay-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx?.onReplayStory?.();
    });

    container.querySelector('#dl-1350-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.activeSize = '1080x1350';
      this.renderPreviewCanvas();
      void ctx.exportShareCard('1080x1350');
    });

    container.querySelector('#dl-1920-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.activeSize = '1080x1920';
      this.renderPreviewCanvas();
      void ctx.exportShareCard('1080x1920');
    });

    container.querySelector('#share-receipts-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.openReceipts(headlineText, ctx.chapter.txn_ids);
    });
  }

  private renderPreviewCanvas(): void {
    if (!this.container || !this.ctx) return;
    const canvas = this.container.querySelector<HTMLCanvasElement>('#share-preview-canvas');
    if (!canvas) return;
    const [w, h] = this.activeSize === '1080x1920' ? [1080, 1920] : [1080, 1350];
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = this.activeSize === '1080x1920' ? '450px' : '620px';
    canvas.style.height = this.activeSize === '1080x1920' ? '800px' : '775px';

    const c2d = canvas.getContext('2d');
    if (c2d) {
      try {
        ShareExporter.drawPosterToCanvas(c2d, w, h, {
          size: this.activeSize,
          plan: this.ctx.plan,
          facts: this.ctx.facts,
          days: this.ctx.days,
          resolveCopy: (tpl) => this.ctx!.resolveCopy(tpl),
        });
      } catch {
        // Ignore in jsdom environment without canvas
      }
    }
  }

  public play(timeline: TimelineController): void {
    if (!this.container || !this.ctx) return;
    const tl = (timeline as PlayerTimelineController).gsapTimeline ?? gsap.timeline();
    const rm = timeline.isReducedMotion();
    const grid = this.ctx.grid;

    if (grid) {
      grid.hideAllParticles();
      grid.setGridGeometry(GRID_PRESETS.mini, { dur: 0.45 });
      grid.resetToBaseColors();
    }

    enterStageGroup(this.container, tl, 0, rm);
    timeline.logEvent('share_card.play');
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
