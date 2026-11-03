/**
 * EarGuard calibration & dose math.
 *
 * Pure functions, no browser APIs, so the same logic can be ported to / shared with
 * the native apps later. See docs/PLAN.md §2 for the model.
 *
 * Conventions:
 *  - dBFS follows AES17: a full-scale sine is 0 dBFS (so RMS dBFS = 20·log10(rms·√2)).
 *  - S_device = dB SPL at the ear produced by a 0 dBFS 1 kHz sine at max volume.
 */

export const REF_PRESSURE_PA = 20e-6;

export type HeadphoneType = "earbuds" | "over-ear" | "on-ear";

/** An estimate with a 1-sigma uncertainty, both in dB. */
export interface Estimate {
  value: number;
  sigma: number;
}

/** RMS of a sample block → dBFS (AES17). Returns -Infinity for silence. */
export function rmsToDbfs(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms * Math.SQRT2) : -Infinity;
}

export function blockRmsDbfs(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return rmsToDbfs(Math.sqrt(sum / Math.max(1, samples.length)));
}

/** Mic reading (dBFS) → SPL at the mic, given mic sensitivity (dBFS produced by 94 dB SPL). */
export function micDbfsToSpl(micDbfs: number, micSensitivityDbfsAt94: number): number {
  return micDbfs - micSensitivityDbfsAt94 + 94;
}

/**
 * Coupling correction: "earphone pressed against a phone/laptop mic" → "in an ear canal".
 * PLACEHOLDERS (0 dB, wide sigma) until we measure them with reference gear (PLAN §5.4).
 */
export const COUPLING_CORRECTION: Record<HeadphoneType, Estimate> = {
  earbuds: { value: 0, sigma: 4 },
  "over-ear": { value: 0, sigma: 3 },
  "on-ear": { value: 0, sigma: 3 },
};

/** Default when we don't know the phone/laptop mic model: typical MEMS mic. */
export const DEFAULT_MIC_SENSITIVITY: Estimate = { value: -38, sigma: 3 };

export interface MicTestInput {
  playedDbfs: number; // level of the test tone we generated
  micDbfs: number; // level the mic measured
  volumeDb: number; // device volume relative to max (0 at max, negative below)
  micSensitivity: Estimate;
  type: HeadphoneType;
}

/** Mic test → S_device estimate. Uncertainties add in quadrature. */
export function deviceFromMicTest(i: MicTestInput): Estimate {
  const c = COUPLING_CORRECTION[i.type];
  const splAtMic = micDbfsToSpl(i.micDbfs, i.micSensitivity.value);
  return {
    value: splAtMic - i.playedDbfs - i.volumeDb + c.value,
    sigma: Math.hypot(i.micSensitivity.sigma, c.sigma, 1 /* measurement/seal */),
  };
}

/** Typical hearing threshold at 1 kHz under headphones (dB SPL). */
export const THRESHOLD_REF_1KHZ: Estimate = { value: 6, sigma: 5 };

/**
 * Hearing check → S_device estimate. Biased LOW (hearing loss / noise raise the
 * threshold), so `combine` only lets it raise a result, never lower it.
 */
export function deviceFromThreshold(thresholdDbfs: number, volumeDb = 0): Estimate {
  return { value: THRESHOLD_REF_1KHZ.value - thresholdDbfs - volumeDb, sigma: THRESHOLD_REF_1KHZ.sigma };
}

export type Confidence = "confident" | "retest-suggested" | "mic-only" | "hearing-only";

export interface CalibrationResult {
  sDevice: Estimate;
  /** Value used for dose: leans loud when unsure. */
  conservative: number;
  confidence: Confidence;
}

export const AGREEMENT_DB = 4;

export function combine(mic?: Estimate, hearing?: Estimate): CalibrationResult {
  if (!mic && !hearing) throw new Error("need at least one estimate");
  let est: Estimate;
  let confidence: Confidence;
  if (mic && hearing) {
    if (Math.abs(mic.value - hearing.value) <= AGREEMENT_DB) {
      const w1 = 1 / mic.sigma ** 2;
      const w2 = 1 / hearing.sigma ** 2;
      const merged = (mic.value * w1 + hearing.value * w2) / (w1 + w2);
      // The hearing check is biased LOW (hearing loss, room noise), so it may raise the
      // mic result but must never pull it down (HANDOFF safety rule).
      est = { value: Math.max(merged, mic.value), sigma: Math.sqrt(1 / (w1 + w2)) };
      confidence = "confident";
    } else {
      est = mic.value >= hearing.value ? mic : hearing; // louder one
      confidence = "retest-suggested";
    }
  } else if (mic) {
    est = mic;
    confidence = "mic-only";
  } else {
    est = hearing!;
    confidence = "hearing-only";
  }
  return { sDevice: est, conservative: est.value + est.sigma, confidence };
}

/** Live estimate at the ear: signal (A-weighted dBFS) + volume (dB) + S_device. */
export function earLevelDb(signalDbfsA: number, volumeDb: number, sDevice: number): number {
  return signalDbfsA + volumeDb + sDevice;
}

/* ---------- Dose (WHO / ITU-T H.870, equal energy) ---------- */

export const WEEKLY_ALLOWANCE_PA2H = {
  standard: 1.6, // 80 dB(A) for 40 h
  sensitive: 0.51, // 75 dB(A) for 40 h
} as const;

export function dbToPa2(db: number): number {
  return (REF_PRESSURE_PA * 10 ** (db / 20)) ** 2;
}

/** Sound energy (Pa²·h) of listening at `db` dB(A) for `seconds`. */
export function exposurePa2h(db: number, seconds: number): number {
  return dbToPa2(db) * (seconds / 3600);
}

/** Fraction of the weekly allowance used (1.0 = 100 %). */
export function weeklyDoseFraction(pa2h: number, mode: keyof typeof WEEKLY_ALLOWANCE_PA2H = "standard"): number {
  return pa2h / WEEKLY_ALLOWANCE_PA2H[mode];
}

/** Hours per week allowed at a constant level. */
export function allowedHoursPerWeek(db: number, mode: keyof typeof WEEKLY_ALLOWANCE_PA2H = "standard"): number {
  return WEEKLY_ALLOWANCE_PA2H[mode] / dbToPa2(db);
}
