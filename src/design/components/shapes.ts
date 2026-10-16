/**
 * Data-Driven SVG & Canvas Shape Generators (`src/design/components/shapes.ts`)
 *
 * Includes:
 * - Weekday & Monthly bar charts (with unclipped top value labels)
 * - 53×7 mini dot matrix
 * - 53×7 grid annotations (month headers, weekday letters, tick ribbon, legend)
 * - 365-day radial clock with inner Nightingale category rose petals for Personality
 * - Streak chain visualizer & horizontal comparison bars
 */

import { CORE_COLORS, GRID_INTENSITY_STEPS_RGB } from '../palette.js';
import {
  JAN_1_2025_WEEKDAY,
  MONTH_NAMES_UPPER,
  MONTH_START_DOY_2025,
  WEEKDAY_LETTERS,
  getDayCalendarCoords,
  type GridPreset,
} from '../tokens.js';

/**
 * Render a 7-bar Mon–Sun SVG chart with generous top headroom so the peak label never clips.
 */
export function renderWeekdayBarsSvg(
  counts: readonly number[],
  options: {
    width?: number;
    height?: number;
    barColor?: string;
    peakColor?: string;
    textColor?: string;
    compact?: boolean;
  } = {}
): string {
  const compact = options.compact ?? false;
  const width = options.width ?? (compact ? 122 : 312);
  const height = options.height ?? (compact ? 108 : 236);
  const barColor = options.barColor ?? CORE_COLORS.ink;
  const peakColor = options.peakColor ?? CORE_COLORS.ink;
  const textColor = options.textColor ?? CORE_COLORS.ink;

  const maxCount = Math.max(1, ...counts);
  const peakIndex = counts.indexOf(maxCount);

  if (compact) {
    const pitch = 17;
    const barW = 12;
    const maxBarH = height - 24;
    const baselineY = height - 14;
    const bars = counts
      .map((val, k) => {
        const h = Math.max(2, (val / maxCount) * maxBarH);
        const y = baselineY - h;
        const fill = k === peakIndex ? peakColor : barColor;
        return (
          `<rect class="pb" x="${k * pitch}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${fill}"/>` +
          `<text x="${k * pitch + barW / 2}" y="${height - 2}" font-family="JetBrains Mono" font-size="8.5" font-weight="500" text-anchor="middle" fill="${textColor}">${WEEKDAY_LETTERS[k]}</text>`
        );
      })
      .join('');
    return `<svg class="dt" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`;
  }

  const pitch = 44;
  const barW = 34;
  const topPad = 24;
  const bottomPad = 28;
  const maxBarH = height - topPad - bottomPad;
  const baselineY = height - bottomPad;

  const bars = counts
    .map((val, k) => {
      const h = Math.max(3, (val / maxCount) * maxBarH);
      const y = baselineY - h;
      const fill = k === peakIndex ? peakColor : barColor;
      return (
        `<rect class="pb" x="${k * pitch}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${fill}"/>` +
        `<text x="${k * pitch + barW / 2}" y="${baselineY + 21}" font-family="JetBrains Mono" font-size="13" font-weight="500" text-anchor="middle" fill="${textColor}">${WEEKDAY_LETTERS[k]}</text>` +
        `<text x="${k * pitch + barW / 2}" y="${Math.max(13, y - 8).toFixed(1)}" font-family="JetBrains Mono" font-size="12" font-weight="600" text-anchor="middle" fill="${textColor}">${val}</text>`
      );
    })
    .join('');

  return `<svg class="dt" style="position:absolute;left:40px;top:154px" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`;
}

/**
 * Render a 12-bar Jan–Dec monthly SVG chart.
 */
export function renderMonthlyBarsSvg(
  counts: readonly number[],
  options: {
    barColor?: string;
    textColor?: string;
    style?: string;
  } = {}
): string {
  const barColor = options.barColor ?? CORE_COLORS.solar;
  const textColor = options.textColor ?? CORE_COLORS.bone;
  const maxVal = Math.max(1, ...counts);
  const pitch = 26;
  const barW = 18;
  const baselineY = 70;
  const maxBarH = 60;

  const bars = counts
    .map((val, m) => {
      const h = Math.max(2, (val / maxVal) * maxBarH);
      const y = baselineY - h;
      const letter = MONTH_NAMES_UPPER[m]![0];
      return (
        `<rect class="pb" x="${m * pitch}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${barColor}"/>` +
        `<text x="${m * pitch + barW / 2}" y="86" fill="${textColor}" font-family="JetBrains Mono" font-size="9.5" font-weight="500" text-anchor="middle">${letter}</text>`
      );
    })
    .join('');

  const styleAttr = options.style ?? 'position:absolute;left:600px;top:40px';
  return `<svg class="dt" style="${styleAttr}" width="320" height="92" viewBox="0 0 320 92">${bars}</svg>`;
}

/**
 * Render a 53×7 mini dot matrix SVG highlighting active day indices (0..364).
 */
export function renderMiniYearDotsSvg(
  activeDays: ReadonlySet<number>,
  options: {
    activeColor?: string;
    inactiveColor?: string;
    style?: string;
  } = {}
): string {
  const activeColor = options.activeColor ?? CORE_COLORS.solar;
  const inactiveColor = options.inactiveColor ?? '#3A3A38';
  const pitch = 10.5;
  const size = 8;

  let rects = '';
  for (let i = 0; i < 365; i++) {
    const { col, row } = getDayCalendarCoords(i);
    const fill = activeDays.has(i) ? activeColor : inactiveColor;
    rects += `<rect class="pd" x="${(col * pitch).toFixed(1)}" y="${(row * pitch).toFixed(1)}" width="${size}" height="${size}" fill="${fill}"/>`;
  }

  const styleAttr = options.style ?? 'position:absolute;left:22px;top:46px';
  return `<svg class="dt" style="${styleAttr}" width="560" height="76" viewBox="0 0 560 76">${rects}</svg>`;
}

/**
 * Render HTML/SVG annotations around a 53×7 `GridPreset` (month headers, weekday letters,
 * 365-day tick ribbon, and Quiet–Loud + Payday legend).
 */
export function renderGridAnnotationsHtml(
  preset: GridPreset,
  options: {
    showWeekdays?: boolean;
    showRibbon?: boolean;
    showLegend?: boolean;
    paydayIndices?: ReadonlySet<number>;
    note?: string;
  } = {}
): string {
  let html = '';
  const totalW = 53 * preset.p;
  const totalH = 6 * preset.p + preset.c;
  const fontSize = preset.p < 26 ? 11 : 12;

  MONTH_START_DOY_2025.forEach((startDoy, m) => {
    const col = Math.floor((startDoy + JAN_1_2025_WEEKDAY) / 7);
    const x = preset.x + col * preset.p;
    html += `<div class="lab dt" style="left:${x}px;top:${preset.y - 25}px;font-size:${fontSize}px">${MONTH_NAMES_UPPER[m]}</div>`;
  });

  if (options.showWeekdays !== false) {
    WEEKDAY_LETTERS.forEach((letter, r) => {
      const y = preset.y + r * preset.p + preset.c / 2 - 9;
      html += `<div class="lab dt" style="left:${preset.x - 24}px;top:${y}px;font-size:11px;color:#C9C5BA">${letter}</div>`;
    });
  }

  if (options.showRibbon) {
    let ticks = '';
    for (let i = 0; i < 365; i++) {
      const x = (((i + 0.5) / 365) * totalW).toFixed(1);
      const { dom } = getDayCalendarCoords(i);
      const isMonthStart = dom === 1;
      const isPayday = options.paydayIndices?.has(i) ?? false;
      const w = isPayday ? 2 : 1;
      const h = isPayday ? 22 : isMonthStart ? 14 : 6;
      const fill = isPayday ? CORE_COLORS.ember : CORE_COLORS.bone;
      const opacityAttr = isPayday || isMonthStart ? '' : ' opacity="0.55"';
      ticks += `<rect x="${x}" y="0" width="${w}" height="${h}" fill="${fill}"${opacityAttr}/>`;
    }
    html += `<svg class="dt" style="position:absolute;left:${preset.x}px;top:${preset.y + totalH + 16}px" width="${totalW}" height="24">${ticks}</svg>`;
  }

  if (options.showLegend) {
    const legendY = preset.y + totalH + (options.showRibbon ? 56 : 22);
    const swatches = GRID_INTENSITY_STEPS_RGB.map(
      (rgb) =>
        `<i style="display:inline-block;width:13px;height:13px;background:rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})"></i>`
    ).join('');
    const noteSuffix = options.note ? ` · ${options.note}` : '';
    html += `<div class="lab dt" style="left:${preset.x}px;top:${legendY}px;font-size:12px;display:flex;gap:18px;align-items:center;white-space:nowrap">
      <span style="display:flex;gap:4px;align-items:center">QUIET&nbsp;${swatches}&nbsp;LOUD</span>
      <span style="display:flex;gap:7px;align-items:center"><i style="display:inline-block;width:13px;height:13px;background:${CORE_COLORS.ember}"></i>PAYDAY</span>
      <span>1 SQUARE = 1 DAY · MONDAY ON TOP${noteSuffix.toUpperCase()}</span>
    </div>`;
  }

  return html;
}

export interface PersonalityWheelCategorySlice {
  label: string;
  color: string;
  share: number;
}

export interface PersonalityWheelDrawState {
  ringProgress: number; // 0..1
  barsProgress: number; // 0..1
  spikeProgress: number; // 0..1
  petalProgress: readonly number[]; // 0..1 per slice
}

/**
 * Draw the 365-day radial clock + inner Nightingale rose petals onto a 2D Canvas.
 * Supports both animated tweening and deterministic static rendering at `progress = 1`.
 */
export function drawPersonalityWheelCanvas(
  ctx: CanvasRenderingContext2D,
  params: {
    daySpends: readonly number[];
    paydayIndices: readonly number[];
    categories: readonly PersonalityWheelCategorySlice[];
    state: PersonalityWheelDrawState;
    backingScale?: number;
    cx?: number;
    cy?: number;
    innerRadius?: number;
    outerRadius?: number;
    width?: number;
    height?: number;
  }
): void {
  const scale = params.backingScale ?? 1;
  const width = params.width ?? 940;
  const height = params.height ?? 1080;
  const cx = params.cx ?? 485;
  const cy = params.cy ?? 455;
  const R0 = params.innerRadius ?? 228;
  const RR = params.outerRadius ?? 382;
  const TAU = Math.PI * 2;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const slices = params.categories.slice(0, 8);
  const maxShare = Math.max(0.01, ...slices.map((s) => s.share));
  const sliceCount = Math.max(1, slices.length);

  // 1. Inner Nightingale Category Rose Petals
  slices.forEach((slice, k) => {
    const prog = params.state.petalProgress[k] ?? 1;
    const maxR = (R0 - 18) * Math.sqrt(slice.share / maxShare);
    const r = maxR * prog;
    if (r < 1) return;
    const a0 = -Math.PI / 2 + (k * TAU) / sliceCount + 0.014;
    const a1 = a0 + TAU / sliceCount - 0.028;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = CORE_COLORS.ink;
    ctx.stroke();
  });

  // 2. 365 Daily Radial Spikes (Non-Paydays)
  const maxDaySpend = Math.max(1, ...params.daySpends);
  const paySet = new Set(params.paydayIndices);
  const nDays = Math.floor(params.state.barsProgress * 365);

  ctx.lineWidth = 2;
  ctx.strokeStyle = CORE_COLORS.ink;
  ctx.beginPath();
  for (let i = 0; i < nDays; i++) {
    if (paySet.has(i)) continue;
    const a = -Math.PI / 2 + ((i + 0.5) / 365) * TAU;
    const len = 6 + 88 * Math.sqrt((params.daySpends[i] ?? 0) / maxDaySpend);
    ctx.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
    ctx.lineTo(cx + Math.cos(a) * (R0 + len), cy + Math.sin(a) * (R0 + len));
  }
  ctx.stroke();

  // 3. Payday Orange Spikes
  ctx.strokeStyle = CORE_COLORS.ember;
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  for (const i of params.paydayIndices) {
    if (i >= nDays) continue;
    const a = -Math.PI / 2 + ((i + 0.5) / 365) * TAU;
    const baseLen = 6 + 88 * Math.sqrt((params.daySpends[i] ?? 0) / maxDaySpend);
    const len =
      baseLen * (0.4 + 0.6 * params.state.spikeProgress) + 38 * params.state.spikeProgress;
    ctx.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
    ctx.lineTo(cx + Math.cos(a) * (R0 + len), cy + Math.sin(a) * (R0 + len));
  }
  ctx.stroke();

  // 4. Concentric Ring & Month Tick Marks
  if (params.state.ringProgress > 0) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = CORE_COLORS.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, RR, -Math.PI / 2, -Math.PI / 2 + params.state.ringProgress * TAU);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R0 - 10, -Math.PI / 2, -Math.PI / 2 + params.state.ringProgress * TAU);
    ctx.stroke();

    MONTH_START_DOY_2025.forEach((startDoy) => {
      if (startDoy / 365 > params.state.ringProgress) return;
      const a = -Math.PI / 2 + (startDoy / 365) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (RR - 9), cy + Math.sin(a) * (RR - 9));
      ctx.lineTo(cx + Math.cos(a) * (RR + 9), cy + Math.sin(a) * (RR + 9));
      ctx.stroke();
    });
  }

  // Center pivot square
  ctx.fillStyle = CORE_COLORS.ink;
  ctx.fillRect(cx - 4, cy - 4, 8, 8);
}

/**
 * Render a bold stepped chain SVG connecting a streak of days (`streak` chapter).
 */
export function renderStreakChainSvg(params: {
  lengthDays: number;
  width?: number;
  height?: number;
  accentColor?: string;
}): string {
  const width = params.width ?? 760;
  const height = params.height ?? 140;
  const color = params.accentColor ?? CORE_COLORS.solar;
  const n = Math.max(2, Math.min(40, params.lengthDays));
  const stepX = (width - 48) / n;
  const cy = height / 2;

  let nodes = '';
  const linkLine = `<line x1="24" y1="${cy}" x2="${24 + (n - 1) * stepX}" y2="${cy}" stroke="${color}" stroke-width="6"/>`;
  for (let i = 0; i < n; i++) {
    const x = 24 + i * stepX;
    const sz = i === 0 || i === n - 1 ? 22 : 14;
    nodes += `<rect x="${(x - sz / 2).toFixed(1)}" y="${(cy - sz / 2).toFixed(1)}" width="${sz}" height="${sz}" fill="${color}" stroke="${CORE_COLORS.ink}" stroke-width="2"/>`;
  }

  return `<svg class="dt" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${linkLine}${nodes}</svg>`;
}

/**
 * Render horizontal one-axis comparison bars SVG (for `big_one`, `getaway`, or `heartbeat`).
 */
export function renderComparisonBarsSvg(
  items: ReadonlyArray<{ label: string; valueFormatted: string; ratio: number; color: string }>,
  options: { width?: number; barHeight?: number; gap?: number } = {}
): string {
  const width = options.width ?? 720;
  const barH = options.barHeight ?? 48;
  const gap = options.gap ?? 24;
  const totalH = items.length * (barH + gap);

  const rows = items
    .map((item, idx) => {
      const y = idx * (barH + gap);
      const w = Math.max(12, Math.min(1, item.ratio) * (width - 220));
      return `
        <g transform="translate(0, ${y})">
          <text x="0" y="16" font-family="JetBrains Mono" font-size="12" font-weight="500" fill="${CORE_COLORS.bone}" letter-spacing="1.4">${item.label.toUpperCase()}</text>
          <rect class="sx" x="0" y="24" width="${w.toFixed(1)}" height="${barH - 20}" fill="${item.color}"/>
          <text x="${(w + 14).toFixed(1)}" y="${24 + (barH - 20) / 2 + 5}" font-family="JetBrains Mono" font-size="15" font-weight="600" fill="${CORE_COLORS.bone}">${item.valueFormatted}</text>
        </g>
      `;
    })
    .join('');

  return `<svg class="dt" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}">${rows}</svg>`;
}
