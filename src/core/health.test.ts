import { describe, expect, it } from "vitest";
import { analyze, HealthScanner, parseHealthDate, HEADPHONE_TYPE, type Exposure } from "./health";

const rec = (db: number, start: string, end: string, type = HEADPHONE_TYPE) =>
  `<Record type="${type}" sourceName="Tanmay's iPhone" unit="dBASPL" creationDate="${end}" startDate="${start}" endDate="${end}" value="${db}">\n<MetadataEntry key="x" value="y"/>\n</Record>\n`;

describe("parseHealthDate", () => {
  it("handles Apple's format with a timezone offset", () => {
    expect(parseHealthDate("2026-11-03 20:00:00 +0530")).toBe(Date.parse("2026-11-03T14:30:00Z"));
    expect(parseHealthDate("2026-11-03 20:00:00 -0800")).toBe(Date.parse("2026-11-04T04:00:00Z"));
  });
  it("rejects junk", () => expect(parseHealthDate("yesterday")).toBeNaN());
});

describe("HealthScanner", () => {
  it("reads only headphone exposure records", () => {
    const s = new HealthScanner();
    s.push(rec(82, "2026-11-03 10:00:00 +0000", "2026-11-03 10:05:00 +0000"));
    s.push(rec(70, "2026-11-03 10:00:00 +0000", "2026-11-03 10:05:00 +0000", "HKQuantityTypeIdentifierStepCount"));
    expect(s.exposures).toHaveLength(1);
    expect(s.exposures[0].db).toBe(82);
    expect(s.exposures[0].endMs - s.exposures[0].startMs).toBe(300_000);
  });
  it("survives chunk boundaries at any position", () => {
    const xml = rec(80, "2026-11-03 10:00:00 +0000", "2026-11-03 10:10:00 +0000") + rec(90, "2026-11-03 11:00:00 +0000", "2026-11-03 11:10:00 +0000");
    for (const size of [1, 3, 7, 50, 1000]) {
      const s = new HealthScanner();
      for (let i = 0; i < xml.length; i += size) s.push(xml.slice(i, i + size));
      expect(s.exposures.map((e) => e.db)).toEqual([80, 90]);
    }
  });
  it("counts records it cannot use", () => {
    const s = new HealthScanner();
    s.push(rec(0, "2026-11-03 10:00:00 +0000", "2026-11-03 10:05:00 +0000"));
    s.push(rec(80, "2026-11-03 10:05:00 +0000", "2026-11-03 10:00:00 +0000")); // ends before it starts
    expect(s.seen).toBe(2);
    expect(s.skipped).toBe(2);
    expect(s.exposures).toHaveLength(0);
  });
});

describe("analyze", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  it("80 dB(A) for 40 h in the week = 100 % of the limit", () => {
    const e: Exposure[] = [{ startMs: now - 40 * 3600_000, endMs: now, db: 80 }];
    const a = analyze(e, now);
    expect(a.weekFraction).toBeCloseTo(1, 2);
    expect(a.weekAvgDb).toBeCloseTo(80, 2);
    expect(a.allowedHoursAtWeekAvg).toBeCloseTo(40, 1);
  });
  it("sensitive listeners get a smaller allowance", () => {
    const e: Exposure[] = [{ startMs: now - 40 * 3600_000, endMs: now, db: 75 }];
    expect(analyze(e, now, "sensitive").weekFraction).toBeCloseTo(1, 1);
  });
  it("ignores listening older than 7 days and clips records that straddle the window start", () => {
    const e: Exposure[] = [
      { startMs: now - 20 * 86400_000, endMs: now - 19 * 86400_000, db: 100 },
      { startMs: now - 7 * 86400_000 - 3600_000, endMs: now - 7 * 86400_000 + 3600_000, db: 80 }, // half inside
    ];
    const a = analyze(e, now);
    expect(a.weekSeconds).toBeCloseTo(3600, 0);
    expect(a.usedRecords).toBe(1);
  });
  it("averages dB by energy, not arithmetically", () => {
    const e: Exposure[] = [
      { startMs: now - 7200_000, endMs: now - 3600_000, db: 70 },
      { startMs: now - 3600_000, endMs: now, db: 90 },
    ];
    const a = analyze(e, now);
    expect(a.weekAvgDb).toBeGreaterThan(86); // dominated by the loud hour; arithmetic mean would be 80
    expect(a.weekAvgDb).toBeLessThan(88);
  });
  it("reports no listening cleanly", () => {
    const a = analyze([], now);
    expect(a.weekAvgDb).toBeNull();
    expect(a.weekFraction).toBe(0);
  });
});
