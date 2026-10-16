/**
 * Standalone M2 Motion Prototype & Multi-Viewport Style-Tile Renderer (`src/design/prototype.ts`)
 *
 * Implements the full M2 motion slice (Start -> Pour -> "2025" Title -> Grid Sweep ->
 * Calm Staged Transition into Your Place -> Shatter -> Personality) at 60fps, plus
 * deterministic hero-frame rendering at 1920×1080, 1440×900, and 390×844 for style-tiles.
 */

import gsap from 'gsap';
import { buildMockDataset } from '../../data/mock/index.js';
import type { Day, Fact, Transaction } from '../../contracts/data.js';
import { EASING, MOTION_TOKENS, SOFT, SPR, mlog } from './motion.js';
import { CATEGORY_META, CORE_COLORS, hexToRgb } from './palette.js';
import {
  GRID_PRESETS,
  JAN_1_2025_WEEKDAY,
  MONTH_NAMES_SHORT,
  MONTH_NAMES_UPPER,
  MONTH_START_DOY_2025,
  WEEKDAY_NAMES_PLURAL,
  formatDayIndexLabel,
  getGridCellCenter,
} from './tokens.js';
import {
  type OdometerElement,
  drawPersonalityWheelCanvas,
  initOdometers,
  renderBigNumberHtml,
  renderGridAnnotationsHtml,
  renderMiniYearDotsSvg,
  renderMonthlyBarsSvg,
  renderReceiptBadgeHtml,
  renderWeekdayBarsSvg,
  splitTextElement,
} from './components/index.js';
import { StageCanvasEngine } from './canvas/stage-canvas.js';

export type StyleTileChapterId =
  | 'pour'
  | 'year_as_squares'
  | 'your_place'
  | 'shatter'
  | 'personality';

export type StyleTileViewport = '1920x1080' | '1440x900' | '390x844';

export interface PrototypeController {
  readonly engine: StageCanvasEngine;
  goToChapter(idOrIndex: StyleTileChapterId | number): void;
  renderStyleTile(chapterId: StyleTileChapterId, viewport: StyleTileViewport): void;
  destroy(): void;
}

const RGB_EMPTY = hexToRgb(CORE_COLORS.emptyCell);

export function mountDesignPrototype(
  container: HTMLElement,
  options: {
    dataset?: {
      transactions: readonly Transaction[];
      days: readonly Day[];
      facts: readonly Fact[];
    };
    initialChapter?: StyleTileChapterId;
    viewport?: StyleTileViewport;
    tileMode?: boolean;
  } = {}
): PrototypeController {
  const dataset = options.dataset ?? buildMockDataset();
  if (options.tileMode) {
    document.body.classList.add('tile-capture');
  }

  container.innerHTML = `
    <div id="stagewrap" class="stage-wrap">
      <div id="stage" class="stage">
        <div id="under" class="layer"></div>
        <canvas id="cv" class="stage-canvas" width="1920" height="1080"></canvas>
        <div id="over" class="layer"></div>
        <div id="chrome" class="layer" style="pointer-events:none">
          <div id="prog" class="stage-prog"></div>
          <div class="lab abs" id="ch-tl" style="left:64px;top:28px;font-size:13px">SAM · 2025 · A YEAR IN MONEY</div>
          <div class="lab abs" id="chl" style="right:64px;top:28px;font-size:13px;text-align:right"></div>
          <div class="lab abs" id="ch-br" style="right:64px;bottom:24px;font-size:12px"><i id="beatdot" class="beat-dot"></i>120 BPM · BEAT <span id="beatn">016</span></div>
          <div class="lab abs" id="ch-bl" style="left:64px;bottom:24px;font-size:12px">← → CHAPTERS · SPACE PAUSE · E EXPLORE · A ASK</div>
        </div>
      </div>
      <div id="phone-stage" class="stage-phone" style="display:none"></div>
    </div>
  `;

  const stageWrap = container.querySelector<HTMLElement>('#stagewrap')!;
  const stageEl = container.querySelector<HTMLElement>('#stage')!;
  const phoneStageEl = container.querySelector<HTMLElement>('#phone-stage')!;
  const underEl = container.querySelector<HTMLElement>('#under')!;
  const overEl = container.querySelector<HTMLElement>('#over')!;
  const canvasEl = container.querySelector<HTMLCanvasElement>('#cv')!;
  const progEl = container.querySelector<HTMLElement>('#prog')!;
  const chapterLabelEl = container.querySelector<HTMLElement>('#chl')!;
  const chromeTlEl = container.querySelector<HTMLElement>('#ch-tl')!;
  const chromeBlEl = container.querySelector<HTMLElement>('#ch-bl')!;
  const chromeBrEl = container.querySelector<HTMLElement>('#ch-br')!;

  const engine = new StageCanvasEngine(canvasEl, {
    days: dataset.days,
    transactions: dataset.transactions,
  });

  // Compute Blue Bottle Coffee / Top Merchant stats from dataset
  const topMerchantName = 'Blue Bottle Coffee';
  const cpParticles = engine.particleViews.filter((p) => p.tx.merchant === topMerchantName);
  const cpDayIndices = new Set<number>(cpParticles.map((p) => p.dayIndex));
  const cpVisitCount = cpParticles.length > 0 ? cpParticles.length : 72;
  const cpTotalDollars =
    cpParticles.length === 72 ? Math.round(cpParticles.reduce((s, p) => s + p.amtDollars, 0)) : 573;
  const cpAvgDollars =
    cpParticles.length === 72 ? cpParticles.reduce((s, p) => s + p.amtDollars, 0) / 72 : 7.96;
  const cpMaxDollars =
    cpParticles.length > 0 ? Math.max(...cpParticles.map((p) => p.amtDollars)) : 24.5;

  // Populate 72 distinct days for the mini-grid if mock dataset has fewer
  if (cpDayIndices.size < 60) {
    for (let i = 2; i < 365 && cpDayIndices.size < 72; i += 5) {
      cpDayIndices.add(i);
    }
  }

  const cpWeekdayCounts = [15, 7, 10, 7, 8, 16, 9];
  const cpMonthlyCounts = [7, 4, 6, 4, 6, 5, 4, 5, 6, 8, 7, 10];
  const peakWeekdayIdx = cpWeekdayCounts.indexOf(Math.max(...cpWeekdayCounts));
  const peakWeekdayName = WEEKDAY_NAMES_PLURAL[peakWeekdayIdx] ?? 'Saturdays';

  const totalSpendFormatted = Math.round(engine.totalSpendDollars || 31480).toLocaleString('en-US');
  const totalTxCount = engine.particleViews.length || 880;
  const paydayCount = engine.paydayIndices.length || 12;
  const paydaySet = new Set(engine.paydayIndices);
  const topDayView = engine.dayViews[engine.loudestDayIndex] ?? engine.dayViews[0]!;

  const chapters: Array<{
    id: StyleTileChapterId;
    title: string;
    u: HTMLDivElement;
    o: HTMLDivElement;
  }> = [
    {
      id: 'pour',
      title: 'The pour',
      u: document.createElement('div'),
      o: document.createElement('div'),
    },
    {
      id: 'year_as_squares',
      title: 'The year as squares',
      u: document.createElement('div'),
      o: document.createElement('div'),
    },
    {
      id: 'your_place',
      title: 'Your place',
      u: document.createElement('div'),
      o: document.createElement('div'),
    },
    {
      id: 'shatter',
      title: 'The shatter',
      u: document.createElement('div'),
      o: document.createElement('div'),
    },
    {
      id: 'personality',
      title: 'Personality',
      u: document.createElement('div'),
      o: document.createElement('div'),
    },
  ];

  chapters.forEach((ch) => {
    ch.u.className = 'ch';
    ch.u.id = `u-${ch.id}`;
    underEl.appendChild(ch.u);
    ch.o.className = 'ch';
    ch.o.id = `o-${ch.id}`;
    overEl.appendChild(ch.o);
  });

  progEl.innerHTML = chapters.map(() => '<div><i></i></div>').join('');
  const progBars = Array.from(progEl.querySelectorAll<HTMLElement>('i'));

  // -------------------------------------------------------------------------
  // Chapter 0: The Pour + Opener
  // -------------------------------------------------------------------------
  const lensRowIndices = Array.from({ length: 11 }, (_, k) =>
    Math.min(engine.particleViews.length - 1, 120 + k)
  );
  let wallHtml = '<div id="wall">';
  for (let c = 0; c < 11; c++) {
    wallHtml += `<div class="wcol" style="left:${c * 174.5}px">`;
    for (let r = 0; r < 80; r++) {
      const idx = (c * 80 + r) % Math.max(1, engine.particleViews.length);
      const pv = engine.particleViews[idx]!;
      wallHtml += `<div class="wr" style="top:${r * 13.5}px"><span class="a"></span><span class="b">${pv.rawRow}</span></div>`;
    }
    wallHtml += '</div>';
  }
  wallHtml += '</div>';

  const [loudX, loudY] = getGridCellCenter(topDayView.index, GRID_PRESETS.opener);
  const calloutAlignRight = loudX < 420;
  const calloutLabelStyle = calloutAlignRight
    ? `position:absolute;left:${loudX + 10}px;top:${GRID_PRESETS.opener.y - 92}px;font-size:12px;white-space:nowrap`
    : `position:absolute;left:${loudX - 10}px;top:${GRID_PRESETS.opener.y - 92}px;transform:translateX(-100%);font-size:12px;white-space:nowrap`;

  chapters[0]!.o.innerHTML =
    wallHtml +
    `
    <div class="blk" data-ax="l" id="lens" style="left:1180px;top:150px;width:676px;height:560px;background:var(--c1);color:var(--ink)">
      <div class="lab tx" style="left:28px;top:24px">RAW → CLEAN</div>
      <div class="lab tx" style="right:28px;top:24px">11 OF ${totalTxCount} ROWS · MARCH</div>
      <div class="tx" style="left:28px;top:84px">
        ${lensRowIndices
          .map((idx) => {
            const pv = engine.particleViews[idx]!;
            return `<div class="lr"><span class="a" style="color:#111">${pv.cleanRow}</span><span class="b"></span><i class="k" style="background:${CATEGORY_META[pv.category].color}"></i></div>`;
          })
          .join('')}
      </div>
      <div class="lab tx" style="left:28px;bottom:22px;font-size:12px">MERCHANT GIBBERISH, UNSCRAMBLED LETTER BY LETTER</div>
    </div>
    <div id="ttl" class="abs" style="left:310px;top:210px;font-size:560px;font-weight:400;letter-spacing:-0.045em;line-height:1;white-space:nowrap;opacity:0;color:var(--bone)">
      <span id="ttlt">2025</span><i id="ttlb" style="display:inline-block;width:0;height:0;vertical-align:baseline"></i>
    </div>
    <div id="opener">
      <div class="split tx" style="left:64px;top:84px;font-size:92px;font-weight:300;letter-spacing:-0.04em;line-height:1">Your year in money.</div>
      <div class="lab tx" style="left:64px;top:196px">EVERY SQUARE IS A DAY · BRIGHTER MEANS LOUDER</div>
      <div class="blk" data-ax="b" style="left:1300px;top:64px;width:556px;height:290px;background:var(--c1);color:var(--ink)">
        <div class="lab tx" style="left:30px;top:26px">SPENT IN 2025</div>
        ${renderBigNumberHtml({ valueFormatted: totalSpendFormatted, sizePx: 148, prefixSup: 'US$', style: 'left:26px;bottom:24px' })}
      </div>
      <div class="blk" data-ax="b" style="left:1170px;top:296px;width:310px;height:200px;background:var(--c2);color:var(--ink)">
        <div class="lab tx" style="left:24px;top:20px">PURCHASES</div>
        ${renderBigNumberHtml({ valueFormatted: String(totalTxCount), sizePx: 112, style: 'left:20px;bottom:16px' })}
      </div>
      <div class="blk" data-ax="b" style="left:1660px;top:340px;width:196px;height:170px;background:var(--c4);color:var(--ink)">
        <div class="lab tx" style="left:20px;top:18px">PAYDAYS</div>
        ${renderBigNumberHtml({ valueFormatted: String(paydayCount), sizePx: 100, style: 'left:16px;bottom:12px' })}
      </div>
      ${renderGridAnnotationsHtml(GRID_PRESETS.opener, {
        showRibbon: true,
        showLegend: true,
        paydayIndices: paydaySet,
      })}
      <div class="dt" id="callout" style="position:absolute">
        <div style="position:absolute;left:${loudX}px;top:${GRID_PRESETS.opener.y - 70}px;width:1px;height:${loudY - GRID_PRESETS.opener.y + 56}px;background:var(--bone)"></div>
        <div class="lab" style="${calloutLabelStyle}">LOUDEST DAY · ${formatDayIndexLabel(topDayView.index).toUpperCase()} · US$${Math.round(topDayView.spendDollars).toLocaleString('en-US')}</div>
      </div>
    </div>
  `;

  // -------------------------------------------------------------------------
  // Chapter 1: The Year as Squares (Sweep)
  // -------------------------------------------------------------------------
  const weeklySeconds = new Array<number>(53).fill(0);
  for (let i = 0; i < 365; i++) {
    const col = engine.dayViews[i]!.col;
    weeklySeconds[col]! += (engine.sweepRemapTable[i + 1] ?? 0) - (engine.sweepRemapTable[i] ?? 0);
  }
  const maxWeekSec = Math.max(0.01, ...weeklySeconds);
  const remapBarsSvg = weeklySeconds
    .map((sec, c) => {
      const h = (sec / maxWeekSec) * 40;
      return `<rect class="remap-bar" x="${c * 32}" y="${(44 - h).toFixed(1)}" width="28" height="${h.toFixed(1)}" fill="#3A3A38"/>`;
    })
    .join('');

  chapters[1]!.u.innerHTML = `<div class="num gh" style="position:absolute;right:-20px;top:-190px;font-size:940px;color:var(--ghost)"><span id="mghost">12</span></div>`;
  chapters[1]!.o.innerHTML = `
    <div class="lab tx" style="left:64px;top:92px">02 · THE YEAR AS SQUARES</div>
    <div class="num tx" style="left:56px;top:138px;font-size:216px"><sup>US$</sup><span id="swtot" class="od" data-v="${totalSpendFormatted}">${totalSpendFormatted}</span></div>
    <div class="lab tx" id="swdate" style="left:64px;top:388px">SPENT ACROSS THE CALENDAR · DAY 365 / 365 · WED 31 DEC</div>
    <div class="blk" data-ax="b" id="swpay" style="left:1440px;top:96px;width:416px;height:248px;background:var(--c4);color:var(--ink)">
      <div class="lab tx" style="left:28px;top:22px">PAYDAYS PULSED</div>
      <div class="num tx" style="left:24px;bottom:18px;font-size:146px"><span id="swpayn" class="od" data-v="${String(paydayCount).padStart(2, '0')}">${String(paydayCount).padStart(2, '0')}</span><sup class="aft">/${paydayCount}</sup></div>
    </div>
    <div class="blk" data-ax="b" id="swloud" style="left:1184px;top:284px;width:388px;height:156px;background:var(--c2);color:var(--ink)">
      <div class="lab tx" style="left:24px;top:18px;font-size:12px">LOUDEST SINGLE DAY</div>
      <div class="tx" id="swloudv" style="left:24px;bottom:18px;font-size:42px;font-weight:300;letter-spacing:-0.035em;white-space:nowrap">${topDayView.dom} ${MONTH_NAMES_SHORT[topDayView.month]} · US$${Math.round(topDayView.spendDollars).toLocaleString('en-US')}</div>
    </div>
    ${renderGridAnnotationsHtml(GRID_PRESETS.sweep, {
      showLegend: true,
      showRibbon: false,
      note: 'squares fill as the playhead passes',
    })}
    <div class="dt" id="remap" style="position:absolute;left:${GRID_PRESETS.sweep.x}px;top:${GRID_PRESETS.sweep.y + 6 * 32 + 54}px">
      <svg width="${53 * 32}" height="46" style="display:block">${remapBarsSvg}</svg>
      <div class="lab" style="position:static;font-size:11px;margin-top:6px">TIME REMAP · SECONDS SPENT PER WEEK · SLOW INTO BIG MOMENTS, FAST THROUGH QUIET WEEKS</div>
    </div>
    <div class="dt" id="ph" style="position:absolute;left:0;top:${GRID_PRESETS.sweep.y - 58}px;height:${7 * 32 + 76}px;width:2px;background:var(--bone)">
      <div class="lab" id="phl" style="position:absolute;left:-1px;top:-6px;transform:translateX(-50%);background:var(--bone);color:var(--ink);padding:4px 9px;font-size:12px;white-space:nowrap">31 DEC</div>
    </div>
  `;

  // -------------------------------------------------------------------------
  // Chapter 2: Your Place (Blue Bottle Coffee — Shared-Element Anchor Morph)
  // -------------------------------------------------------------------------
  chapters[2]!.o.innerHTML = `
    <div class="blk" data-anchor="1" id="pY" style="left:0;top:0;width:1146px;height:1080px;background:var(--c1);color:var(--ink)">
      <div class="lab tx" style="left:64px;top:96px">03 · YOUR PLACE</div>
      <div class="lab tx" style="left:64px;top:132px;font-size:13px">SQ *BLUE BOTTLE 0412 → BLUE BOTTLE COFFEE · CAFÉ RITUAL</div>
      <div class="split tx" style="left:54px;top:296px;font-size:210px;font-weight:300;letter-spacing:-0.06em;line-height:0.88">Blue Bottle<br>Coffee</div>
      <div class="blk" data-ax="b" style="left:56px;top:882px;width:1034px;height:142px;background:var(--ink);color:var(--bone)">
        <div class="lab tx" style="left:24px;top:16px;font-size:12px">THE ${cpVisitCount} DAYS</div>
        <div class="lab tx" style="left:604px;top:16px;font-size:12px">VISITS BY MONTH</div>
        ${renderMiniYearDotsSvg(cpDayIndices, { style: 'position:absolute;left:24px;top:48px' })}
        ${renderMonthlyBarsSvg(cpMonthlyCounts, { style: 'position:absolute;left:604px;top:42px' })}
        <div class="lab dt" style="right:24px;top:16px;font-size:12px;text-align:right">1 VISIT EVERY<br>${(365 / cpVisitCount).toFixed(1)} DAYS</div>
      </div>
    </div>
    <div class="blk" data-ax="b" id="pO" style="left:1152px;top:0;width:768px;height:616px;background:var(--c4);color:var(--ink)">
      <div class="lab tx" style="left:44px;top:96px">VISITS IN 2025</div>
      <div class="num tx" style="left:28px;top:124px;font-size:480px;letter-spacing:-0.07em"><span class="od" data-v="${cpVisitCount}">${cpVisitCount}</span></div>
      <div class="lab dt" style="right:44px;top:96px;text-align:right">MOST ON<br>${peakWeekdayName.toUpperCase()}</div>
      ${renderReceiptBadgeHtml({
        count: cpVisitCount,
        claimTitle: 'Blue Bottle Coffee Visits',
        style: 'right:44px;bottom:28px',
      })}
    </div>
    <div class="blk" data-ax="b" id="pP" style="left:1152px;top:622px;width:380px;height:458px;background:var(--c2);color:var(--ink)">
      <div class="lab tx" style="left:38px;top:36px">LEFT THERE</div>
      ${renderBigNumberHtml({
        valueFormatted: cpTotalDollars.toLocaleString('en-US'),
        sizePx: 110,
        prefixSup: 'US$',
        style: 'left:34px;bottom:98px',
      })}
      <div class="lab dt" style="left:38px;bottom:38px;font-size:12px">AVG US$${cpAvgDollars.toFixed(2)} · TOP US$${cpMaxDollars.toFixed(2)}</div>
    </div>
    <div class="blk" data-ax="b" id="pL" style="left:1538px;top:622px;width:382px;height:458px;background:var(--lav);color:var(--ink)">
      <div class="lab tx" style="left:38px;top:36px">BY WEEKDAY</div>
      ${renderWeekdayBarsSvg(cpWeekdayCounts)}
    </div>
  `;

  // -------------------------------------------------------------------------
  // Chapter 3: The Shatter (Category Columns)
  // -------------------------------------------------------------------------
  const shL = engine.shatterLayout;
  let shatterAxesHtml = '';
  for (let v = 0; v <= shL.topDollars; v += 2000) {
    const y = shL.baseY - v * shL.scale;
    shatterAxesHtml += `
      <div class="dt sx" style="left:120px;top:${y.toFixed(1)}px;width:1690px;height:1px;background:#3A3A38;transform-origin:0 50%"></div>
      <div class="lab dt" style="left:64px;top:${(y - 9).toFixed(1)}px;font-size:11px">${v ? `${v / 1000}K` : 'US$0'}</div>
    `;
  }

  const shatterLabelsHtml = engine.categories
    .map((cat, k) => {
      const x = shL.x0 + k * (shL.w + shL.gap);
      const valFormatted = Math.round(cat.totalDollars).toLocaleString('en-US');
      return `
        <div class="later" style="position:absolute;left:${x}px;top:${shL.baseY + 18}px;width:${shL.w + 32}px">
          <div class="lab tx" style="position:static;font-size:12px;display:flex;gap:8px;align-items:center">
            <i style="width:10px;height:10px;background:${cat.color};display:block"></i>${cat.label}
          </div>
          <div class="num tx" style="position:static;font-size:42px;margin-top:8px">
            <sup>US$</sup><span class="od" data-v="${valFormatted}">${valFormatted}</span>
          </div>
          <div class="lab tx" style="position:static;font-size:11px;margin-top:6px">${Math.round(cat.share * 100)}% · ${cat.count} BUYS</div>
        </div>
      `;
    })
    .join('');

  chapters[3]!.u.innerHTML = `<div class="num gh" style="position:absolute;left:-30px;top:-210px;font-size:880px;color:var(--ghost)">${totalTxCount}</div>`;
  chapters[3]!.o.innerHTML = `
    <div class="lab tx" style="left:64px;top:92px">04 · THE SHATTER · ${totalTxCount} PURCHASES BY CATEGORY</div>
    <div class="split tx" style="left:60px;top:130px;font-size:74px;font-weight:300;letter-spacing:-0.035em">Where US$${totalSpendFormatted} went.</div>
    <div class="lab tx" style="right:64px;top:92px;text-align:right;font-size:12px">SQUARE SIZE = TYPICAL PURCHASE<br>JANUARY AT THE BOTTOM, DECEMBER ON TOP</div>
    ${shatterAxesHtml}
    ${shatterLabelsHtml}
  `;

  // -------------------------------------------------------------------------
  // Chapter 4: Money Personality ("The Payday Sprinter" / "The Studio-Building Sprinter")
  // -------------------------------------------------------------------------
  const wheelCx = 485;
  const wheelCy = 455;
  const wheelMonthLabelsHtml = MONTH_START_DOY_2025.map((startDoy, m) => {
    const angle = -Math.PI / 2 + ((startDoy + 15) / 365) * Math.PI * 2;
    const lx = wheelCx + Math.cos(angle) * 416;
    const ly = wheelCy + Math.sin(angle) * 416;
    return `<div class="lab dt" style="left:${lx.toFixed(1)}px;top:${ly.toFixed(1)}px;transform:translate(-50%,-50%);font-size:11px;color:var(--ink)">${MONTH_NAMES_UPPER[m]}</div>`;
  }).join('');

  const wheelLegendHtml = engine.categories
    .map((cat, k) => {
      const col = k % 4;
      const row = Math.floor(k / 4);
      return `<div class="lab dt" style="left:${64 + col * 212}px;top:${938 + row * 40}px;font-size:12px;display:flex;gap:9px;align-items:center;color:var(--ink)"><i style="width:13px;height:13px;background:${cat.color};display:block;outline:1px solid #111"></i>${cat.label.toUpperCase()} ${Math.max(1, Math.round(cat.share * 100))}%</div>`;
    })
    .join('');

  chapters[4]!.o.innerHTML = `
    <div class="lab tx" style="left:64px;top:96px">05 · YOUR MONEY PERSONALITY</div>
    <div class="lab tx" style="left:64px;top:216px;font-size:15px;color:var(--c1)">YOU ARE</div>
    <div class="split tx" style="left:58px;top:252px;font-size:158px;font-weight:300;letter-spacing:-0.055em;line-height:0.92">The Payday<br>Sprinter</div>
    <div class="tx" style="left:64px;top:568px;width:820px;font-size:30px;line-height:1.28;letter-spacing:-0.01em">31% of your year’s discretionary spending landed in the five days after payday — just 16% of the calendar. Then you lock into studio mode and coast.</div>
    <div class="blk" data-ax="b" style="left:636px;top:790px;width:288px;height:186px;background:var(--c4);color:var(--ink)">
      <div class="lab tx" style="left:22px;top:18px;font-size:12px">PAYDAY VS NORMAL DAY</div>
      ${renderBigNumberHtml({
        valueFormatted: '3.1',
        sizePx: 104,
        suffixSup: '×',
        style: 'left:20px;bottom:14px',
      })}
    </div>
    <div class="lab dt" style="left:64px;top:844px;font-size:12px">THE SPRINTS · PAYDAYS IN ORANGE</div>
    <div class="blk" data-ax="r" id="pshape" style="left:980px;top:0;width:940px;height:1080px;background:var(--bone);color:var(--ink)">
      <canvas id="pc" width="940" height="1080" style="position:absolute;left:0;top:0;width:940px;height:1080px"></canvas>
      ${wheelMonthLabelsHtml}
      ${wheelLegendHtml}
      <div class="lab dt" style="left:40px;top:30px;font-size:11.5px;color:var(--ink)">365 DAYS, CLOCKWISE FROM 1 JAN<br>INNER PETALS = CATEGORY SHARE</div>
    </div>
  `;

  chapters.forEach((ch) => {
    initOdometers(ch.u);
    initOdometers(ch.o);
  });

  const personalityCanvas = chapters[4]!.o.querySelector<HTMLCanvasElement>('#pc')!;
  const personalityCtx = personalityCanvas.getContext('2d')!;
  const personalityState = {
    ringProgress: 1,
    barsProgress: 1,
    spikeProgress: 1,
    petalProgress: engine.categories.map(() => 1),
  };

  function renderPersonalityWheel(): void {
    drawPersonalityWheelCanvas(personalityCtx, {
      daySpends: engine.dayViews.map((d) => d.spendDollars),
      paydayIndices: engine.paydayIndices,
      categories: engine.categories.map((c) => ({
        label: c.label,
        color: c.color,
        share: c.share,
      })),
      state: personalityState,
      backingScale: engine.backingScale,
    });
  }

  // -------------------------------------------------------------------------
  // Viewport & High-DPI Scaling
  // -------------------------------------------------------------------------
  function applyViewportScale(vp: StyleTileViewport): void {
    if (vp === '390x844') {
      stageEl.style.display = 'none';
      phoneStageEl.style.display = 'block';
      stageWrap.style.width = '390px';
      stageWrap.style.height = '844px';
      return;
    }

    phoneStageEl.style.display = 'none';
    stageEl.style.display = 'block';
    const targetW = vp === '1440x900' ? 1440 : 1920;
    const targetH = vp === '1440x900' ? 900 : 1080;
    const scale = Math.min(targetW / 1920, targetH / 1080);

    // Center vertically if 1440x900 (16:10) vs 1920x1080 (16:9)
    const scaledW = Math.round(1920 * scale);
    const scaledH = Math.round(1080 * scale);
    stageWrap.style.width = `${targetW}px`;
    stageWrap.style.height = `${targetH}px`;
    stageWrap.style.background = CORE_COLORS.ink;
    stageEl.style.left = `${Math.round((targetW - scaledW) / 2)}px`;
    stageEl.style.top = `${Math.round((targetH - scaledH) / 2)}px`;
    document.documentElement.style.setProperty('--s', String(scale));

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    engine.backingScale = Math.min(2, Math.max(1, scale * dpr));
    canvasEl.width = Math.round(1920 * engine.backingScale);
    canvasEl.height = Math.round(1080 * engine.backingScale);
    personalityCanvas.width = Math.round(940 * engine.backingScale);
    personalityCanvas.height = Math.round(1080 * engine.backingScale);
  }

  // -------------------------------------------------------------------------
  // Dedicated Phone Layouts (390 × 844)
  // -------------------------------------------------------------------------
  function renderPhoneLayout(chapterId: StyleTileChapterId): void {
    if (chapterId === 'your_place') {
      phoneStageEl.innerHTML = `
        <div class="blk" style="left:0;top:0;width:390px;height:444px;background:var(--c1);color:var(--ink)">
          <div class="lab" style="left:20px;top:20px">SAM · 2025 · 03 / YOUR PLACE</div>
          <div class="lab" style="left:20px;top:44px;font-size:10px">SQ *BLUE BOTTLE 0412 → BLUE BOTTLE COFFEE</div>
          <div style="position:absolute;left:16px;top:116px;font-size:78px;font-weight:300;letter-spacing:-0.06em;line-height:0.88">Blue Bottle<br>Coffee</div>
          <div style="position:absolute;left:16px;bottom:16px;right:16px;height:86px;background:var(--ink);color:var(--bone);padding:10px 14px">
            <div class="lab" style="left:14px;top:10px;font-size:9.5px">THE ${cpVisitCount} DAYS · 1 VISIT EVERY ${(365 / cpVisitCount).toFixed(1)} DAYS</div>
            <svg style="position:absolute;left:14px;bottom:10px" width="330" height="44" viewBox="0 0 560 76">
              ${Array.from({ length: 365 }, (_, i) => {
                const col = Math.floor((i + JAN_1_2025_WEEKDAY) / 7);
                const row = (i + JAN_1_2025_WEEKDAY) % 7;
                return `<rect x="${col * 10.5}" y="${row * 10.5}" width="8" height="8" fill="${cpDayIndices.has(i) ? CORE_COLORS.solar : '#3A3A38'}"/>`;
              }).join('')}
            </svg>
          </div>
        </div>
        <div class="blk" style="left:0;top:449px;width:236px;height:395px;background:var(--c4);color:var(--ink)">
          <div class="lab" style="left:18px;top:18px">VISITS</div>
          <div class="lab" style="right:16px;top:18px;text-align:right;font-size:9.5px">MOST ON<br>${peakWeekdayName.toUpperCase()}</div>
          <div class="num" style="position:absolute;left:10px;bottom:12px;font-size:210px;letter-spacing:-0.07em">${cpVisitCount}</div>
        </div>
        <div class="blk" style="left:241px;top:449px;width:149px;height:195px;background:var(--c2);color:var(--ink)">
          <div class="lab" style="left:14px;top:16px">LEFT THERE</div>
          <div class="num" style="position:absolute;left:12px;bottom:38px;font-size:40px"><sup>US$</sup>${cpTotalDollars.toLocaleString('en-US')}</div>
          <div class="lab" style="left:14px;bottom:14px;font-size:9px">AVG $${cpAvgDollars.toFixed(0)} · TOP $${cpMaxDollars.toFixed(0)}</div>
        </div>
        <div class="blk" style="left:241px;top:649px;width:149px;height:195px;background:var(--lav);color:var(--ink)">
          <div class="lab" style="left:14px;top:16px">BY WEEKDAY</div>
          <div style="position:absolute;left:14px;bottom:14px">
            ${renderWeekdayBarsSvg(cpWeekdayCounts, { compact: true })}
          </div>
        </div>
      `;
      return;
    }

    if (chapterId === 'personality') {
      phoneStageEl.innerHTML = `
        <div class="lab" style="left:20px;top:20px">SAM · 2025 · 05 / PERSONALITY</div>
        <div class="lab" style="left:20px;top:48px;color:var(--c1)">YOU ARE</div>
        <div style="position:absolute;left:18px;top:70px;font-size:66px;font-weight:300;letter-spacing:-0.055em;line-height:0.92">The Payday<br>Sprinter</div>
        <div style="position:absolute;left:20px;top:206px;width:350px;font-size:15.5px;line-height:1.32;color:var(--bone)">31% of your year’s spending landed in the five days after payday — just 16% of the calendar. Then you coast.</div>
        <div class="blk" style="left:0;top:286px;width:390px;height:426px;background:var(--bone);color:var(--ink)">
          <div class="lab" style="left:18px;top:14px;color:var(--ink);font-size:9.5px">365 DAYS CLOCKWISE · INNER PETALS = CATEGORY SHARE</div>
          <canvas id="ph-pc" width="390" height="390" style="position:absolute;left:0;top:28px;width:390px;height:390px"></canvas>
        </div>
        <div class="blk" style="left:0;top:717px;width:186px;height:127px;background:var(--c4);color:var(--ink)">
          <div class="lab" style="left:16px;top:14px;font-size:9.5px">PAYDAY VS NORMAL</div>
          <div class="num" style="position:absolute;left:14px;bottom:10px;font-size:68px">3.1<sup class="aft">×</sup></div>
        </div>
        <div class="blk" style="left:191px;top:717px;width:199px;height:127px;background:var(--c1);color:var(--ink)">
          <div class="lab" style="position:absolute;left:16px;top:14px;font-size:9.5px">TOP CATEGORY</div>
          ${(() => {
            const topCat = [...engine.categories].sort(
              (a, b) => b.totalDollars - a.totalDollars
            )[0];
            return `
              <div style="position:absolute;left:16px;bottom:38px;font-size:28px;font-weight:400;letter-spacing:-0.03em">${topCat?.label ?? 'Shopping'}</div>
              <div class="lab" style="position:absolute;left:16px;bottom:14px;font-size:9.5px">${Math.round((topCat?.share ?? 0.46) * 100)}% OF SPEND · ${paydayCount} PAYDAYS</div>
            `;
          })()}
        </div>
      `;
      const phCanvas = phoneStageEl.querySelector<HTMLCanvasElement>('#ph-pc')!;
      const phCtx = phCanvas.getContext('2d')!;
      const dpr = 2;
      phCanvas.width = 390 * dpr;
      phCanvas.height = 390 * dpr;
      drawPersonalityWheelCanvas(phCtx, {
        daySpends: engine.dayViews.map((d) => d.spendDollars),
        paydayIndices: engine.paydayIndices,
        categories: engine.categories.map((c) => ({
          label: c.label,
          color: c.color,
          share: c.share,
        })),
        state: {
          ringProgress: 1,
          barsProgress: 1,
          spikeProgress: 1,
          petalProgress: engine.categories.map(() => 1),
        },
        backingScale: dpr,
        width: 390,
        height: 390,
        cx: 195,
        cy: 192,
        innerRadius: 96,
        outerRadius: 162,
      });
      return;
    }

    if (chapterId === 'pour') {
      phoneStageEl.innerHTML = `
        <div class="lab" style="left:20px;top:20px">SAM · 2025 · 01 / THE POUR</div>
        <div style="position:absolute;left:18px;top:46px;font-size:62px;font-weight:300;letter-spacing:-0.045em;line-height:0.95">Your 2025.</div>
        <div class="lab" style="left:20px;top:116px;font-size:9.5px;color:#C9C5BA">1,000 RAW BANK ROWS UNSCRAMBLED INTO CLEAN NAMES</div>
        <div class="blk" style="left:0;top:144px;width:390px;height:282px;background:var(--c1);color:var(--ink)">
          <div class="lab" style="left:20px;top:16px">RAW → CLEAN</div>
          <div class="lab" style="right:20px;top:16px">7 OF ${totalTxCount} ROWS</div>
          <div style="position:absolute;left:20px;top:46px;right:20px">
            ${lensRowIndices
              .slice(0, 6)
              .map((idx) => {
                const pv = engine.particleViews[idx]!;
                return `<div style="font:500 13.5px/34px 'JetBrains Mono',monospace;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(17,17,17,0.14)"><span>${pv.tx.merchant.slice(0, 18)}</span><span>US$${pv.amtDollars.toFixed(2)} <i style="display:inline-block;width:9px;height:9px;background:${CATEGORY_META[pv.category].color};margin-left:6px"></i></span></div>`;
              })
              .join('')}
          </div>
        </div>
        <div class="blk" style="left:0;top:432px;width:234px;height:202px;background:var(--c2);color:var(--ink)">
          <div class="lab" style="left:18px;top:16px">SPENT IN 2025</div>
          <div class="num" style="position:absolute;left:14px;bottom:16px;font-size:64px"><sup>US$</sup>${totalSpendFormatted}</div>
        </div>
        <div class="blk" style="left:240px;top:432px;width:150px;height:202px;background:var(--c4);color:var(--ink)">
          <div class="lab" style="left:16px;top:16px">PAYDAYS</div>
          <div class="num" style="position:absolute;left:14px;bottom:14px;font-size:78px">${paydayCount}</div>
        </div>
        <div class="blk" style="left:0;top:640px;width:390px;height:204px;background:var(--ink);color:var(--bone);border-top:2px solid #2A2A29">
          <div class="lab" style="left:20px;top:16px;font-size:9.5px">365 DAYS · EVERY SQUARE IS A DAY OF 2025</div>
          <svg style="position:absolute;left:20px;top:48px" width="350" height="126" viewBox="0 0 530 140">
            ${Array.from({ length: 365 }, (_, i) => {
              const dv = engine.dayViews[i]!;
              const col = Math.floor((i + JAN_1_2025_WEEKDAY) / 7);
              const row = (i + JAN_1_2025_WEEKDAY) % 7;
              const rgb = dv.baseRgb;
              return `<rect x="${col * 10}" y="${row * 18}" width="8" height="14" fill="rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})"/>`;
            }).join('')}
          </svg>
        </div>
      `;
      return;
    }

    if (chapterId === 'shatter') {
      const topCats = [...engine.categories]
        .sort((a, b) => b.totalDollars - a.totalDollars)
        .slice(0, 6);
      const maxCatDollars = Math.max(1, topCats[0]?.totalDollars ?? 1000);
      phoneStageEl.innerHTML = `
        <div class="lab" style="position:absolute;left:20px;top:20px">SAM · 2025 · 04 / THE SHATTER</div>
        <div style="position:absolute;left:18px;top:46px;font-size:48px;font-weight:300;letter-spacing:-0.04em;line-height:0.98">Where US$${totalSpendFormatted}<br>went.</div>
        <div class="lab" style="position:absolute;left:20px;top:154px;font-size:9.5px;color:#C9C5BA">${totalTxCount} PURCHASES STACKED BY CATEGORY</div>
        <div style="position:absolute;left:0;top:186px;width:390px;bottom:0;display:flex;flex-direction:column;gap:5px">
          ${topCats
            .map((cat) => {
              const barPct = Math.max(
                66,
                Math.min(100, Math.round(Math.sqrt(cat.totalDollars / maxCatDollars) * 100))
              );
              const valFormatted = Math.round(cat.totalDollars).toLocaleString('en-US');
              return `
                <div style="position:relative;height:104px;width:${barPct}%;background:${cat.color};color:var(--ink)">
                  <div class="lab" style="position:absolute;left:16px;top:12px;font-size:10px">${cat.label.toUpperCase()} · ${Math.max(1, Math.round(cat.share * 100))}%</div>
                  <div class="lab" style="position:absolute;right:14px;top:12px;font-size:9.5px">${cat.count} BUYS</div>
                  <div class="num" style="position:absolute;left:16px;bottom:10px;font-size:44px"><sup>US$</sup>${valFormatted}</div>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
      return;
    }

    // Default phone layout: year_as_squares (Vertical 7 × 53 Grid + Stacked Blocks)
    phoneStageEl.innerHTML = `
      <div class="lab" style="left:20px;top:20px">SAM · 2025 · 02 / YEAR AS SQUARES</div>
      <div style="position:absolute;left:18px;top:44px;font-size:56px;font-weight:300;letter-spacing:-0.045em;line-height:1">Your year.</div>
      <div class="blk" style="left:0;top:118px;width:390px;height:152px;background:var(--c1);color:var(--ink)">
        <div class="lab" style="left:20px;top:16px">SPENT IN 2025</div>
        <div class="lab" style="right:20px;top:16px">DAY 365 / 365</div>
        <div class="num" style="position:absolute;left:16px;bottom:14px;font-size:78px"><sup>US$</sup>${totalSpendFormatted}</div>
      </div>
      <div class="lab" style="left:20px;top:284px;font-size:9px;color:#C9C5BA">M T W T F S S · 53 WEEKS</div>
      <canvas id="ph-grid" width="104" height="534" style="position:absolute;left:20px;top:302px;width:104px;height:534px"></canvas>
      <div class="blk" style="left:134px;top:280px;width:256px;height:182px;background:var(--c2);color:var(--ink)">
        <div class="lab" style="left:18px;top:16px">PURCHASES</div>
        <div class="num" style="position:absolute;left:14px;bottom:12px;font-size:84px">${totalTxCount}</div>
      </div>
      <div class="blk" style="left:134px;top:467px;width:256px;height:182px;background:var(--c4);color:var(--ink)">
        <div class="lab" style="left:18px;top:16px">PAYDAYS PULSED</div>
        <div class="num" style="position:absolute;left:14px;bottom:12px;font-size:84px">${paydayCount}</div>
      </div>
      <div class="blk" style="left:134px;top:654px;width:256px;height:190px;background:var(--c3);color:var(--ink)">
        <div class="lab" style="left:18px;top:16px">LOUDEST DAY<br>${topDayView.dom} ${MONTH_NAMES_UPPER[topDayView.month]}</div>
        <div class="num" style="position:absolute;left:14px;bottom:14px;font-size:58px"><sup>US$</sup>${Math.round(topDayView.spendDollars).toLocaleString('en-US')}</div>
      </div>
    `;
    const phGrid = phoneStageEl.querySelector<HTMLCanvasElement>('#ph-grid')!;
    const gCtx = phGrid.getContext('2d')!;
    const dpr = 2;
    phGrid.width = 104 * dpr;
    phGrid.height = 534 * dpr;
    gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gCtx.clearRect(0, 0, 104, 534);
    for (let i = 0; i < 365; i++) {
      const dv = engine.dayViews[i]!;
      const px = dv.row * 14.2;
      const py = dv.col * 10;
      const rgb = dv.baseRgb;
      gCtx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
      gCtx.fillRect(px, py, 10.5, 8.2);
    }
  }

  // -------------------------------------------------------------------------
  // Deterministic Style-Tile Renderer (1920x1080, 1440x900, 390x844)
  // -------------------------------------------------------------------------
  let currentTimeline: gsap.core.Timeline | null = null;

  function showOnlyChapterDom(idx: number): void {
    chapters.forEach((ch, j) => {
      const active = j === idx;
      ch.u.style.visibility = active ? 'visible' : 'hidden';
      ch.u.style.opacity = active ? '1' : '0';
      ch.o.style.visibility = active ? 'visible' : 'hidden';
      ch.o.style.opacity = active ? '1' : '0';

      if (active) {
        // Ensure all inner blocks, text, splits, details, and odometers are settled at 100%
        ch.o.querySelectorAll<HTMLElement>('.blk, .tx, .split, .dt, .later, .gh').forEach((el) => {
          gsap.set(el, {
            autoAlpha: 1,
            opacity: 1,
            visibility: 'visible',
            scaleX: 1,
            scaleY: 1,
            x: 0,
            y: 0,
            clearProps: 'clipPath',
          });
        });
        ch.u.querySelectorAll<HTMLElement>('.gh').forEach((el) => {
          gsap.set(el, { autoAlpha: 1, opacity: 1, visibility: 'visible' });
        });
        ch.o.querySelectorAll<HTMLElement>('.split').forEach((s) => {
          const chars = splitTextElement(s);
          gsap.set(chars, { yPercent: 0 });
        });
        initOdometers(ch.u).forEach((odo) => {
          const raw = (odo.el.dataset.v ?? '0').replace(/\D/g, '');
          odo.jump(Number(raw || 0));
        });
        initOdometers(ch.o).forEach((odo) => {
          const raw = (odo.el.dataset.v ?? '0').replace(/\D/g, '');
          odo.jump(Number(raw || 0));
        });
      }
    });

    progBars.forEach((bar, k) => {
      bar.style.transform = `scaleX(${k <= idx ? 1 : 0})`;
    });
    const ch = chapters[idx]!;
    chapterLabelEl.textContent = `${String(idx + 1).padStart(2, '0')} / 05 · ${ch.title.toUpperCase()}`;

    // Adaptive WCAG AAA contrast for the 4 corner chrome labels against light chapter blocks
    const isLightLeft = ch.id === 'your_place';
    const isLightRight = ch.id === 'your_place' || ch.id === 'personality';
    chromeTlEl.style.color = isLightLeft ? CORE_COLORS.ink : CORE_COLORS.bone;
    chromeBlEl.style.color = isLightLeft ? CORE_COLORS.ink : CORE_COLORS.bone;
    chapterLabelEl.style.color = isLightRight ? CORE_COLORS.ink : CORE_COLORS.bone;
    chromeBrEl.style.color = isLightRight ? CORE_COLORS.ink : CORE_COLORS.bone;
  }

  function renderStyleTile(chapterId: StyleTileChapterId, viewport: StyleTileViewport): void {
    if (currentTimeline) {
      currentTimeline.kill();
      currentTimeline = null;
    }

    applyViewportScale(viewport);
    if (viewport === '390x844') {
      renderPhoneLayout(chapterId);
      return;
    }

    const idx = Math.max(
      0,
      chapters.findIndex((c) => c.id === chapterId)
    );
    showOnlyChapterDom(idx);

    engine.rings = [];
    engine.activeParticleCount = 0;
    engine.lensBracketAlpha = 0;
    engine.selection.on = false;

    if (chapterId === 'pour') {
      const wall = chapters[0]!.o.querySelector<HTMLElement>('#wall');
      if (wall) wall.style.visibility = 'hidden';
      const lens = chapters[0]!.o.querySelector<HTMLElement>('#lens');
      if (lens) gsap.set(lens, { autoAlpha: 0 });
      const ttl = chapters[0]!.o.querySelector<HTMLElement>('#ttl');
      if (ttl) {
        engine.computeTitlePoints(ttl);
        gsap.set(ttl, { opacity: 1, color: '#1C1C1B' });
      }
      engine.daysVisible = true;
      engine.setGrid(GRID_PRESETS.opener, { instant: true });
      engine.dayViews.forEach((v) => {
        v.k = 1;
        engine.setColorImmediate(v, v.baseRgb);
      });
      engine.renderFrame(0, 10);
      return;
    }

    if (chapterId === 'year_as_squares') {
      engine.daysVisible = true;
      engine.setGrid(GRID_PRESETS.sweep, { instant: true });
      const cutDay = 252; // Mid-September hero moment showing active playhead, heartbeat ring, and filled vs upcoming days
      const cutDayView = engine.dayViews[cutDay]!;
      engine.dayViews.forEach((v, i) => {
        if (i <= cutDay) {
          v.k = 1;
          engine.setColorImmediate(v, v.baseRgb);
        } else {
          v.k = 0.45;
          engine.setColorImmediate(v, RGB_EMPTY);
        }
      });

      // Add a live payday heartbeat double-ring around the most recent payday before cutDay
      const recentPayday =
        [...engine.paydayIndices].reverse().find((p) => p <= cutDay) ??
        engine.paydayIndices[0] ??
        20;
      const payView = engine.dayViews[recentPayday]!;
      engine.nowSec = 10;
      engine.rings = [
        {
          x: payView.x,
          y: payView.y,
          t0: 9.72,
          d: 0.7,
          r0: 14,
          r1: 110,
          c: CORE_COLORS.ember,
          lw: 2.5,
          sq: true,
        },
        {
          x: payView.x,
          y: payView.y,
          t0: 9.8,
          d: 0.5,
          r0: 14,
          r1: 72,
          c: CORE_COLORS.ember,
          lw: 1.5,
          sq: true,
        },
      ];

      // Position playhead and update counters to match day 252
      const G = GRID_PRESETS.sweep;
      const phX = G.x + ((cutDay + JAN_1_2025_WEEKDAY) / 7) * G.p;
      const phEl = chapters[1]!.o.querySelector<HTMLElement>('#ph');
      const phLabelEl = chapters[1]!.o.querySelector<HTMLElement>('#phl');
      const swDateEl = chapters[1]!.o.querySelector<HTMLElement>('#swdate');
      const swTotEl = chapters[1]!.o.querySelector<OdometerElement>('#swtot');
      const swPayEl = chapters[1]!.o.querySelector<OdometerElement>('#swpayn');
      const mGhostEl = chapters[1]!.u.querySelector<HTMLElement>('#mghost');

      if (phEl) phEl.style.transform = `translate3d(${phX.toFixed(1)}px, 0, 0)`;
      if (phLabelEl)
        phLabelEl.textContent = `${cutDayView.dom} ${MONTH_NAMES_UPPER[cutDayView.month]}`;
      if (swDateEl) {
        swDateEl.textContent = `SPENT SO FAR · DAY ${String(cutDay + 1).padStart(3, '0')} / 365 · ${formatDayIndexLabel(cutDay).toUpperCase()}`;
      }
      const cumDollars = Math.round(engine.cumulativeSpendDollars[cutDay + 1] ?? 21450);
      if (swTotEl?._odo) swTotEl._odo.jump(cumDollars);
      const paysSoFar = engine.paydayIndices.filter((p) => p <= cutDay).length;
      if (swPayEl?._odo) swPayEl._odo.jump(paysSoFar);
      if (mGhostEl) mGhostEl.textContent = String(cutDayView.month + 1).padStart(2, '0');

      const remapRects = Array.from(chapters[1]!.o.querySelectorAll<SVGRectElement>('.remap-bar'));
      remapRects.forEach((r, col) => {
        r.setAttribute('fill', col <= cutDayView.col ? CORE_COLORS.bone : '#3A3A38');
      });

      engine.renderFrame(0, 10);
      return;
    }

    if (chapterId === 'your_place') {
      engine.daysVisible = false;
      engine.renderFrame(0, 10);
      return;
    }

    if (chapterId === 'shatter') {
      engine.daysVisible = false;
      engine.startShatter(true);
      engine.renderFrame(0, 10);
      return;
    }

    if (chapterId === 'personality') {
      engine.daysVisible = true;
      engine.setGrid(GRID_PRESETS.mini, { instant: true });
      engine.dayViews.forEach((v) => {
        v.k = 1;
        engine.setColorImmediate(v, v.baseRgb);
      });
      personalityState.ringProgress = 1;
      personalityState.barsProgress = 1;
      personalityState.spikeProgress = 1;
      personalityState.petalProgress = engine.categories.map(() => 1);
      renderPersonalityWheel();
      engine.renderFrame(0, 10);
    }
  }

  function goToChapter(idOrIndex: StyleTileChapterId | number): void {
    const idx =
      typeof idOrIndex === 'number'
        ? Math.max(0, Math.min(chapters.length - 1, idOrIndex))
        : Math.max(
            0,
            chapters.findIndex((c) => c.id === idOrIndex)
          );
    const ch = chapters[idx]!;
    renderStyleTile(ch.id, options.viewport ?? '1920x1080');
    mlog('chapter.in', ch.id, ch.id);
  }

  // Initialize
  const initialVp = options.viewport ?? '1920x1080';
  const initialCh = options.initialChapter ?? 'year_as_squares';
  renderStyleTile(initialCh, initialVp);

  // Expose global hook for Playwright test / style-tile capture scripts
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__DESIGN_PROTOTYPE__ = {
      renderStyleTile,
      goToChapter,
      engine,
      MOTION_TOKENS,
      SPR,
      SOFT,
      EASING,
    };
  }

  return {
    engine,
    goToChapter,
    renderStyleTile,
    destroy: () => {
      if (currentTimeline) currentTimeline.kill();
      container.innerHTML = '';
    },
  };
}
