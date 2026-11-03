/**
 * A saved headphone calibration. Pure data + (de)serialisation — the browser storage
 * wrapper lives in src/storage.ts so this file stays portable to native apps.
 */
import type { CalibrationResult, Estimate, HeadphoneType } from "./calibration";

export const PROFILE_VERSION = 1;

export type Connection = "wired" | "bluetooth";

/**
 * "placeholder" = the mic-sensitivity and coupling corrections are guesses (PLAN §5.4,
 * milestone 3 replaces them). Shown to the user as "test version, not accurate yet".
 */
export type Accuracy = "placeholder";

export interface Profile {
  version: typeof PROFILE_VERSION;
  id: string;
  name: string;
  type: HeadphoneType;
  connection: Connection;
  createdAt: string;
  accuracy: Accuracy;
  result: CalibrationResult;
  micEstimate?: Estimate;
  hearingEstimate?: Estimate;
  /** Level change at OS volume-slider positions, relative to max (negative dB). */
  volumeCurve: { sliderPct: number; db: number }[];
  /** Raw numbers kept so results can be recomputed once corrections are measured. */
  raw: Record<string, unknown>;
}

export interface NewProfile {
  name: string;
  type: HeadphoneType;
  connection: Connection;
  result: CalibrationResult;
  micEstimate?: Estimate;
  hearingEstimate?: Estimate;
  volumeCurve: { sliderPct: number; db: number }[];
  raw: Record<string, unknown>;
}

export function buildProfile(p: NewProfile, now = new Date(), id = randomId()): Profile {
  return {
    version: PROFILE_VERSION,
    id,
    name: p.name.trim() || "Unnamed headphones",
    type: p.type,
    connection: p.connection,
    createdAt: now.toISOString(),
    accuracy: "placeholder",
    result: p.result,
    micEstimate: p.micEstimate,
    hearingEstimate: p.hearingEstimate,
    volumeCurve: p.volumeCurve,
    raw: p.raw,
  };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const isEstimate = (e: any): e is Estimate => !!e && Number.isFinite(e.value) && Number.isFinite(e.sigma);

/** Accepts only well-formed profiles; anything else is dropped rather than trusted. */
export function parseProfiles(json: string | null): Profile[] {
  if (!json) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(
    (p: any): p is Profile =>
      p &&
      p.version === PROFILE_VERSION &&
      typeof p.id === "string" &&
      typeof p.name === "string" &&
      isEstimate(p.result?.sDevice) &&
      Number.isFinite(p.result?.conservative),
  );
}

export const serializeProfiles = (profiles: Profile[]) => JSON.stringify(profiles);
