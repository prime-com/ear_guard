/**
 * Apple Health export → headphone listening dose.
 *
 * iPhone/Apple Watch measure headphone loudness themselves (Apple/Beats headphones most
 * accurately, others estimated from the volume) and store it as
 * HKQuantityTypeIdentifierHeadphoneAudioExposure records in dB(A). Browsers can't read
 * Health directly, but "Export All Health Data" produces export.xml, which we scan locally.
 * Pure functions — no browser APIs.
 */
import { dbToPa2, exposurePa2h, weeklyDoseFraction, allowedHoursPerWeek } from "./calibration";

export const HEADPHONE_TYPE = "HKQuantityTypeIdentifierHeadphoneAudioExposure";

export interface Exposure {
  startMs: number;
  endMs: number;
  db: number; // dB(A), as reported by Apple Health
}

/** "2025-11-03 20:15:42 +0530" → epoch ms. NaN if malformed. */
export function parseHealthDate(s: string): number {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-])(\d\d)(\d\d)$/.exec(s.trim());
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`) : NaN;
}

const ATTR = /([A-Za-z]+)="([^"]*)"/g;

/**
 * Streaming scanner: feed text chunks of export.xml in order; it keeps only the unfinished
 * tail between chunks. Export files can be hundreds of MB, so nothing is held in full.
 */
export class HealthScanner {
  readonly exposures: Exposure[] = [];
  /** Records of the headphone type seen, including ones we couldn't use. */
  seen = 0;
  skipped = 0;
  private tail = "";

  push(chunk: string): void {
    const text = this.tail + chunk;
    let pos = 0;
    for (;;) {
      const start = text.indexOf("<Record ", pos);
      if (start < 0) {
        // keep a possible partial "<Record" at the very end
        this.tail = text.slice(Math.max(pos, text.length - 8));
        return;
      }
      const end = text.indexOf(">", start);
      if (end < 0) {
        this.tail = text.slice(start);
        return;
      }
      this.consume(text.slice(start, end + 1));
      pos = end + 1;
    }
  }

  private consume(tag: string): void {
    if (!tag.includes(HEADPHONE_TYPE)) return;
    const a: Record<string, string> = {};
    for (const m of tag.matchAll(ATTR)) a[m[1]] = m[2];
    if (a.type !== HEADPHONE_TYPE) return;
    this.seen++;
    const startMs = parseHealthDate(a.startDate ?? "");
    const endMs = parseHealthDate(a.endDate ?? "");
    const db = Number(a.value);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !Number.isFinite(db) || db <= 0) {
      this.skipped++;
      return;
    }
    this.exposures.push({ startMs, endMs, db });
  }
}

export interface DayStats {
  date: string; // local YYYY-MM-DD
  seconds: number;
  pa2h: number;
  /** Energy-average level over listening time (the right way to average dB). */
  avgDb: number;
  maxDb: number;
  secondsAtOrAbove85: number;
}

export interface Analysis {
  days: DayStats[]; // oldest → newest, only days with listening
  weekPa2h: number;
  weekFraction: number; // 1 = 100 % of the weekly limit
  weekSeconds: number;
  weekAvgDb: number | null;
  allowedHoursAtWeekAvg: number | null;
  windowStartMs: number;
  windowEndMs: number;
  newestRecordMs: number | null;
  usedRecords: number;
}

const DAY_MS = 86_400_000;
const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Listening dose over the 7 days ending at `nowMs`, plus a per-day breakdown of the same window. */
export function analyze(exposures: Exposure[], nowMs: number, mode: "standard" | "sensitive" = "standard"): Analysis {
  const windowStartMs = nowMs - 7 * DAY_MS;
  const perDay = new Map<string, { seconds: number; pa2h: number; maxDb: number; s85: number }>();
  let weekPa2h = 0, weekSeconds = 0, used = 0, newest: number | null = null;

  for (const e of exposures) {
    newest = newest === null ? e.endMs : Math.max(newest, e.endMs);
    // clip to the window
    const s = Math.max(e.startMs, windowStartMs), t = Math.min(e.endMs, nowMs);
    if (t <= s) continue;
    used++;
    const seconds = (t - s) / 1000;
    const pa2h = exposurePa2h(e.db, seconds);
    weekPa2h += pa2h;
    weekSeconds += seconds;
    const key = localDate(t);
    const d = perDay.get(key) ?? { seconds: 0, pa2h: 0, maxDb: 0, s85: 0 };
    d.seconds += seconds;
    d.pa2h += pa2h;
    d.maxDb = Math.max(d.maxDb, e.db);
    if (e.db >= 85) d.s85 += seconds;
    perDay.set(key, d);
  }

  const energyAvg = (pa2h: number, seconds: number) => {
    // pa2h = p² · hours  →  mean p² = pa2h / hours
    const meanP2 = pa2h / (seconds / 3600);
    return 10 * Math.log10(meanP2 / dbToPa2(0));
  };

  const days: DayStats[] = [...perDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({ date, seconds: d.seconds, pa2h: d.pa2h, avgDb: energyAvg(d.pa2h, d.seconds), maxDb: d.maxDb, secondsAtOrAbove85: d.s85 }));

  const weekAvgDb = weekSeconds > 0 ? energyAvg(weekPa2h, weekSeconds) : null;
  return {
    days,
    weekPa2h,
    weekFraction: weeklyDoseFraction(weekPa2h, mode),
    weekSeconds,
    weekAvgDb,
    allowedHoursAtWeekAvg: weekAvgDb === null ? null : allowedHoursPerWeek(weekAvgDb, mode),
    windowStartMs,
    windowEndMs: nowMs,
    newestRecordMs: newest,
    usedRecords: used,
  };
}
