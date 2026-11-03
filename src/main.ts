import { openMic, type Mic } from "./audio/mic";
import { playSignal, type PlayingSignal, type SignalKind } from "./audio/signals";
import { looksBluetooth, pickMeasurementMic, suggestsCallMode } from "./audio/micPick";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let ctx: AudioContext | null = null;
let playing: PlayingSignal | null = null;
let mic: Mic | null = null;
const results: Record<string, unknown>[] = [];
/** Once the user picks a mic themselves we stop auto-selecting. */
let userPickedMic = false;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: "interactive" });
  return ctx;
}

function log(event: string, data: Record<string, unknown> = {}) {
  const entry = { t: new Date().toISOString(), event, ...data };
  results.push(entry);
  $("log").textContent = results.map((r) => JSON.stringify(r)).join("\n");
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel: HTMLSelectElement, kind: MediaDeviceKind) => {
    const prev = sel.value;
    sel.innerHTML = "";
    for (const d of devices.filter((d) => d.kind === kind)) {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `(${kind} — allow mic to see names)`;
      sel.append(o);
    }
    if (prev) sel.value = prev;
  };
  fill($("micSelect"), "audioinput");
  if (!userPickedMic) {
    const pick = pickMeasurementMic(devices.filter((d) => d.kind === "audioinput"));
    if (pick) $<HTMLSelectElement>("micSelect").value = pick.deviceId;
  }
  updateMicWarning();
  fill($("outSelect"), "audiooutput");
  // Output selection works only where AudioContext.setSinkId exists (Chromium).
  $("outWrap").hidden = !("setSinkId" in AudioContext.prototype);
  log("devices", { list: devices.map((d) => ({ kind: d.kind, label: d.label })) });
}

function selectedMicLabel(): string {
  const sel = $<HTMLSelectElement>("micSelect");
  return sel.selectedOptions[0]?.textContent ?? "";
}

function updateMicWarning(callMode = false) {
  const w = $("micWarn");
  if (callMode) {
    w.textContent = "⚠️ The mic opened at a low sample rate — your Bluetooth headphones have probably switched to call mode. Close the mic and choose the built-in microphone.";
  } else if (looksBluetooth(selectedMicLabel())) {
    w.textContent = "⚠️ This looks like a Bluetooth headset mic. Opening it switches headphones to call mode and changes their loudness. Choose the built-in microphone.";
  } else {
    w.textContent = "";
  }
  w.hidden = !w.textContent;
}

$("micSelect").addEventListener("change", () => {
  userPickedMic = true;
  updateMicWarning();
});

const level = () => Number($<HTMLInputElement>("level").value);

$("level").addEventListener("input", () => {
  $("levelOut").textContent = `${level()} dBFS`;
  playing?.setLevel(level());
});

$("playBtn").addEventListener("click", async () => {
  if (playing) {
    playing.stop();
    playing = null;
    $("playBtn").textContent = "Play";
    log("stop");
    return;
  }
  const c = getCtx();
  await c.resume();
  const out = $<HTMLSelectElement>("outSelect").value;
  if (out && "setSinkId" in c) await (c as any).setSinkId(out).catch(() => {});
  const kind = $<HTMLSelectElement>("kind").value as SignalKind;
  playing = playSignal(c, kind, level());
  $("playBtn").textContent = "Stop";
  log("play", { kind, dbfs: level() });
});

$("micBtn").addEventListener("click", async () => {
  if (mic) {
    mic.close();
    mic = null;
    $("micBtn").textContent = "Open mic";
    $<HTMLButtonElement>("snapBtn").disabled = true;
    log("mic-closed");
    return;
  }
  const c = getCtx();
  await c.resume();
  const hadLabels = !!selectedMicLabel() && !selectedMicLabel().startsWith("(");
  try {
    mic = await openMic(c, $<HTMLSelectElement>("micSelect").value || undefined);
    // Before permission the browser hides mic names, so the first open uses the system
    // default — which may be the headset mic. Now names are visible: switch if needed.
    if (!hadLabels && !userPickedMic) {
      await refreshDevices();
      const want = $<HTMLSelectElement>("micSelect").value;
      if (want && want !== mic.settings.deviceId && (looksBluetooth(mic.label) || suggestsCallMode(mic.settings.sampleRate))) {
        log("mic-auto-switch", { from: mic.label, reason: "default mic was a Bluetooth headset" });
        mic.close();
        mic = await openMic(c, want);
      }
    }
  } catch (e) {
    log("mic-error", { error: String(e) });
    return;
  }
  const s = mic.settings;
  const callMode = suggestsCallMode(s.sampleRate);
  updateMicWarning(callMode);
  if (callMode) log("call-mode-suspected", { label: mic.label, sampleRate: s.sampleRate });
  $("micInfo").textContent = `Using: ${mic.label} · echoCancel=${s.echoCancellation} noiseSuppr=${s.noiseSuppression} autoGain=${s.autoGainControl} · ${s.sampleRate ?? c.sampleRate} Hz`;
  $("micBtn").textContent = "Close mic";
  $<HTMLButtonElement>("snapBtn").disabled = false;
  log("mic-open", { label: mic.label, settings: s });
  await refreshDevices(); // labels become visible after permission
  meterLoop();
});

function meterLoop() {
  if (!mic) return;
  const db = mic.readDbfs();
  const peak = mic.readPeak();
  $("micDb").textContent = Number.isFinite(db) ? db.toFixed(1) : "—";
  $("bar").style.width = `${Math.max(0, Math.min(100, (db + 100)))}%`;
  $("clip").hidden = peak < 0.99;
  requestAnimationFrame(meterLoop);
}

$("snapBtn").addEventListener("click", () => {
  if (!mic) return;
  // Average ~1 s of readings for a stable value.
  const vals: number[] = [];
  const id = setInterval(() => {
    vals.push(mic!.readDbfs());
    if (vals.length >= 10) {
      clearInterval(id);
      const finite = vals.filter(Number.isFinite);
      const avg = 10 * Math.log10(finite.reduce((a, v) => a + 10 ** (v / 10), 0) / finite.length);
      log("reading", { micDbfs: +avg.toFixed(2), playedDbfs: playing ? level() : null, kind: $<HTMLSelectElement>("kind").value });
    }
  }, 100);
});

document.querySelectorAll<HTMLButtonElement>("[data-bt]").forEach((b) =>
  b.addEventListener("click", () => log("bluetooth-check", { result: b.dataset.bt, mic: mic?.label })),
);

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ userAgent: navigator.userAgent, results }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `earguard-lab-${Date.now()}.json`;
  a.click();
});

$("refreshBtn").addEventListener("click", refreshDevices);
navigator.mediaDevices.addEventListener("devicechange", () => {
  log("devicechange");
  refreshDevices();
});
refreshDevices();
