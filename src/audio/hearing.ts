/**
 * Hearing-check tone: a pulsed 1 kHz tone that starts far below audibility and rises
 * slowly until the listener says they hear it.
 *
 * SAFETY: this plays with the headphones ON the head. The level can never exceed
 * HEARING_MAX_DBFS. At that level even a very loud headphone (≈120 dB SPL for a
 * full-scale tone at max volume) stays near 65 dB SPL — quiet speech.
 */

export const HEARING_START_DBFS = -105;
export const HEARING_MAX_DBFS = -55;
export const HEARING_RATE_DB_PER_S = 1.5;
const PULSE_PERIOD_S = 0.6;
const PULSE_ON_S = 0.3;
const HOLD_AT_MAX_S = 2;

export interface HearingTrial {
  /** The listener heard it: resolves `done` with the current level. */
  heard(): void;
  cancel(): void;
  /** Level (dBFS) when "heard" was pressed, or null if never heard / cancelled. */
  done: Promise<number | null>;
}

export function startHearingTrial(ctx: AudioContext, onProgress?: (fraction: number) => void): HearingTrial {
  const osc = ctx.createOscillator();
  osc.frequency.value = 1000;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(ctx.destination);
  osc.start();

  const t0 = performance.now();
  const rampSeconds = (HEARING_MAX_DBFS - HEARING_START_DBFS) / HEARING_RATE_DB_PER_S;
  let level = HEARING_START_DBFS;
  let finished = false;
  let resolve!: (v: number | null) => void;
  const done = new Promise<number | null>((r) => (resolve = r));

  const finish = (v: number | null) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    setTimeout(() => {
      try { osc.stop(); } catch { /* already stopped */ }
      gain.disconnect();
    }, 100);
    resolve(v);
  };

  const timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    level = Math.min(HEARING_MAX_DBFS, HEARING_START_DBFS + HEARING_RATE_DB_PER_S * t);
    const on = t % PULSE_PERIOD_S < PULSE_ON_S;
    gain.gain.setTargetAtTime(on ? 10 ** (level / 20) : 0, ctx.currentTime, 0.01);
    onProgress?.(Math.min(1, t / rampSeconds));
    if (t > rampSeconds + HOLD_AT_MAX_S) finish(null);
  }, 50);

  return {
    heard: () => finish(level),
    cancel: () => finish(null),
    done,
  };
}
