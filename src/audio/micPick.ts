/**
 * Choosing which microphone to measure with.
 *
 * Milestone 1 finding (Mac, Chrome + Safari, Sony ULT WEAR): opening the headset's own
 * Bluetooth mic switches the headphones into call mode (HFP, 16 kHz) and changes their
 * loudness; the built-in mic does not. So the measurement must use a mic that is NOT
 * part of the headphones. Labels are the only hint browsers give us, so this is a
 * heuristic — the sample-rate check after opening is the real safety net.
 */

export interface MicInfo {
  deviceId: string;
  label: string;
}

const BUILT_IN = /built-?in|internal|macbook|imac|mac mini|mac studio|^microphone$|phone microphone$|bottom|front|back/i;
const BLUETOOTH = /bluetooth|airpods|beats|headset|hands-?free|buds|bose|sony|jabra|jbl|sennheiser|wh-|wf-|bt\b/i;
/** Another device's mic routed over the network (e.g. macOS Continuity "…'s iPhone Microphone"). */
const REMOTE = /['’]s (iphone|ipad)/i;

export const looksBluetooth = (label: string) => BLUETOOTH.test(label);

/** Picks the best mic for measuring, or undefined if labels are not visible yet (no permission). */
export function pickMeasurementMic(mics: MicInfo[]): MicInfo | undefined {
  const real = mics.filter((m) => m.label && m.deviceId !== "default" && m.deviceId !== "communications");
  if (real.length === 0) return undefined;
  const ok = real.filter((m) => !looksBluetooth(m.label) && !REMOTE.test(m.label));
  return ok.find((m) => BUILT_IN.test(m.label)) ?? ok[0];
}

/**
 * Bluetooth call mode (HFP) runs the mic at 8 or 16 kHz. Normal built-in mics run at
 * 44.1/48 kHz. A low rate after opening means the headphones have probably switched.
 */
export const suggestsCallMode = (sampleRate: number | undefined) => sampleRate !== undefined && sampleRate <= 16000;
