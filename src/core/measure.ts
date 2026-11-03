/**
 * Pure analysis for the guided calibration flow (PLAN §1): room check, mic test,
 * volume steps and hearing check. No browser APIs — the UI feeds in measured numbers.
 *
 * Every threshold below is a HEURISTIC chosen for the first test version, not a
 * validated value. They are named so milestone 3 can tune them.
 */
import {
  deviceFromMicTest,
  type Estimate,
  type HeadphoneType,
} from "./calibration";

/** Room is "too loud" if the mic's background level is above this (dBFS, heuristic). */
export const ROOM_MAX_DBFS = -55;
/** Background that swings more than this over the check is speech/music, not steady noise. */
export const ROOM_MAX_SPREAD_DB = 8;
/** Below this the mic is effectively muted or disconnected. */
export const MIC_DEAD_DBFS = -110;
/** A test tone must stand this far above the room noise at the mic to be used. */
export const MIN_SNR_DB = 15;
/** Samples at or above this peak (|x|, full scale = 1) are treated as clipped. */
export const CLIP_PEAK = 0.9;
/** Per-step (mic − played) may deviate this much from the others before we call it non-linear. */
export const LINEARITY_TOL_DB = 2;
/** Stop raising the test level once the mic reads louder than this (dBFS). */
export const MIC_CEILING_DBFS = -30;
/** A "lower" volume step that reads louder than max by more than this means the volume wasn't lowered. */
export const VOLUME_NOT_LOWER_DB = 1.5;
/** Two hearing trials further apart than this are flagged inconsistent. */
export const HEARING_CONSISTENT_DB = 6;

/** Energy (power) mean of dB values; ignores non-finite values. -Infinity if none. */
export function energyMeanDb(values: number[]): number {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return -Infinity;
  return 10 * Math.log10(v.reduce((a, x) => a + 10 ** (x / 10), 0) / v.length);
}

/** One measurement window from the mic. */
export interface Block {
  dbfs: number; // energy-mean level over the window
  peak: number; // largest |sample| seen
  spreadDb: number; // max − min of the per-reading levels
}

export function summarizeBlock(readings: number[], peak: number): Block {
  const finite = readings.filter(Number.isFinite);
  return {
    dbfs: energyMeanDb(readings),
    peak,
    spreadDb: finite.length ? Math.max(...finite) - Math.min(...finite) : 0,
  };
}

/* ---------------- Room check ---------------- */

export type RoomProblem = "no-signal" | "too-loud" | "unsteady";
export interface RoomResult {
  ok: boolean;
  noiseDbfs: number;
  problem?: RoomProblem;
}

export function checkRoom(b: Block): RoomResult {
  if (!Number.isFinite(b.dbfs) || b.dbfs < MIC_DEAD_DBFS) return { ok: false, noiseDbfs: b.dbfs, problem: "no-signal" };
  if (b.dbfs > ROOM_MAX_DBFS) return { ok: false, noiseDbfs: b.dbfs, problem: "too-loud" };
  if (b.spreadDb > ROOM_MAX_SPREAD_DB) return { ok: false, noiseDbfs: b.dbfs, problem: "unsteady" };
  return { ok: true, noiseDbfs: b.dbfs };
}

/** Removes the room's noise power from a reading. null if the reading is not above the noise. */
export function subtractNoise(measuredDbfs: number, noiseDbfs: number): number | null {
  if (!Number.isFinite(measuredDbfs)) return null;
  const n = Number.isFinite(noiseDbfs) ? 10 ** (noiseDbfs / 10) : 0;
  const rest = 10 ** (measuredDbfs / 10) - n;
  return rest > 0 ? 10 * Math.log10(rest) : null;
}

/* ---------------- Mic test (headphones against the mic, volume at max) ---------------- */

export interface MicStep {
  playedDbfs: number;
  micDbfs: number;
  peak: number;
}

export type StepIssue = "clipped" | "too-quiet";
export interface MicStepAnalysis extends MicStep {
  /** Mic level with the room noise removed; null if the tone wasn't above the noise. */
  signalDbfs: number | null;
  snrDb: number;
  issue?: StepIssue;
  usable: boolean;
}

export type MicTestProblem = "too-few-steps" | "not-linear" | "all-clipped";
export interface MicTestResult {
  steps: MicStepAnalysis[];
  ok: boolean;
  problem?: MicTestProblem;
  /** Median of (signal − played) over usable steps; the mic's response to a 0 dBFS tone at max volume. */
  micOffsetDb?: number;
  /** The usable step with the highest played level — reference for the volume steps. */
  reference?: { playedDbfs: number; signalDbfs: number };
  sDevice?: Estimate;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function analyzeMicTest(
  steps: MicStep[],
  noiseDbfs: number,
  opts: { type: HeadphoneType; micSensitivity: Estimate },
): MicTestResult {
  const analysed: MicStepAnalysis[] = steps.map((s) => {
    const signalDbfs = subtractNoise(s.micDbfs, noiseDbfs);
    const snrDb = signalDbfs === null ? -Infinity : signalDbfs - noiseDbfs;
    let issue: StepIssue | undefined;
    if (s.peak >= CLIP_PEAK) issue = "clipped";
    else if (signalDbfs === null || snrDb < MIN_SNR_DB) issue = "too-quiet";
    return { ...s, signalDbfs, snrDb, issue, usable: !issue };
  });

  const usable = analysed.filter((s) => s.usable);
  if (usable.length < 2) {
    const allClipped = analysed.length > 0 && analysed.every((s) => s.issue === "clipped");
    return { steps: analysed, ok: false, problem: allClipped ? "all-clipped" : "too-few-steps" };
  }

  // A real, unprocessed mic rises 1 dB per 1 dB of played level. If not, the browser/OS is
  // probably applying auto-gain or compression, or the signal is mostly noise.
  const offsets = usable.map((s) => s.signalDbfs! - s.playedDbfs);
  const micOffsetDb = median(offsets);
  if (offsets.some((o) => Math.abs(o - micOffsetDb) > LINEARITY_TOL_DB)) {
    return { steps: analysed, ok: false, problem: "not-linear", micOffsetDb };
  }

  const per = usable.map((s) =>
    deviceFromMicTest({
      playedDbfs: s.playedDbfs,
      micDbfs: s.signalDbfs!,
      volumeDb: 0,
      micSensitivity: opts.micSensitivity,
      type: opts.type,
    }),
  );
  const mean = per.reduce((a, e) => a + e.value, 0) / per.length;
  const scatter = Math.sqrt(per.reduce((a, e) => a + (e.value - mean) ** 2, 0) / per.length);
  const top = usable.reduce((a, b) => (b.playedDbfs > a.playedDbfs ? b : a));

  return {
    steps: analysed,
    ok: true,
    micOffsetDb,
    reference: { playedDbfs: top.playedDbfs, signalDbfs: top.signalDbfs! },
    sDevice: { value: mean, sigma: Math.hypot(per[0].sigma, scatter) },
  };
}

/* ---------------- Volume steps ---------------- */

export type VolumeProblem = "too-quiet" | "not-lower";
export interface VolumeStepResult {
  ok: boolean;
  /** Level change vs max volume, in dB (0 at max, negative below). */
  volumeDb?: number;
  snrDb: number;
  problem?: VolumeProblem;
}

/**
 * Same tone, same mic position, lower volume. `referenceSignalDbfs` is the noise-free mic
 * level for that same tone at max volume (MicTestResult.reference).
 */
export function volumeStep(referenceSignalDbfs: number, micDbfs: number, noiseDbfs: number): VolumeStepResult {
  const signal = subtractNoise(micDbfs, noiseDbfs);
  const snrDb = signal === null ? -Infinity : signal - noiseDbfs;
  if (signal === null || snrDb < MIN_SNR_DB) return { ok: false, snrDb, problem: "too-quiet" };
  const volumeDb = signal - referenceSignalDbfs;
  if (volumeDb > VOLUME_NOT_LOWER_DB) return { ok: false, snrDb, volumeDb, problem: "not-lower" };
  return { ok: true, snrDb, volumeDb };
}

/* ---------------- Hearing check ---------------- */

export interface HearingSummary {
  /** Quietest level heard across trials. Lower = more sensitive = louder device. */
  thresholdDbfs: number;
  spreadDb: number;
  consistent: boolean;
  heardTrials: number;
}

/**
 * `trials` holds the level (dBFS) at which the listener pressed "I hear it", or null if
 * never heard. We keep the LOWEST threshold: it maps to the LOUDER S_device, and our rule
 * is that uncertainty must read loud, not quiet.
 */
export function summarizeHearing(trials: (number | null)[]): HearingSummary | null {
  const heard = trials.filter((t): t is number => t !== null && Number.isFinite(t));
  if (heard.length === 0) return null;
  const lo = Math.min(...heard);
  const spreadDb = Math.max(...heard) - lo;
  return { thresholdDbfs: lo, spreadDb, consistent: heard.length === 1 || spreadDb <= HEARING_CONSISTENT_DB, heardTrials: heard.length };
}
