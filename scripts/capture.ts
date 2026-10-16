import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import type { MotionEvent } from '../contracts/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const CAPTURE_DIR = path.resolve(APP_ROOT, 'capture');
const FRAMES_DIR = path.resolve(CAPTURE_DIR, 'frames');

const FPS = 60;
const DEMO_DURATION_SEC = 45;
const DEMO_TOTAL_FRAMES = DEMO_DURATION_SEC * FPS; // 2,700 frames

const LOOP_DURATION_SEC = 5;
const LOOP_TOTAL_FRAMES = LOOP_DURATION_SEC * FPS; // 300 frames

const KEYFRAMES: ReadonlyArray<{ timeSec: number; name: string }> = [
  { timeSec: 1.2, name: '01_pour_particles.png' },
  { timeSec: 3.5, name: '02_title_2025.png' },
  { timeSec: 7.5, name: '03_opener_count.png' },
  { timeSec: 12.0, name: '04_squares_sweep.png' },
  { timeSec: 16.5, name: '05_your_place.png' },
  { timeSec: 21.0, name: '06_bespoke_studio.png' },
  { timeSec: 25.5, name: '07_streak.png' },
  { timeSec: 28.0, name: '08_explore_selection.png' },
  { timeSec: 31.0, name: '09_ask_answer.png' },
  { timeSec: 33.5, name: '10_shatter_columns.png' },
  { timeSec: 35.4, name: '11_category_lens.png' },
  { timeSec: 39.0, name: '12_personality.png' },
  { timeSec: 43.5, name: '13_share_card.png' },
];

/**
 * Generates a 16-bit 44.1kHz stereo WAV buffer synchronized with the 120 BPM beat grid
 * and the recorded MotionEvent[] cues so the MP4 has a clean AAC audio track.
 */
function synthesizeSyncedWav(durationSec: number, events: readonly MotionEvent[]): Buffer {
  const sampleRate = 44100;
  const numChannels = 2;
  const totalSamples = Math.floor(durationSec * sampleRate);
  const dataBytes = totalSamples * numChannels * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  // WAV header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * 2, 28);
  buf.writeUInt16LE(numChannels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const addTone = (
    startSec: number,
    durSec: number,
    freqStart: number,
    freqEnd: number,
    amp: number,
    pan = 0
  ): void => {
    const i0 = Math.max(0, Math.floor(startSec * sampleRate));
    const i1 = Math.min(totalSamples - 1, Math.floor((startSec + durSec) * sampleRate));
    let phase = 0;
    const lGain = amp * Math.cos(((pan + 1) * Math.PI) / 4);
    const rGain = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = i0; i <= i1; i++) {
      const q = (i - i0) / Math.max(1, i1 - i0);
      const env = Math.sin(Math.min(1, q * 12) * (Math.PI / 2)) * Math.pow(1 - q, 2.2);
      const freq = freqStart + (freqEnd - freqStart) * q;
      phase += (2 * Math.PI * freq) / sampleRate;
      const sample = Math.sin(phase) * env;
      left[i] = (left[i] ?? 0) + sample * lGain;
      right[i] = (right[i] ?? 0) + sample * rGain;
    }
  };

  // Subtle 120 BPM (0.5s beat) warm pulse
  const totalBeats = Math.floor(durationSec / 0.5);
  for (let b = 0; b < totalBeats; b++) {
    const beatSec = b * 0.5;
    const isDownbeat = b % 4 === 0;
    addTone(
      beatSec,
      isDownbeat ? 0.14 : 0.09,
      isDownbeat ? 110 : 82.4,
      55,
      isDownbeat ? 0.09 : 0.045,
      0
    );
  }

  // Event-driven tonal cues from MotionEvent timeline
  for (const ev of events) {
    const tSec = ev.timestamp / 1000;
    if (tSec < 0 || tSec >= durationSec) continue;
    if (ev.type === 'start_open' || ev.type === 'title.handoff') {
      addTone(tSec, 0.32, 220, 440, 0.14, 0);
    } else if (ev.type === 'chapter.go') {
      addTone(tSec, 0.22, 330, 293.66, 0.1, -0.15);
    } else if (ev.type === 'sweep.payday') {
      addTone(tSec, 0.18, 587.33, 880, 0.08, 0.2);
    } else if (ev.type === 'shatter.break') {
      addTone(tSec, 0.28, 440, 164.81, 0.13, 0);
    } else if (ev.type === 'ask.answer') {
      addTone(tSec, 0.26, 523.25, 659.25, 0.12, 0.1);
    } else if (ev.type === 'share.export') {
      addTone(tSec, 0.35, 440, 659.25, 0.11, 0);
    }
  }

  for (let i = 0; i < totalSamples; i++) {
    const l = Math.max(-0.98, Math.min(0.98, left[i] ?? 0));
    const r = Math.max(-0.98, Math.min(0.98, right[i] ?? 0));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
  }

  return buf;
}

function runFfmpegEncodeFromPipe(
  outputMp4Path: string,
  wavPath: string,
  fps: number
): {
  writeFrame: (jpegBuf: Buffer) => Promise<void>;
  finish: () => Promise<void>;
} {
  const args = [
    '-y',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    '-framerate',
    String(fps),
    '-i',
    '-',
    '-i',
    wavPath,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '17',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputMp4Path,
  ];

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderrLog = '';
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrLog += chunk.toString();
  });

  const writeFrame = (jpegBuf: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!proc.stdin.writable) {
        reject(new Error(`ffmpeg stdin closed unexpectedly: ${stderrLog.slice(-400)}`));
        return;
      }
      const ok = proc.stdin.write(jpegBuf, (err) => {
        if (err) reject(err);
      });
      if (ok) {
        resolve();
      } else {
        proc.stdin.once('drain', resolve);
      }
    });

  const finish = (): Promise<void> =>
    new Promise((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderrLog.slice(-600)}`));
        }
      });
      proc.stdin.end();
    });

  return { writeFrame, finish };
}

async function main(): Promise<void> {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(APP_ROOT, '.playwright-browsers');
  }

  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  console.log('[capture] Starting local Vite server...');
  const server: ViteDevServer = await createServer({
    root: APP_ROOT,
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const addr = server.httpServer?.address();
  const port = typeof addr === 'object' && addr ? addr.port : 4173;
  const baseUrl = `http://127.0.0.1:${port}/`;

  console.log(`[capture] Vite listening at ${baseUrl}`);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app[data-ready="true"]', { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);

    // 1. Export high-res Share Cards in both sizes (1080x1350 and 1080x1920)
    console.log('[capture] Exporting Share Card PNGs (1080x1350 & 1080x1920)...');
    const shareCards = await page.evaluate(async () => {
      const bridge = window.__YEAR_APP__!;
      // Ensure we are on the share_card chapter when exporting
      bridge.goToChapter('share_card');
      const png1350 = await bridge.exportShareCardPng('1080x1350');
      const png1920 = await bridge.exportShareCardPng('1080x1920');
      return { png1350, png1920 };
    });

    const saveDataUrlPng = (dataUrl: string, targetPath: string): void => {
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(targetPath, Buffer.from(base64, 'base64'));
    };

    const share1350Path = path.resolve(CAPTURE_DIR, 'share_1080x1350.png');
    const share1920Path = path.resolve(CAPTURE_DIR, 'share_1080x1920.png');
    saveDataUrlPng(shareCards.png1350, share1350Path);
    saveDataUrlPng(shareCards.png1920, share1920Path);
    console.log(`[capture] Saved ${share1350Path} and ${share1920Path}`);

    // 2. Step through the 45-second storyboard first in a fast pass (<1s) to collect exact MotionEvent[]
    console.log('[capture] Collecting deterministic MotionEvent timeline across 45s storyboard...');
    const timelineEvents: MotionEvent[] = await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;
      bridge.player.timeline.clearEvents();
      (bridge.player as unknown as { started: boolean }).started = false;
      (bridge as unknown as { activeSegmentId: string }).activeSegmentId = '';

      const collected: MotionEvent[] = [];
      let seenCount = 0;

      for (let f = 0; f < 2700; f++) {
        const t = f / 60;
        bridge.seekFilm(t);
        if (f === 2680) {
          bridge.player.timeline.logEvent('share.export', '1080x1350');
        }
        const rawEvents = bridge.getMotionEvents();
        while (seenCount < rawEvents.length) {
          const ev = rawEvents[seenCount]!;
          collected.push({
            type: ev.type,
            timestamp: Math.round(t * 1000),
            beat: Math.floor(t / 0.5),
            chapter_id: ev.chapter_id,
            value: ev.value,
          });
          seenCount++;
        }
      }
      return collected;
    });

    const motionEventsPath = path.resolve(CAPTURE_DIR, 'motion_events.json');
    fs.writeFileSync(motionEventsPath, JSON.stringify(timelineEvents, null, 2) + '\n', 'utf8');
    console.log(`[capture] Wrote ${timelineEvents.length} motion events to ${motionEventsPath}`);

    // Synthesize 45s synced WAV for demo_1920x1080.mp4
    const demoWavPath = path.resolve(CAPTURE_DIR, '.tmp_demo_audio.wav');
    fs.writeFileSync(demoWavPath, synthesizeSyncedWav(DEMO_DURATION_SEC, timelineEvents));

    // Reset player for 2,700-frame 60fps video capture
    await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;
      bridge.player.timeline.clearEvents();
      (bridge.player as unknown as { started: boolean }).started = false;
      (bridge as unknown as { activeSegmentId: string }).activeSegmentId = '';
    });

    const demoMp4Path = path.resolve(CAPTURE_DIR, 'demo_1920x1080.mp4');
    const keyframeMap = new Map<number, string>();
    for (const kf of KEYFRAMES) {
      keyframeMap.set(Math.round(kf.timeSec * FPS), kf.name);
    }

    console.log(
      `[capture] Rendering ${DEMO_TOTAL_FRAMES} frames (45.0s @ 60fps, 1920x1080) -> ${demoMp4Path}...`
    );
    const demoEncoder = runFfmpegEncodeFromPipe(demoMp4Path, demoWavPath, FPS);
    const startMs = Date.now();

    for (let f = 0; f < DEMO_TOTAL_FRAMES; f++) {
      const t = f / FPS;
      await page.evaluate((timeSec: number) => {
        window.__YEAR_APP__!.seekFilm(timeSec);
      }, t);

      const jpegBuf = await page.screenshot({ type: 'jpeg', quality: 94 });
      await demoEncoder.writeFrame(jpegBuf);

      const kfName = keyframeMap.get(f);
      if (kfName) {
        const pngBuf = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.resolve(FRAMES_DIR, kfName), pngBuf);
      }

      if ((f + 1) % 300 === 0 || f === DEMO_TOTAL_FRAMES - 1) {
        const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
        console.log(
          `[capture]   frame ${f + 1} / ${DEMO_TOTAL_FRAMES} (t=${t.toFixed(2)}s, elapsed=${elapsedSec}s)`
        );
      }
    }

    await demoEncoder.finish();
    fs.rmSync(demoWavPath, { force: true });
    console.log(`[capture] Finished ${demoMp4Path}`);

    // 3. Render 5-second seamless loop (`capture/loop.mp4`, 300 frames @ 60fps)
    const loopMp4Path = path.resolve(CAPTURE_DIR, 'loop.mp4');
    const loopWavPath = path.resolve(CAPTURE_DIR, '.tmp_loop_audio.wav');
    const loopEvents: MotionEvent[] = [
      { type: 'shatter.break', timestamp: 350, beat: 0, chapter_id: 'shatter', value: 880 },
      { type: 'shatter.hold', timestamp: 1400, beat: 2, chapter_id: 'shatter', value: 8 },
      { type: 'shatter.snap', timestamp: 3900, beat: 7, chapter_id: 'shatter', value: 880 },
    ];
    fs.writeFileSync(loopWavPath, synthesizeSyncedWav(LOOP_DURATION_SEC, loopEvents));

    console.log(
      `[capture] Rendering ${LOOP_TOTAL_FRAMES} frames (5.0s loop @ 60fps, 1920x1080) -> ${loopMp4Path}...`
    );
    await page.evaluate(() => {
      const bridge = window.__YEAR_APP__!;
      (bridge as unknown as { activeSegmentId: string }).activeSegmentId = '';
    });

    const loopEncoder = runFfmpegEncodeFromPipe(loopMp4Path, loopWavPath, FPS);
    for (let f = 0; f < LOOP_TOTAL_FRAMES; f++) {
      const t = f / FPS;
      await page.evaluate((timeSec: number) => {
        window.__YEAR_APP__!.seekLoop(timeSec);
      }, t);
      const jpegBuf = await page.screenshot({ type: 'jpeg', quality: 94 });
      await loopEncoder.writeFrame(jpegBuf);
    }
    await loopEncoder.finish();
    fs.rmSync(loopWavPath, { force: true });
    console.log(`[capture] Finished ${loopMp4Path}`);

    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('[capture] Fatal error:', err);
  process.exit(1);
});
