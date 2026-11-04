import {
  combine,
  DEFAULT_MIC_SENSITIVITY,
  deviceFromThreshold,
  type Estimate,
  type HeadphoneType,
} from "./core/calibration";
import {
  analyzeMicTest,
  checkRoom,
  CLIP_PEAK,
  MIC_CEILING_DBFS,
  ROOM_MAX_DBFS,
  MIN_SNR_DB,
  ROOM_MAX_SPREAD_DB,
  summarizeHearing,
  volumeStep,
  type MicStep,
  type MicTestResult,
} from "./core/measure";
import { buildProfile, type Connection, type Profile } from "./core/profile";
import { defaultOutputLabel, MicProblem, openMeasurementMic } from "./audio/builtin";
import { startHearingTrial, type HearingTrial } from "./audio/hearing";
import type { Mic } from "./audio/mic";
import { measureFor, playToneAndMeasure } from "./audio/measure";
import { deleteProfile, loadProfiles, saveProfile } from "./storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, text: string) => ($(id).textContent = text);
const show = (id: string, on = true) => ($(id).hidden = !on);

type Mode = "full" | "hearing";
type Step = "setup" | "room" | "mic" | "volume" | "hearing" | "result";

/** Levels (dBFS) of the rising 1 kHz tone in the mic test. The loop stops early if the mic gets loud or clips. */
const MIC_TEST_LEVELS = [-60, -50, -40, -30, -20, -10, 0]; // headphones are OFF the head here
const VOLUME_STEPS = [50, 25]; // OS volume-slider positions, % of max
const HEARING_TRIALS = 2;

const S = {
  mode: "full" as Mode,
  name: "",
  type: "over-ear" as HeadphoneType,
  connection: "bluetooth" as Connection,
  noiseDbfs: -Infinity,
  micResult: undefined as MicTestResult | undefined,
  volume: [] as { sliderPct: number; db: number }[],
  volIdx: 0,
  trials: [] as (number | null)[],
  roomDbfs: undefined as number | undefined,
};

let ctx: AudioContext | null = null;
let mic: Mic | null = null;
let trial: HearingTrial | null = null;
let busy = false;

const getCtx = () => (ctx ??= new AudioContext({ latencyHint: "interactive" }));

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

/** iOS Safari mutes Web Audio in Silent mode unless the page declares a "playback" session. */
function setAudioSession(type: "playback" | "play-and-record") {
  try {
    const s = (navigator as any).audioSession;
    if (s) s.type = type;
  } catch {
    /* unsupported */
  }
}

function go(step: Step) {
  const order: Step[] = S.mode === "full" ? ["setup", "room", "mic", "volume", "hearing", "result"] : ["setup", "hearing", "result"];
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => (el.hidden = el.dataset.step !== step));
  const i = order.indexOf(step);
  setText("progress", i >= 0 ? `Step ${i + 1} of ${order.length}` : "");
}

function closeMic() {
  mic?.close();
  mic = null;
}

/** Stops every sound and the mic. Safe to call at any time. */
function stopAll() {
  trial?.cancel();
  trial = null;
  closeMic();
  busy = false;
}

/* ---------------- Setup ---------------- */

if (isIOS) {
  show("iosNote");
  (document.querySelector('input[name="mode"][value="hearing"]') as HTMLInputElement).checked = true;
}

$("stopAllBtn").addEventListener("click", () => {
  stopAll();
  setText("setupErr", "Stopped.");
  show("setupErr");
});

$("startBtn").addEventListener("click", async () => {
  S.name = $<HTMLInputElement>("nameIn").value;
  S.type = $<HTMLSelectElement>("typeIn").value as HeadphoneType;
  S.connection = $<HTMLSelectElement>("connIn").value as Connection;
  S.mode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value as Mode;
  S.micResult = undefined;
  S.volume = [];
  S.volIdx = 0;
  S.trials = [];
  show("setupErr", false);

  const c = getCtx();
  await c.resume();
  if (S.mode === "hearing") {
    setAudioSession("playback");
    prepHearing();
    go("hearing");
    return;
  }
  setAudioSession("play-and-record");
  try {
    mic = await openMeasurementMic(c);
  } catch (e) {
    setText("setupErr", e instanceof MicProblem || e instanceof Error ? e.message : String(e));
    show("setupErr");
    return;
  }
  go("room");
  void runRoom();
});

/* ---------------- Room check ---------------- */

const ROOM_MESSAGES = {
  "too-loud": "The room is too noisy. Move somewhere quieter (close windows, switch off fans) and try again.",
  unsteady: "The noise keeps changing (voices, music, typing). Wait for a quiet moment and try again.",
  "no-signal": "The microphone isn't picking up anything. Check it isn't muted, then try again.",
} as const;

async function runRoom() {
  if (!mic) return;
  show("roomRetry", false);
  show("roomNext", false);
  show("roomAnyway", false);
  setText("roomStatus", "Hands off the keyboard and trackpad…");
  await new Promise((res) => setTimeout(res, 1500)); // don't record the click that started this
  if (!mic) return;
  setText("roomStatus", "Listening… stay quiet.");
  const r = checkRoom(await measureFor(mic, 4000));
  S.noiseDbfs = r.noiseDbfs;
  S.roomDbfs = r.noiseDbfs;
  if (r.ok) {
    setText("roomStatus", `Quiet enough ✓ (background ≈ ${r.noiseDbfs.toFixed(0)} dBFS)`);
    show("roomNext");
  } else {
    setText(
      "roomStatus",
      `${ROOM_MESSAGES[r.problem!]} (Measured ${r.noiseDbfs.toFixed(1)} dBFS, swing ${r.spreadDb.toFixed(1)} dB; limits are ${ROOM_MAX_DBFS} dBFS and ${ROOM_MAX_SPREAD_DB} dB.)`,
    );
    show("roomRetry");
    // Unsteady noise is safe to continue with: each mic-test tone must still clear the
    // noise by MIN_SNR_DB, and leftover noise only makes the result read louder.
    if (r.problem === "unsteady") show("roomAnyway");
  }
}

$("roomRetry").addEventListener("click", () => void runRoom());
$("roomAnyway").addEventListener("click", () => $("roomNext").click());
$("roomNext").addEventListener("click", async () => {
  const label = await defaultOutputLabel();
  setText("outInfo", label ? `Sound will play through: ${label}` : "");
  go("mic");
});
$("roomSkip").addEventListener("click", skipToHearing);

function skipToHearing() {
  closeMic();
  S.mode = "hearing"; // result will be hearing-only
  prepHearing();
  go("hearing");
}

/* ---------------- Mic test ---------------- */

$<HTMLInputElement>("micReady").addEventListener("change", (e) => {
  $<HTMLButtonElement>("micGo").disabled = !(e.target as HTMLInputElement).checked;
});
$("micSkip").addEventListener("click", skipToHearing);

const MIC_PROBLEMS = {
  "too-few-steps": "The tones were too quiet at the microphone. Press the earcup closer to the mic and check the volume is at maximum.",
  "all-clipped": "The microphone overloaded (too loud). Move the earcup slightly away from the mic and try again.",
  "not-linear": "The microphone isn't responding evenly — it may be applying automatic gain. Try Chrome, or use the hearing check only.",
} as const;

$("micGo").addEventListener("click", async () => {
  if (!mic || !ctx || busy) return;
  busy = true;
  show("micErr", false);
  $<HTMLButtonElement>("micGo").disabled = true;
  const steps: MicStep[] = [];
  try {
    for (const level of MIC_TEST_LEVELS) {
      if (!mic) return; // stopped
      setText("micStatus", `Playing tone ${steps.length + 1} of ${MIC_TEST_LEVELS.length}…`);
      const b = await playToneAndMeasure(ctx, mic, level);
      steps.push({ playedDbfs: level, micDbfs: b.dbfs, peak: b.peak });
      if (b.peak >= CLIP_PEAK || b.dbfs > MIC_CEILING_DBFS) break;
    }
  } finally {
    busy = false;
    $<HTMLButtonElement>("micGo").disabled = !$<HTMLInputElement>("micReady").checked;
  }
  const r = analyzeMicTest(steps, S.noiseDbfs, { type: S.type, micSensitivity: DEFAULT_MIC_SENSITIVITY });
  S.micResult = r;
  if (!r.ok) {
    setText("micStatus", "");
    const detail = r.steps
      .map((st) => `tone ${st.playedDbfs} → mic ${st.micDbfs.toFixed(1)} dBFS, ${Number.isFinite(st.snrDb) ? st.snrDb.toFixed(0) : "<0"} dB above room${st.usable ? " ✓" : ` (${st.issue})`}`)
      .join("\n");
    setText("micErr", `${MIC_PROBLEMS[r.problem!]}\n\nRoom ${S.noiseDbfs.toFixed(1)} dBFS. Each tone needs ${MIN_SNR_DB} dB above it; at least 2 must pass.\n${detail}`);
    show("micErr");
    return;
  }
  setText("micStatus", "Done ✓");
  S.volIdx = 0;
  prepVolume();
  go("volume");
});

/* ---------------- Volume steps ---------------- */

function prepVolume() {
  const pct = VOLUME_STEPS[S.volIdx];
  setText("volTarget", `${S.volIdx + 1} of ${VOLUME_STEPS.length}`);
  setText("volPct", `${pct}%`);
  setText("volStatus", "");
  show("volErr", false);
  show("volGo");
  show("volNext", false);
}

const VOLUME_PROBLEMS = {
  "too-quiet": "At this volume the tone is too close to the room noise to measure. You can skip this step.",
  "not-lower": "That reads as loud as the maximum — the volume doesn't seem to have been lowered. Lower it and try again.",
} as const;

$("volGo").addEventListener("click", async () => {
  const ref = S.micResult?.reference;
  if (!mic || !ctx || !ref || busy) return;
  busy = true;
  show("volErr", false);
  $<HTMLButtonElement>("volGo").disabled = true;
  setText("volStatus", "Measuring…");
  try {
    const b = await playToneAndMeasure(ctx, mic, ref.playedDbfs);
    const r = volumeStep(ref.signalDbfs, b.dbfs, S.noiseDbfs);
    if (r.ok) {
      S.volume.push({ sliderPct: VOLUME_STEPS[S.volIdx], db: r.volumeDb! });
      setText("volStatus", `${VOLUME_STEPS[S.volIdx]}% volume ≈ ${r.volumeDb!.toFixed(1)} dB vs maximum ✓`);
      show("volGo", false);
      show("volNext");
    } else {
      setText("volStatus", "");
      setText("volErr", VOLUME_PROBLEMS[r.problem!]);
      show("volErr");
    }
  } finally {
    busy = false;
    $<HTMLButtonElement>("volGo").disabled = false;
  }
});

$("volNext").addEventListener("click", () => {
  S.volIdx += 1;
  if (S.volIdx < VOLUME_STEPS.length) prepVolume();
  else endMicPhase();
});
$("volSkip").addEventListener("click", endMicPhase);

function endMicPhase() {
  closeMic(); // Bluetooth: the mic must be off for the hearing check
  prepHearing();
  go("hearing");
}

/* ---------------- Hearing check ---------------- */

function prepHearing() {
  show("hearPrep");
  show("hearRun", false);
  setText("hearTrialNo", `(${S.trials.length + 1} of ${HEARING_TRIALS})`);
  setText("hearMsg", S.trials.length ? "Press Start for the second round." : "");
  $<HTMLElement>("hearBar").style.width = "0%";
}

$("hearStart").addEventListener("click", async () => {
  if (trial) return;
  const c = getCtx();
  await c.resume();
  show("hearPrep", false);
  show("hearRun");
  trial = startHearingTrial(c, (f) => ($<HTMLElement>("hearBar").style.width = `${Math.round(f * 100)}%`));
  const level = await trial.done;
  trial = null;
  show("hearRun", false);
  S.trials.push(level);
  setText("hearMsg", level === null ? "No beep heard that round." : "Got it.");
  if (S.trials.length < HEARING_TRIALS) {
    prepHearing();
    setText("hearMsg", (level === null ? "No beep heard that round. " : "Got it. ") + "Press Start for the second round.");
  } else {
    finish();
  }
});

const pressHeard = () => trial?.heard();
$("hearBtn").addEventListener("click", pressHeard);
$("hearCancel").addEventListener("click", () => {
  trial?.cancel();
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && trial) {
    e.preventDefault();
    pressHeard();
  }
});

/* ---------------- Result ---------------- */

const CONFIDENCE_TEXT = {
  confident: "Both tests agree — fairly confident (for a test version).",
  "retest-suggested": "The two tests disagree, so the louder one is used. A retest is suggested.",
  "mic-only": "Based on the microphone test only.",
  "hearing-only": "Based on the hearing check only. It tends to read low (hearing and room noise raise the threshold), so treat it as a minimum.",
} as const;

function finish() {
  const micEst: Estimate | undefined = S.micResult?.ok ? S.micResult.sDevice : undefined;
  const hs = summarizeHearing(S.trials);
  const hearEst: Estimate | undefined = hs ? deviceFromThreshold(hs.thresholdDbfs, 0) : undefined;

  go("result");
  if (!micEst && !hearEst) {
    setText("resMain", "No result");
    setText("resRange", "");
    setText("resDose", "");
    setText("resConf", "The beep was never heard and there's no microphone result. Try again in a quieter place, or check the volume is at maximum and the headphones are on.");
    setText("resSaved", "");
    setText("resDetails", JSON.stringify({ trials: S.trials }, null, 2));
    return;
  }
  const result = combine(micEst, hearEst);
  const profile = buildProfile({
    name: S.name,
    type: S.type,
    connection: S.connection,
    result,
    micEstimate: micEst,
    hearingEstimate: hearEst,
    volumeCurve: S.volume,
    raw: {
      roomNoiseDbfs: S.roomDbfs,
      micSteps: S.micResult?.steps,
      micOffsetDb: S.micResult?.micOffsetDb,
      hearingTrialsDbfs: S.trials,
      hearingSpreadDb: hs?.spreadDb,
      hearingConsistent: hs?.consistent,
      micSensitivityAssumed: DEFAULT_MIC_SENSITIVITY,
    },
  });
  const saved = saveProfile(profile);
  renderResult(profile, hs?.consistent === false);
  setText("resSaved", saved ? "Saved on this device only. Nothing is uploaded." : "Couldn't save (browser storage is blocked).");
  renderSaved();
}

function renderResult(p: Profile, hearingInconsistent: boolean) {
  const { value, sigma } = p.result.sDevice;
  setText("resMain", `≈ ${value.toFixed(0)} dB`);
  setText("resRange", `Likely range ${(value - sigma).toFixed(0)}–${(value + sigma).toFixed(0)} dB · ${p.name}`);
  setText("resDose", `For listening-time tracking the app will use ${p.result.conservative.toFixed(0)} dB — it deliberately leans loud when unsure.`);
  setText("resConf", CONFIDENCE_TEXT[p.result.confidence] + (hearingInconsistent ? " Your two hearing rounds differed a lot, so consider redoing it." : ""));
  setText("resDetails", JSON.stringify({ micEstimate: p.micEstimate, hearingEstimate: p.hearingEstimate, volumeCurve: p.volumeCurve, raw: p.raw }, null, 2));
}

$("againBtn").addEventListener("click", () => {
  stopAll();
  S.mode = "full";
  go("setup");
});

/* ---------------- Saved profiles ---------------- */

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function renderSaved() {
  const list = $("savedList");
  list.replaceChildren();
  const all = loadProfiles();
  show("savedEmpty", all.length === 0);
  for (const p of all) {
    const li = document.createElement("li");
    const { value, sigma } = p.result.sDevice;
    const label = document.createElement("span");
    label.textContent = `${p.name} — ≈ ${value.toFixed(0)} dB (${(value - sigma).toFixed(0)}–${(value + sigma).toFixed(0)}) · ${p.result.confidence} · ${p.createdAt.slice(0, 10)} · test version`;
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "secondary";
    del.addEventListener("click", () => {
      deleteProfile(p.id);
      renderSaved();
    });
    li.append(label, del);
    list.append(li);
  }
}

$("exportAll").addEventListener("click", () => download(`earguard-profiles-${Date.now()}.json`, loadProfiles()));

window.addEventListener("pagehide", stopAll);
renderSaved();
go("setup");
