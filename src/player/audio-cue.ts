import type { MotionEvent } from '../../contracts/index.js';

export interface AudioCueEvent {
  cue: string;
  timestampMs: number;
  beat: number;
  payload?: MotionEvent['value'];
}

/**
 * Web Audio cue slot and procedural tactile pulse synthesizer (Rule 9: no copyrighted music in repo;
 * leaves an audio cue slot and deterministic event log for sound designers).
 */
export class AudioCueSlot {
  private audioCtx: AudioContext | null = null;
  private unlocked = false;
  private muted = true; // Muted by default for social feed autoplay; unlocks cleanly on user click
  private readonly cueLog: AudioCueEvent[] = [];

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /**
   * Unlocks the Web Audio API context when the user presses "Open your 2025" on the Start screen.
   */
  public unlock(): boolean {
    this.unlocked = true;
    try {
      const AudioCtx =
        typeof window !== 'undefined'
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
      if (AudioCtx && !this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
    } catch {
      // Headless or restricted audio environment — safely continue without throwing
    }
    this.triggerCue('start_open', 0, 0, { unlocked: true });
    return this.unlocked;
  }

  public triggerCue(
    cue: string,
    timestampMs: number,
    beat: number,
    payload?: MotionEvent['value']
  ): void {
    this.cueLog.push({
      cue,
      timestampMs,
      beat,
      payload,
    });

    if (!this.unlocked || this.muted || !this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = cue.includes('payday') ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(cue.includes('payday') ? 164.81 : 110, now);
      gain.gain.setValueAtTime(0.015, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.085);
    } catch {
      // Ignore synthesis errors in restricted environments
    }
  }

  public getCueLog(): readonly AudioCueEvent[] {
    return this.cueLog;
  }
}
