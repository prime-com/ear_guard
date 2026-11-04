import { Unzip, UnzipInflate } from "fflate";
import { analyze, HealthScanner, type Analysis } from "./core/health";
import { showBuild } from "./build";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Streams export.xml (from a .zip or a bare .xml) through the scanner without loading it all into memory. */
async function scanFile(file: File, scanner: HealthScanner, onProgress: (fraction: number) => void): Promise<void> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let read = 0;
  const tick = async (n: number) => {
    read += n;
    onProgress(file.size ? read / file.size : 0);
    await new Promise((r) => setTimeout(r)); // let the page repaint on big files
  };

  if (/\.xml$/i.test(file.name)) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      scanner.push(decoder.decode(value, { stream: true }));
      await tick(value.length);
    }
    return;
  }

  let found = false;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (f) => {
    if (!/(^|\/)export\.xml$/.test(f.name)) return;
    found = true;
    f.ondata = (err, chunk, final) => {
      if (err) throw err;
      scanner.push(decoder.decode(chunk, { stream: !final }));
    };
    f.start();
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    unzip.push(value, false);
    await tick(value.length);
  }
  unzip.push(new Uint8Array(0), true);
  if (!found) throw new Error("This zip doesn't contain export.xml. Use the file from 'Export All Health Data'.");
}

const fmtHours = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const pct = (f: number) => (f < 0.1 ? `${(f * 100).toFixed(1)} %` : `${Math.round(f * 100)} %`);

function render(a: Analysis, sensitive: boolean) {
  show("result");
  const limit = sensitive ? 75 : 80;
  $("pctBig").textContent = `${pct(a.weekFraction)} of your weekly limit`;
  $("pctLine").textContent =
    a.weekSeconds === 0
      ? "No headphone listening recorded in the last 7 days."
      : `You listened ${fmtHours(a.weekSeconds)} in the last 7 days. The limit is ${limit} dB(A) for 40 hours a week (louder means less time: every +3 dB halves it).`;
  $("avgLine").textContent =
    a.weekAvgDb === null
      ? ""
      : `Average level while listening: ${a.weekAvgDb.toFixed(0)} dB(A). At that level the weekly allowance is about ${a.allowedHoursAtWeekAvg!.toFixed(0)} hours.`;

  const stale = $("staleLine");
  const newestAge = a.newestRecordMs === null ? Infinity : (a.windowEndMs - a.newestRecordMs) / 86_400_000;
  stale.hidden = !(newestAge > 1);
  if (!stale.hidden) {
    stale.textContent =
      a.newestRecordMs === null
        ? "This file has no headphone audio data at all. Is Headphone Audio Levels on in Settings → Privacy & Security → Health?"
        : `The newest headphone data in this file is from ${new Date(a.newestRecordMs).toLocaleDateString()}. Export again to include recent listening.`;
  }

  const box = $("days");
  box.replaceChildren();
  for (const d of a.days) {
    const row = document.createElement("div");
    row.className = "dayrow";
    const label = document.createElement("span");
    label.textContent = `${d.date} · ${fmtHours(d.seconds)} · avg ${d.avgDb.toFixed(0)} dB, peak ${d.maxDb.toFixed(0)} dB`;
    const bar = document.createElement("div");
    bar.className = "daybar";
    const fill = document.createElement("div");
    fill.style.width = `${Math.min(100, (d.pa2h / (sensitive ? 0.51 : 1.6)) * 100)}%`;
    bar.append(fill);
    row.append(label, bar);
    box.append(row);
  }
  if (a.days.length === 0) box.textContent = "—";
}

const show = (id: string, on = true) => ($(id).hidden = !on);

let last: { exposures: HealthScanner["exposures"] } | null = null;
const redo = () => {
  if (!last) return;
  const sensitive = $<HTMLInputElement>("sensitive").checked;
  render(analyze(last.exposures, Date.now(), sensitive ? "sensitive" : "standard"), sensitive);
};

$("sensitive").addEventListener("change", redo);

$<HTMLInputElement>("file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  show("err", false);
  show("result", false);
  show("progWrap");
  $("status").textContent = `Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)…`;
  const scanner = new HealthScanner();
  try {
    await scanFile(file, scanner, (f) => (($("prog") as HTMLElement).style.width = `${Math.round(f * 100)}%`));
    last = { exposures: scanner.exposures };
    $("status").textContent = `Found ${scanner.exposures.length.toLocaleString()} headphone-level readings${scanner.skipped ? ` (${scanner.skipped} unusable skipped)` : ""}. Nothing left this device.`;
    redo();
  } catch (err) {
    $("status").textContent = "";
    $("err").textContent = err instanceof Error ? err.message : String(err);
    show("err");
  } finally {
    show("progWrap", false);
  }
});

showBuild();
