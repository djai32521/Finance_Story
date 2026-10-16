import type { Chapter, Day, Fact, StoryPlan } from '../../contracts/index.js';
import { SPEND_STEPS_RGB } from '../grid/interactive-grid.js';

export type ShareCardSize = '1080x1350' | '1080x1920';

export interface ShareCardRenderOptions {
  size?: ShareCardSize;
  plan: StoryPlan;
  facts: ReadonlyMap<string, Fact>;
  days: readonly Day[];
  resolveCopy: (template: string) => string;
  chapter?: Chapter;
}

export class ShareExporter {
  /**
   * Renders a privacy-safe, high-resolution poster ("Blocks" art direction)
   * at 1080x1350 or 1080x1920 and returns a PNG data URL.
   * Contains zero account numbers, sort codes, card numbers, or references (Rule 6).
   */
  public static async renderToPngDataUrl(options: ShareCardRenderOptions): Promise<string> {
    const size = options.size ?? '1080x1350';
    const [width, height] = size === '1080x1920' ? [1080, 1920] : [1080, 1350];

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable for ShareExporter');
    }

    this.drawPosterToCanvas(ctx, width, height, options);
    return canvas.toDataURL('image/png');
  }

  public static async renderPosterDataUrl(
    plan: StoryPlan,
    facts: ReadonlyMap<string, Fact> | readonly Fact[],
    days: readonly Day[],
    size: ShareCardSize = '1080x1350',
    chapter?: Chapter
  ): Promise<string> {
    const factMap: ReadonlyMap<string, Fact> =
      facts instanceof Map ? facts : new Map((facts as readonly Fact[]).map((f) => [f.id, f]));
    const resolveCopy = (tpl: string): string =>
      tpl.replace(
        /\{fact:([a-zA-Z0-9_]+)\}/g,
        (_m, id: string) => factMap.get(id)?.formatted ?? ''
      );
    return this.renderToPngDataUrl({
      size,
      plan,
      facts: factMap,
      days,
      resolveCopy,
      chapter,
    });
  }

  public static drawPosterToCanvas(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: ShareCardRenderOptions
  ): void {
    const { plan, facts, days, resolveCopy, chapter } = options;
    const isTall = height > 1500;

    const yearStr = facts.get(plan.year_fact_id)?.formatted ?? String(plan.year);
    const totalSpendFact =
      facts.get('total_spend_usd') ??
      facts.get('total_discretionary_spend') ??
      Array.from(facts.values()).find((f) => f.unit === 'usd_cents' || f.unit === 'usd');
    const totalTxnsFact =
      facts.get('total_transactions_count') ??
      Array.from(facts.values()).find((f) => f.unit === 'count');
    const topMerchantFact = facts.get('top_merchant_name');
    const topVisitsFact = facts.get('visits_top_merchant');
    const paydayCountFact = facts.get('payday_count');

    // 1. Base Ink Canvas
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, width, height);

    // 2. Top Header Strip
    ctx.fillStyle = '#F3F0E6';
    ctx.font = '500 20px "JetBrains Mono", monospace';
    const rawRightTag = chapter?.params.kicker?.toUpperCase() ?? 'YEAR SUMMARY POSTER';
    const rightTag = this.truncateTextToWidth(ctx, rawRightTag, Math.floor(width * 0.42));
    const tagWidth = ctx.measureText(rightTag).width;
    ctx.fillText(rightTag, width - 56 - tagWidth, 62);

    const headerSubtitle = plan.business_meta?.archetype_label?.toUpperCase() ?? 'A YEAR IN MONEY';
    const rawLeftHeader = `${plan.person_name.toUpperCase()} · ${yearStr} · ${headerSubtitle}`;
    const maxLeftHeaderW = Math.max(240, width - 112 - tagWidth - 28);
    ctx.fillText(this.truncateTextToWidth(ctx, rawLeftHeader, maxLeftHeaderW), 56, 62);

    // 3. Primary Hero Yellow Block
    const heroY = 92;
    const heroH = isTall ? 520 : 390;
    ctx.fillStyle = '#F4F03A';
    ctx.fillRect(48, heroY, width - 96, heroH);

    // Giant cropped ghost year inside yellow block
    ctx.save();
    ctx.beginPath();
    ctx.rect(48, heroY, width - 96, heroH);
    ctx.clip();
    ctx.fillStyle = 'rgba(17, 17, 17, 0.08)';
    ctx.font = '300 340px "Inter Tight", sans-serif';
    ctx.fillText(yearStr, width - 560, heroY + heroH - 10);
    ctx.restore();

    ctx.fillStyle = '#111111';
    ctx.font = '500 18px "JetBrains Mono", monospace';
    const heroKicker =
      chapter && chapter.type !== 'share_card'
        ? (chapter.params.kicker ?? chapter.type).toUpperCase()
        : plan.business_meta
          ? 'OPERATING ARCHETYPE'
          : 'YOUR MONEY PERSONALITY';
    ctx.fillText(this.truncateTextToWidth(ctx, heroKicker, width - 168), 84, heroY + 48);

    const heroTitle =
      chapter && chapter.type !== 'share_card'
        ? resolveCopy(chapter.headline)
        : resolveCopy(plan.personality.title);
    const heroMaxW = width - 168;
    let heroTitlePx = isTall ? 96 : 82;
    const minHeroTitlePx = 44;
    ctx.font = `300 ${heroTitlePx}px "Inter Tight", sans-serif`;
    while (
      heroTitlePx > minHeroTitlePx &&
      (ctx.measureText(heroTitle).width > heroMaxW * 1.85 ||
        this.wouldWrapTextTruncate(ctx, heroTitle, heroMaxW, 2))
    ) {
      heroTitlePx -= 4;
      ctx.font = `300 ${heroTitlePx}px "Inter Tight", sans-serif`;
    }
    const heroLineHeight = Math.round(heroTitlePx * 1.03);
    this.wrapText(ctx, heroTitle, 84, heroY + (isTall ? 150 : 136), heroMaxW, heroLineHeight, 2);

    const heroBody =
      chapter && chapter.type !== 'share_card'
        ? resolveCopy(chapter.body)
        : resolveCopy(plan.one_line);
    ctx.font = isTall ? '400 32px "Inter Tight", sans-serif' : '400 28px "Inter Tight", sans-serif';
    this.wrapText(
      ctx,
      heroBody,
      84,
      heroY + heroH - (isTall ? 130 : 108),
      heroMaxW,
      isTall ? 40 : 36,
      3
    );

    // 4. Modular Metric Blocks Row (3 side-by-side flat colour blocks)
    const rowY = heroY + heroH + 16;
    const rowH = isTall ? 390 : 280;
    const colW = Math.floor((width - 96 - 32) / 3);
    const currencySym = plan.business_meta?.currency_symbol ?? 'US$';
    const rawSpendFormatted = (totalSpendFact?.formatted ?? '$0').replace(/^(US\$|\$)/, '');

    // Block 1: Orange (Total Spend)
    ctx.fillStyle = '#FF5A14';
    ctx.fillRect(48, rowY, colW, rowH);
    ctx.fillStyle = '#111111';
    ctx.font = '500 16px "JetBrains Mono", monospace';
    ctx.fillText(
      this.truncateTextToWidth(
        ctx,
        (totalSpendFact?.label ?? 'SPENT IN YEAR').toUpperCase(),
        colW - 44
      ),
      74,
      rowY + 42
    );
    this.drawFittedSingleLine(
      ctx,
      `${currencySym}${rawSpendFormatted}`,
      68,
      rowY + rowH - 36,
      colW - 40,
      isTall ? 58 : 52,
      26,
      300,
      '"Inter Tight", sans-serif'
    );

    // Block 2: Pink (Purchases / Movements)
    const col2X = 48 + colW + 16;
    ctx.fillStyle = '#FFA8E4';
    ctx.fillRect(col2X, rowY, colW, rowH);
    ctx.fillStyle = '#111111';
    ctx.font = '500 16px "JetBrains Mono", monospace';
    ctx.fillText(
      this.truncateTextToWidth(ctx, (totalTxnsFact?.label ?? 'PURCHASES').toUpperCase(), colW - 44),
      col2X + 26,
      rowY + 42
    );
    this.drawFittedSingleLine(
      ctx,
      totalTxnsFact?.formatted ?? '0',
      col2X + 24,
      rowY + rowH - 36,
      colW - 40,
      isTall ? 84 : 72,
      26,
      300,
      '"Inter Tight", sans-serif'
    );

    // Block 3: Lavender (Top Place & Visits)
    const col3X = col2X + colW + 16;
    ctx.fillStyle = '#A9A2E0';
    ctx.fillRect(col3X, rowY, colW, rowH);
    ctx.fillStyle = '#111111';
    ctx.font = '500 16px "JetBrains Mono", monospace';
    const topLabelPrefix = plan.business_meta ? 'TOP VENDOR' : 'TOP RITUAL';
    ctx.fillText(
      this.truncateTextToWidth(
        ctx,
        `${topLabelPrefix} · ${(topMerchantFact?.formatted ?? 'CAFE').toUpperCase()}`,
        colW - 44
      ),
      col3X + 26,
      rowY + 42
    );
    this.drawFittedSingleLine(
      ctx,
      `${topVisitsFact?.formatted ?? '0'}×`,
      col3X + 24,
      rowY + rowH - 36,
      colW - 40,
      isTall ? 84 : 72,
      26,
      300,
      '"Inter Tight", sans-serif'
    );

    // 5. 53x7 Year Grid Block
    const gridBlockY = rowY + rowH + 16;
    const gridBlockH = isTall ? 740 : 470;
    ctx.fillStyle = '#191918';
    ctx.fillRect(48, gridBlockY, width - 96, gridBlockH);
    ctx.strokeStyle = '#3A3A38';
    ctx.lineWidth = 2;
    ctx.strokeRect(48, gridBlockY, width - 96, gridBlockH);

    ctx.fillStyle = '#F3F0E6';
    ctx.font = '500 16px "JetBrains Mono", monospace';
    const milestoneBase = plan.business_meta?.milestone_label?.trim().toUpperCase();
    const milestonePlural = milestoneBase
      ? milestoneBase.endsWith('S')
        ? milestoneBase
        : `${milestoneBase}S`
      : 'PAYDAYS';
    const gridHeaderText = `${days.length} DAYS OF ${yearStr} · ${paydayCountFact?.formatted ?? '12'} ${milestonePlural} IN ORANGE`;
    ctx.fillText(this.truncateTextToWidth(ctx, gridHeaderText, width - 168), 84, gridBlockY + 46);

    const spends = days
      .map((d) => d.discretionary_out_minor)
      .slice()
      .sort((a, b) => a - b);
    const p97 = Math.max(100, spends[Math.floor(spends.length * 0.97)] ?? 10000);

    const gridPitch = Math.floor((width - 168) / 53);
    const cellSize = Math.max(8, gridPitch - 3);
    const gridStartX = Math.floor((width - 53 * gridPitch) / 2);
    const gridStartY = gridBlockY + (isTall ? 110 : 88);

    days.forEach((d) => {
      const gx = gridStartX + d.week_index * gridPitch;
      const gy = gridStartY + d.weekday * (gridPitch + (isTall ? 8 : 3));
      const ratio = Math.min(1, Math.sqrt(Math.max(0, d.discretionary_out_minor) / p97));
      const bucket = ratio < 0.14 ? 0 : ratio < 0.36 ? 1 : ratio < 0.6 ? 2 : ratio < 0.82 ? 3 : 4;
      const rgb = d.is_payday ? [255, 90, 20] : (SPEND_STEPS_RGB[bucket] ?? [44, 44, 42]);
      ctx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
      ctx.fillRect(gx, gy, cellSize, cellSize + (isTall ? 5 : 0));
    });

    // Legend & Footer inside Grid Block
    const footerY = gridBlockY + gridBlockH - 36;
    ctx.fillStyle = '#C9C5BA';
    ctx.font = '500 14px "JetBrains Mono", monospace';
    const leftLegend = '1 SQUARE = 1 DAY · MONDAY ON TOP · BRIGHTER = LOUDER';
    ctx.fillText(leftLegend, 84, footerY);
    const leftW = ctx.measureText(leftLegend).width;
    const rawRightNote = `${plan.person_name.toUpperCase()} · FINANCE STORY SUMMARY`;
    const maxRightW = Math.max(180, width - 168 - leftW - 24);
    const rightNote = this.truncateTextToWidth(ctx, rawRightNote, maxRightW);
    const rnW = ctx.measureText(rightNote).width;
    ctx.fillText(rightNote, width - 84 - rnW, footerY);
  }

  public static async downloadShareCard(
    options: ShareCardRenderOptions,
    filename?: string
  ): Promise<string> {
    const dataUrl = await this.renderToPngDataUrl(options);
    const size = options.size ?? '1080x1350';
    const slug =
      options.plan.person_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'user';
    const dlName = filename ?? `${slug}-${options.plan.year}-share-${size}.png`;
    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = dlName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    return dataUrl;
  }

  private static truncateTextToWidth(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string {
    if (ctx.measureText(text).width <= maxWidth) {
      return text;
    }
    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
      truncated = truncated.slice(0, -1).trimEnd();
    }
    return `${truncated}…`;
  }

  private static drawFittedSingleLine(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    initialPx: number,
    minPx: number,
    weight: number | string,
    family: string
  ): void {
    let px = initialPx;
    ctx.font = `${weight} ${px}px ${family}`;
    while (px > minPx && ctx.measureText(text).width > maxWidth) {
      px -= 2;
      ctx.font = `${weight} ${px}px ${family}`;
    }
    const finalStr = this.truncateTextToWidth(ctx, text, maxWidth);
    ctx.fillText(finalStr, x, y);
  }

  private static wouldWrapTextTruncate(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number
  ): boolean {
    const words = text.split(/\s+/);
    let line = '';
    let lineCount = 0;

    for (let n = 0; n < words.length; n++) {
      const word = words[n]!;
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        if (ctx.measureText(line).width > maxWidth) return true;
        line = word;
        lineCount++;
        if (lineCount >= maxLines - 1) {
          const rest = words.slice(n).join(' ');
          return ctx.measureText(rest).width > maxWidth;
        }
      } else {
        line = testLine;
      }
    }
    return Boolean(line && ctx.measureText(line).width > maxWidth);
  }

  private static wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number
  ): void {
    const words = text.split(/\s+/);
    let line = '';
    let lineCount = 0;

    for (let n = 0; n < words.length; n++) {
      const word = words[n]!;
      const testLine = line ? `${line} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line) {
        ctx.fillText(this.truncateTextToWidth(ctx, line, maxWidth), x, y + lineCount * lineHeight);
        line = word;
        lineCount++;
        if (lineCount >= maxLines - 1) {
          // Fit remaining words into last line truncated if needed
          const rest = words.slice(n).join(' ');
          ctx.fillText(
            this.truncateTextToWidth(ctx, rest, maxWidth),
            x,
            y + lineCount * lineHeight
          );
          return;
        }
      } else {
        line = testLine;
      }
    }
    if (line) {
      ctx.fillText(this.truncateTextToWidth(ctx, line, maxWidth), x, y + lineCount * lineHeight);
    }
  }
}
