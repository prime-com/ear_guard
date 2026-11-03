import { openMic, type Mic } from "./mic";
import { looksBluetooth, pickMeasurementMic, suggestsCallMode } from "./micPick";

export type MicProblemKind = "denied" | "no-builtin" | "bluetooth";

export class MicProblem extends Error {
  constructor(public kind: MicProblemKind, message: string) {
    super(message);
  }
}

const norm = (label: string) => label.replace(/^default\s*-\s*/i, "").trim();

/**
 * Opens the microphone used for measuring. Milestone 1 showed that opening a Bluetooth
 * headset's own mic switches the headphones to call mode, so this never keeps one open.
 *
 * Browsers hide mic names until permission is granted, so the first open may land on the
 * system default (possibly the headset). We then look at the real names and reopen the
 * built-in mic if needed.
 */
export async function openMeasurementMic(ctx: AudioContext): Promise<Mic> {
  let mic: Mic;
  try {
    mic = await openMic(ctx);
  } catch {
    throw new MicProblem("denied", "Microphone access was blocked. Allow it in the browser's site settings and try again.");
  }
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  const pick = pickMeasurementMic(inputs);
  if (!pick) {
    mic.close();
    throw new MicProblem("no-builtin", "No built-in microphone found. Use a computer or phone that has its own microphone.");
  }
  if (norm(mic.label) !== norm(pick.label)) {
    mic.close();
    try {
      mic = await openMic(ctx, pick.deviceId);
    } catch {
      throw new MicProblem("denied", "Couldn't open the built-in microphone.");
    }
  }
  if (looksBluetooth(mic.label) || suggestsCallMode(mic.settings.sampleRate)) {
    mic.close();
    throw new MicProblem(
      "bluetooth",
      "The microphone in use looks like the Bluetooth headset's, which switches the headphones to call mode and changes their loudness. Pick the built-in microphone as the input in your system sound settings and try again.",
    );
  }
  return mic;
}

/** Name of the system's default sound output, when the browser exposes it. */
export async function defaultOutputLabel(): Promise<string | undefined> {
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
  const d = outs.find((o) => o.deviceId === "default") ?? outs[0];
  return d?.label ? norm(d.label) : undefined;
}
