import { describe, expect, it } from "vitest";
import { combine } from "./calibration";
import { buildProfile, parseProfiles, serializeProfiles } from "./profile";

const result = combine({ value: 100, sigma: 4 });
const base = { name: " Sony ULT WEAR ", type: "over-ear" as const, connection: "bluetooth" as const, result, volumeCurve: [], raw: {} };

describe("profiles", () => {
  it("builds a profile marked as placeholder-accuracy", () => {
    const p = buildProfile(base, new Date("2026-11-04T00:00:00Z"), "abc");
    expect(p.name).toBe("Sony ULT WEAR");
    expect(p.accuracy).toBe("placeholder");
    expect(p.createdAt).toBe("2026-11-04T00:00:00.000Z");
  });
  it("round-trips through JSON", () => {
    const p = buildProfile(base);
    expect(parseProfiles(serializeProfiles([p]))).toEqual([p]);
  });
  it("drops malformed or foreign data instead of trusting it", () => {
    expect(parseProfiles("not json")).toEqual([]);
    expect(parseProfiles(null)).toEqual([]);
    expect(parseProfiles('{"a":1}')).toEqual([]);
    expect(parseProfiles('[{"version":1,"id":"x","name":"n","result":{"sDevice":{"value":"x"}}}]')).toEqual([]);
  });
});
