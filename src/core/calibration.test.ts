import { describe, expect, it } from "vitest";
import {
  allowedHoursPerWeek,
  blockRmsDbfs,
  combine,
  deviceFromMicTest,
  deviceFromThreshold,
  exposurePa2h,
  micDbfsToSpl,
  weeklyDoseFraction,
} from "./calibration";

describe("levels", () => {
  it("ignores a constant DC offset (it is not sound)", () => {
    const n = 48000;
    const sine = Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000));
    const withDc = Float32Array.from(sine, (v) => v + 0.05);
    expect(blockRmsDbfs(withDc)).toBeCloseTo(blockRmsDbfs(sine), 3);
    expect(blockRmsDbfs(Float32Array.from({ length: 1000 }, () => 0.02))).toBe(-Infinity); // pure DC = silence
  });

  it("full-scale sine is 0 dBFS (AES17)", () => {
    const n = 48000;
    const s = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000));
    expect(blockRmsDbfs(s)).toBeCloseTo(0, 2);
  });

  it("mic at its 94 dB sensitivity point reads 94 dB SPL", () => {
    expect(micDbfsToSpl(-38, -38)).toBe(94);
  });
});

describe("calibration", () => {
  it("mic test: -20 dBFS tone read as -40 dBFS on a -38 mic at max volume → 112 dB", () => {
    // SPL at mic = -40 + 38 + 94 = 92; S_device = 92 - (-20) - 0 + 0 = 112
    const e = deviceFromMicTest({ playedDbfs: -20, micDbfs: -40, volumeDb: 0, micSensitivity: { value: -38, sigma: 3 }, type: "over-ear" });
    expect(e.value).toBeCloseTo(112);
    expect(e.sigma).toBeGreaterThan(3);
  });

  it("threshold: barely audible at -100 dBFS → ~106 dB", () => {
    expect(deviceFromThreshold(-100).value).toBe(106);
  });

  it("agreeing estimates are merged and marked confident", () => {
    const r = combine({ value: 100, sigma: 4 }, { value: 102, sigma: 5 });
    expect(r.confidence).toBe("confident");
    expect(r.sDevice.value).toBeGreaterThan(100);
    expect(r.sDevice.value).toBeLessThan(102);
    expect(r.conservative).toBeGreaterThan(r.sDevice.value);
  });

  it("a lower hearing estimate never pulls the mic result down", () => {
    const r = combine({ value: 100, sigma: 4 }, { value: 97, sigma: 5 });
    expect(r.confidence).toBe("confident");
    expect(r.sDevice.value).toBeGreaterThanOrEqual(100);
  });

  it("disagreeing estimates use the louder one", () => {
    const r = combine({ value: 95, sigma: 4 }, { value: 108, sigma: 5 });
    expect(r.confidence).toBe("retest-suggested");
    expect(r.sDevice.value).toBe(108);
  });
});

describe("dose (ITU-T H.870)", () => {
  it("80 dB(A) for 40 h = 100 % of the standard weekly allowance", () => {
    expect(weeklyDoseFraction(exposurePa2h(80, 40 * 3600))).toBeCloseTo(1, 2);
  });
  it("+3 dB halves allowed time", () => {
    expect(allowedHoursPerWeek(83) / allowedHoursPerWeek(80)).toBeCloseTo(0.5, 2);
  });
  it("75 dB(A) for 40 h ≈ 100 % in sensitive mode", () => {
    expect(weeklyDoseFraction(exposurePa2h(75, 40 * 3600), "sensitive")).toBeCloseTo(1, 1);
  });
});
