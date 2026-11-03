import { summarizeBlock, type Block } from "../core/measure";
import type { Mic } from "./mic";
import { playSignal } from "./signals";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Longer than the analyser window (8192 samples ≈ 170 ms at 48 kHz). */
const MIC_WARMUP_MS = 400;

/** Samples the mic for `ms` and summarises it (energy-mean level, peak, spread). */
export async function measureFor(mic: Mic, ms: number): Promise<Block> {
  // Right after opening, the analyser's buffer is partly empty and reads too low.
  const wait = mic.openedAt + MIC_WARMUP_MS - performance.now();
  if (wait > 0) await sleep(wait);
  const readings: number[] = [];
  let peak = 0;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    readings.push(mic.readDbfs());
    peak = Math.max(peak, mic.readPeak());
    await sleep(100);
  }
  return summarizeBlock(readings, peak);
}

/**
 * Plays a 1 kHz tone, waits for the output path to settle (Bluetooth adds a few hundred
 * ms of delay), measures the mic, then stops. The tone is always stopped, even on error.
 */
export async function playToneAndMeasure(
  ctx: AudioContext,
  mic: Mic,
  dbfs: number,
  opts: { settleMs?: number; measureMs?: number } = {},
): Promise<Block> {
  const tone = playSignal(ctx, "sine", dbfs);
  try {
    await sleep(opts.settleMs ?? 900);
    return await measureFor(mic, opts.measureMs ?? 1000);
  } finally {
    tone.stop();
  }
}
