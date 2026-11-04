import { describe, expect, it } from "vitest";
import vectors from "../../test-vectors/core.json";
import { allowedHoursPerWeek, dbToPa2, earLevelDb, exposurePa2h, rmsToDbfs, weeklyDoseFraction } from "./calibration";

// The same file is checked by the Swift port (app/mac, `swift run EarGuardSelfTest`).
describe("shared test vectors", () => {
  it("dbToPa2", () => vectors.dbToPa2.forEach((v) => expect(dbToPa2(v.db)).toBeCloseTo(v.pa2, 12)));
  it("exposurePa2h", () => vectors.exposurePa2h.forEach((v) => expect(exposurePa2h(v.db, v.seconds)).toBeCloseTo(v.pa2h, 9)));
  it("weeklyDoseFraction", () =>
    vectors.weeklyDoseFraction.forEach((v) => expect(weeklyDoseFraction(v.pa2h, v.mode as "standard" | "sensitive")).toBeCloseTo(v.fraction, 9)));
  it("allowedHoursPerWeek", () =>
    vectors.allowedHoursPerWeek.forEach((v) => expect(allowedHoursPerWeek(v.db, v.mode as "standard" | "sensitive")).toBeCloseTo(v.hours, 6)));
  it("earLevelDb", () => vectors.earLevelDb.forEach((v) => expect(earLevelDb(v.signalDbA, v.volumeDb, v.sDevice)).toBeCloseTo(v.db, 9)));
  it("rmsToDbfs", () => vectors.rmsToDbfs.forEach((v) => expect(rmsToDbfs(v.rms)).toBeCloseTo(v.dbfs, 9)));
});
