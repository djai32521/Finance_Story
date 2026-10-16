import gsap from 'gsap';
import type {
  ChapterContext,
  ChapterModule,
  Fact,
  TimelineController,
} from '../../../contracts/index.js';
import { formatMoneyMinor } from '../../../contracts/index.js';
import { GRID_PRESETS, RGB_PALETTE } from '../../grid/interactive-grid.js';
import {
  enterStageGroup,
  initOdometers,
  type PlayerTimelineController,
} from '../../player/timeline-controller.js';
import type { ExtendedChapterContext } from '../core/pour-chapter.js';
import { CoffeeChapter, createCoffeeChapter } from './coffee-chapter.js';
import { StudioChapter, createStudioChapter } from './studio-chapter.js';

export { StudioChapter, createStudioChapter, CoffeeChapter, createCoffeeChapter };

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const BLOCK_COLORS = ['var(--c1)', 'var(--c4)', 'var(--c2)', 'var(--lav)'];

function formatBespokeBadge(badgeParam?: string, isB2B = false): string {
  if (isB2B) return '';
  const raw = (badgeParam ?? 'ONLY IN YOUR APP').trim().toUpperCase();
  if (raw.includes('ONLY IN YOUR APP') && raw.includes('BESPOKE')) {
    return raw;
  }
  if (raw.includes('ONLY IN YOUR APP')) {
    return `${raw} · BESPOKE CHAPTER`;
  }
  return `ONLY IN YOUR APP · ${raw}`;
}

function resolveChapterFacts(ctx: ChapterContext): Fact[] {
  const resolved: Fact[] = [];
  if (ctx.chapter.params.blocks && ctx.chapter.params.blocks.length > 0) {
    for (const blk of ctx.chapter.params.blocks) {
      if (ctx.facts.has(blk.fact_id)) {
        resolved.push(ctx.getFact(blk.fact_id));
      }
    }
  }
  for (const id of ctx.chapter.fact_ids) {
    if (ctx.facts.has(id) && !resolved.some((f) => f.id === id)) {
      resolved.push(ctx.getFact(id));
    }
  }
  if (resolved.length === 0) {
    for (const f of ctx.facts.values()) {
      resolved.push(f);
      if (resolved.length >= 4) break;
    }
  }
  while (resolved.length < 4) {
    const fallback = resolved[0] ?? {
      id: 'bespoke_fallback',
      label: 'Bespoke Metric',
      value: 0,
      unit: 'count' as const,
      formatted: '0',
      txn_ids: ctx.chapter.txn_ids,
      computation: 'Fallback bespoke metric',
    };
    resolved.push(fallback);
  }
  return resolved.slice(0, 4);
}

/**
 * Generic data-driven Bespoke Chapter fallback module for contrast personas (e.g., Alex)
 * or custom bespoke chapters not matching Sam's `studio` or `coffee` modules.
 */
export class GenericBespokeChapter implements ChapterModule {
  private container: HTMLElement | null = null;
  private ctx: ExtendedChapterContext | null = null;
  private activeDates = new Set<string>();

  public mount(container: HTMLElement, ctx: ChapterContext): void {
    this.container = container;
    this.ctx = ctx as ExtendedChapterContext;

    const isB2B = Boolean(ctx.plan.business_meta);
    const facts = resolveChapterFacts(ctx);
    const headlineText = ctx.resolveCopy(ctx.chapter.headline);
    const bodyText = ctx
      .resolveCopy(ctx.chapter.body)
      .replace(/^(?:Executive\s+)?Takeaway for [^—–-]+\s*[—–-]\s*/i, '');
    const takeawayPrefix = isB2B
      ? ''
      : `KEY TAKEAWAY FOR ${this.escapeHtml(ctx.plan.person_name.toUpperCase())} ·`;
    const currencySup = this.escapeHtml(ctx.plan.business_meta?.currency_symbol ?? 'US$');
    const kickerText = ctx.chapter.params.kicker ?? 'BESPOKE CHAPTER';
    const badgeText = formatBespokeBadge(ctx.chapter.params.badge, isB2B);

    const txns =
      ctx.transactions.length > 0
        ? ctx.transactions
        : ctx.allTransactions.filter((t) => t.direction === 'out' && !t.is_transfer).slice(0, 24);

    this.activeDates = new Set(ctx.chapter.params.highlight_dates ?? txns.map((t) => t.date));

    const monthlyCounts = new Array<number>(12).fill(0);
    txns.forEach((t) => {
      const m = Math.max(0, Math.min(11, parseInt(t.date.slice(5, 7), 10) - 1));
      monthlyCounts[m] = (monthlyCounts[m] ?? 0) + 1;
    });
    const maxMonth = Math.max(1, ...monthlyCounts);

    const isPhone = ctx.viewport === 'phone';
    const svgW = isPhone ? 326 : 984;
    const svgH = isPhone ? 130 : 240;
    const colW = (svgW - 32) / 12;

    let barsSvg = '';
    monthlyCounts.forEach((v, m) => {
      const bh = Math.max(4, (v / maxMonth) * (svgH - 44));
      const bx = 16 + m * colW + colW * 0.15;
      const bw = colW * 0.7;
      const by = svgH - 26 - bh;
      barsSvg += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${v === maxMonth && v > 0 ? '#FF5A14' : '#F4F03A'}"/>`;
      barsSvg += `<text x="${(bx + bw / 2).toFixed(1)}" y="${svgH - 8}" fill="#C9C5BA" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="middle">${MONTH_INITIALS[m]}</text>`;
    });

    const topTxns = txns
      .slice()
      .sort((a, b) => b.amount_minor - a.amount_minor)
      .slice(0, isPhone ? 3 : 4);

    const receiptRowsHtml = topTxns
      .map(
        (t) =>
          `<div class="rc" style="font:500 ${isPhone ? '11px' : '13px'}/1.15 'JetBrains Mono',monospace;display:flex;gap:8px;padding:5px 0;align-items:baseline;">
            <span style="opacity:0.7;min-width:46px">${this.escapeHtml(t.date.slice(5))}</span>
            <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${this.escapeHtml(t.merchant)}</span>
            <span class="ld" style="flex:1;border-bottom:1.5px dotted currentColor;opacity:0.4"></span>
            <span>${currencySup}${formatMoneyMinor(t.amount_minor, { showCents: true, prefix: '' })}</span>
          </div>`
      )
      .join('');

    const metricBlocksHtml = facts
      .map((f, idx) => {
        const blkMeta = ctx.chapter.params.blocks?.[idx];
        const label = blkMeta?.label ?? f.label;
        const hasDollar = f.formatted.startsWith('$') || f.formatted.startsWith('US$');
        const rawDigits = f.formatted.replace(/^(US\$|\$)/, '');
        const bg = BLOCK_COLORS[idx % BLOCK_COLORS.length]!;

        if (isPhone) {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const left = col === 0 ? 16 : 200;
          const top = 392 + row * 138;
          return `
            <div class="blk ia" data-ax="b" data-testid="bespoke-metric-block-${idx}" style="position:absolute;left:${left}px;top:${top}px;width:174px;height:128px;background:${bg};color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
              <div class="lab tx" style="position:absolute;left:12px;top:10px;right:10px;font-size:9px;display:flex;justify-content:space-between;align-items:center;">
                <span>${this.escapeHtml(label)}</span>
                <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(f.id)}" style="font-family:'JetBrains Mono',monospace;font-size:8.5px;padding:2px 5px;border:1px solid #111;cursor:pointer;">Receipts (${f.txn_ids.length})</button>
              </div>
              <div class="num tx" style="position:absolute;left:12px;bottom:14px;font-size:38px;">${hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(rawDigits)}">${this.escapeHtml(rawDigits)}</span></div>
            </div>
          `;
        }

        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const left = col === 0 ? 1128 : 1500;
        const top = row === 0 ? 68 : 448;
        return `
          <div class="blk ia" data-ax="b" data-testid="bespoke-metric-block-${idx}" style="position:absolute;left:${left}px;top:${top}px;width:356px;height:356px;background:${bg};color:var(--ink);transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:26px;top:22px;right:22px;display:flex;justify-content:space-between;align-items:center;">
              <span>${this.escapeHtml(label)}</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(f.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 8px;border:1px solid #111;cursor:pointer;">Receipts (${f.txn_ids.length})</button>
            </div>
            <div class="num tx" style="position:absolute;left:22px;bottom:36px;font-size:96px;">${hasDollar ? `<sup>${currencySup}</sup>` : ''}<span class="od" data-v="${this.escapeHtml(rawDigits)}">${this.escapeHtml(rawDigits)}</span></div>
          </div>
        `;
      })
      .join('');

    const badgeDisplayStyle = badgeText ? 'inline-flex' : 'none';
    const takeawayPrefixHtml = takeawayPrefix
      ? `<span style="font-family:'JetBrains Mono',monospace;font-size:${isPhone ? '9px' : '10.5px'};font-weight:700;letter-spacing:${isPhone ? '0.1em' : '0.12em'};color:#F4F03A;text-transform:uppercase;margin-right:${isPhone ? '6px' : '8px'};">${takeawayPrefix}</span>`
      : '';

    if (isPhone) {
      container.innerHTML = `
        <div class="generic-bespoke-phone-stage" data-testid="generic-bespoke-stage" data-viewport="phone" style="position:relative;width:390px;height:844px;overflow:hidden;">
          <div class="tx" style="position:absolute;left:16px;top:36px;right:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span class="badge-bespoke" data-testid="bespoke-badge" style="display:${badgeDisplayStyle};align-items:center;gap:6px;padding:4px 8px;background:#111111;color:#F4F03A;border:1.5px solid #F4F03A;font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">${this.escapeHtml(badgeText)}</span>
            <span class="lab" style="position:static;font-size:10px;color:#C9C5BA;">${this.escapeHtml(kickerText)}</span>
          </div>
          <div class="ch-header-stack" style="left:16px;right:16px;top:60px;max-height:126px;gap:6px;">
            <div class="split tx" data-testid="chapter-headline" style="width:358px;font-size:26px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;color:var(--bone);">${this.escapeHtml(headlineText)}</div>
            <div class="tx" data-testid="chapter-body" style="width:358px;padding:6px 10px;background:#1C1C1B;border-left:3px solid #F4F03A;font-family:'Space Grotesk',sans-serif;font-size:11.5px;line-height:1.3;color:var(--bone);">
              ${takeawayPrefixHtml}${this.escapeHtml(bodyText)}
            </div>
          </div>
          <div class="blk ia" data-ax="b" style="position:absolute;left:16px;top:194px;width:358px;height:186px;background:#1C1C1B;color:var(--bone);border:1.5px solid #3A3A38;transform-origin:50% 100%;pointer-events:auto;">
            <svg data-testid="generic-bespoke-svg" width="${svgW}" height="${svgH}" style="position:absolute;left:16px;top:28px;">${barsSvg}</svg>
          </div>
          ${metricBlocksHtml}
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="generic-bespoke-desktop-stage" data-testid="generic-bespoke-stage" data-viewport="desktop" style="position:absolute;inset:0;">
          <div class="ch-header-stack" style="left:60px;top:64px;max-width:1040px;max-height:252px;">
            <div class="tx" style="display:flex;align-items:center;gap:16px;">
              <span class="badge-bespoke" data-testid="bespoke-badge" style="display:${badgeDisplayStyle};align-items:center;gap:8px;padding:6px 12px;background:#111111;color:#F4F03A;border:1.5px solid #F4F03A;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;">${this.escapeHtml(badgeText)}</span>
              <span class="lab" style="position:static;color:#C9C5BA;">${this.escapeHtml(kickerText)}</span>
            </div>
            <div class="split tx" data-testid="chapter-headline" style="font-size:62px;font-weight:300;letter-spacing:-0.04em;line-height:1.04;color:var(--bone);">${this.escapeHtml(headlineText)}</div>
            <div class="tx" data-testid="chapter-body" style="padding:12px 18px;background:#1C1C1B;border:1px solid #3A3A38;border-left:4px solid #F4F03A;font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:400;line-height:1.35;color:var(--bone);">
              ${takeawayPrefixHtml}${this.escapeHtml(bodyText)}
            </div>
          </div>

          <div class="blk ia" data-ax="b" style="position:absolute;left:64px;top:330px;width:1040px;height:474px;background:#1C1C1B;color:var(--bone);border:1.5px solid #3A3A38;transform-origin:50% 100%;pointer-events:auto;">
            <div class="lab tx" style="position:absolute;left:28px;top:20px;right:28px;display:flex;justify-content:space-between;align-items:center;">
              <span>SIGNATURE PATTERN TIMELINE</span>
              <button type="button" class="receipt-trigger" data-fact-id="${this.escapeHtml(facts[0]!.id)}" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;padding:5px 10px;border:1.5px solid #F4F03A;background:#111111;color:#F4F03A;cursor:pointer;">Receipts (${facts[0]!.txn_ids.length})</button>
            </div>
            <svg data-testid="generic-bespoke-svg" width="${svgW}" height="${svgH}" style="position:absolute;left:28px;top:60px;">${barsSvg}</svg>
            <div class="tx" style="position:absolute;left:28px;top:316px;right:28px;">${receiptRowsHtml}</div>
          </div>

          ${metricBlocksHtml}
        </div>
      `;
    }

    initOdometers(container);

    container.querySelectorAll<HTMLButtonElement>('.receipt-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = btn.dataset.factId;
        if (fid && ctx.facts.has(fid)) {
          const f = ctx.getFact(fid);
          ctx.openReceipts(`${f.label} (${f.formatted})`, f.txn_ids);
        } else {
          ctx.openReceipts(headlineText, ctx.chapter.txn_ids);
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
      const preset = this.ctx.viewport === 'phone' ? GRID_PRESETS.phone : GRID_PRESETS.mini;
      grid.setGridGeometry(preset, { dur: rm ? 0 : 0.45, instant: rm });
      grid.days.forEach((v) => {
        if (this.activeDates.has(v.day.date)) {
          grid.tweenColor(v, RGB_PALETTE.c1, 0.25, 0.05);
          grid.popVisual(v, 0.4, 0.05);
        } else {
          grid.tweenColor(v, RGB_PALETTE.dim, 0.25);
        }
      });
    }

    enterStageGroup(this.container, tl, 0, rm);
    timeline.logEvent('bespoke.generic.play', {
      chapterId: this.ctx.chapter.id,
      activeDays: this.activeDates.size,
    });
  }

  public explore(): void {
    this.ctx?.openExplore(this.ctx.chapter.params.focus_category);
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

export function createGenericBespokeChapter(): ChapterModule {
  return new GenericBespokeChapter();
}

export const BESPOKE_CHAPTER_REGISTRY: Record<string, () => ChapterModule> = {
  bespoke_0: createStudioChapter,
  studio: createStudioChapter,
  room_to_make_noise: createStudioChapter,
  monarch_acoustic: createStudioChapter,
  bespoke_1: createCoffeeChapter,
  coffee: createCoffeeChapter,
  morning_rivalry: createCoffeeChapter,
  coffee_rivalry: createCoffeeChapter,
  generic: createGenericBespokeChapter,
  default: createGenericBespokeChapter,
  fallback: createGenericBespokeChapter,
};

export function resolveBespokeChapterModule(moduleOrId?: string): ChapterModule {
  if (moduleOrId) {
    const normalized = moduleOrId.trim().toLowerCase();
    const factory = BESPOKE_CHAPTER_REGISTRY[normalized] ?? BESPOKE_CHAPTER_REGISTRY[moduleOrId];
    if (factory) {
      return factory();
    }
    if (normalized.includes('studio') || normalized.includes('monarch')) {
      return createStudioChapter();
    }
    if (
      normalized.includes('coffee') ||
      normalized.includes('cafe') ||
      normalized.includes('rivalry')
    ) {
      return createCoffeeChapter();
    }
  }
  return createGenericBespokeChapter();
}

export function registerBespokeChapters(player: {
  registerChapterModule(key: string, factory: () => ChapterModule): void;
}): void {
  for (const [key, factory] of Object.entries(BESPOKE_CHAPTER_REGISTRY)) {
    player.registerChapterModule(key, factory);
  }
}
