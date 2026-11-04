import { describe, expect, it } from "vitest";
import { DEFAULT_MIC_SENSITIVITY, deviceFromThreshold } from "./calibration";
import {
  analyzeMicTest,
  checkRoom,
  energyMeanDb,
  MIC_CEILING_DBFS,
  MIN_SNR_DB,
  ROOM_MAX_DBFS,
  subtractNoise,
  summarizeBlock,
  summarizeHearing,
  volumeStep,
} from "./measure";

const opts = { type: "over-ear" as const, micSensitivity: DEFAULT_MIC_SENSITIVITY };

/** Simulated ideal mic: signal = played + offset, plus a noise floor. */
function simulate(playedLevels: number[], offsetDb: number, noiseDbfs: number, peak = 0.1) {
  return playedLevels.map((p) => ({
    playedDbfs: p,
    micDbfs: energyMeanDb([p + offsetDb, noiseDbfs]) + 3.01, // sum of the two powers
    peak,
  }));
}

describe("room check", () => {
  it("accepts a quiet steady room", () => {
    expect(checkRoom({ dbfs: -70, peak: 0.01, spreadDb: 2 }).ok).toBe(true);
  });
  it("rejects a loud room", () => {
    expect(checkRoom({ dbfs: -30, peak: 0.1, spreadDb: 2 }).problem).toBe("too-loud");
  });
  it("accepts the ordinary daytime floors measured on a MacBook (Chrome −42, Safari −51)", () => {
    expect(checkRoom({ dbfs: -42, peak: 0.05, spreadDb: 7.6 }).ok).toBe(true);
    expect(checkRoom({ dbfs: -51, peak: 0.05, spreadDb: 3 }).ok).toBe(true);
  });
  it("derives its limit from what a 15 dB-SNR tone needs", () => {
    expect(ROOM_MAX_DBFS).toBe(MIC_CEILING_DBFS - MIN_SNR_DB);
  });
  it("rejects fluctuating noise such as speech", () => {
    expect(checkRoom({ dbfs: -65, peak: 0.1, spreadDb: 15 }).problem).toBe("unsteady");
  });
  it("detects a muted / dead mic", () => {
    expect(checkRoom({ dbfs: -Infinity, peak: 0, spreadDb: 0 }).problem).toBe("no-signal");
    expect(checkRoom({ dbfs: -120, peak: 0, spreadDb: 0 }).problem).toBe("no-signal");
  });
});

describe("noise handling", () => {
  it("removes noise power", () => {
    // equal signal and noise power → measured is +3 dB over noise → removing gives the noise level
    expect(subtractNoise(-67, -70)).toBeCloseTo(-70, 0);
  });
  it("returns null when the reading is not above the noise", () => {
    expect(subtractNoise(-70, -68)).toBeNull();
  });
  it("summarizes readings with an energy mean", () => {
    const b = summarizeBlock([-60, -60, -54], 0.2);
    expect(b.dbfs).toBeGreaterThan(-58);
    expect(b.spreadDb).toBe(6);
  });
});

describe("mic test", () => {
  const noise = -70;

  it("recovers a known S_device from a simulated ideal mic", () => {
    // Mic reads (played + 20 dB). With sensitivity −38: SPL = micDbfs + 38 + 94 → S = offset + 132.
    const steps = simulate([-60, -50, -40, -30], 20, noise);
    const r = analyzeMicTest(steps, noise, opts);
    expect(r.ok).toBe(true);
    expect(r.sDevice!.value).toBeGreaterThan(151);
    expect(r.sDevice!.value).toBeLessThan(153);
    expect(r.reference!.playedDbfs).toBe(-30);
  });

  it("drops steps that are too close to the noise floor", () => {
    const r = analyzeMicTest(simulate([-90, -80, -50, -40], 20, noise), noise, opts);
    expect(r.steps.filter((s) => s.issue === "too-quiet").length).toBe(2);
    expect(r.ok).toBe(true);
  });

  it("drops clipped steps and never uses them", () => {
    const steps = simulate([-50, -40, -30, -20], 20, noise);
    steps[3].peak = 0.99;
    const r = analyzeMicTest(steps, noise, opts);
    expect(r.steps[3].issue).toBe("clipped");
    expect(r.reference!.playedDbfs).toBe(-30);
  });

  it("fails clearly when every step clips", () => {
    const steps = simulate([-50, -40], 40, noise, 1);
    expect(analyzeMicTest(steps, noise, opts).problem).toBe("all-clipped");
  });

  it("needs at least two usable steps", () => {
    expect(analyzeMicTest(simulate([-90, -85, -50], 20, noise), noise, opts).problem).toBe("too-few-steps");
  });

  it("flags a mic that is not linear (auto-gain / compression)", () => {
    // Mic output barely changes with the played level, as an AGC would do.
    const steps = [
      { playedDbfs: -60, micDbfs: -40, peak: 0.1 },
      { playedDbfs: -50, micDbfs: -39, peak: 0.1 },
      { playedDbfs: -40, micDbfs: -38.5, peak: 0.1 },
    ];
    expect(analyzeMicTest(steps, noise, opts).problem).toBe("not-linear");
  });
});

describe("volume steps", () => {
  const noise = -70;
  it("measures a level drop relative to max volume", () => {
    const r = volumeStep(-30, -50, noise);
    expect(r.ok).toBe(true);
    expect(r.volumeDb).toBeCloseTo(-20, 0);
  });
  it("reports 'too quiet' when the tone sinks into the noise", () => {
    expect(volumeStep(-30, -68, noise).problem).toBe("too-quiet");
  });
  it("notices when the volume was not actually lowered", () => {
    expect(volumeStep(-30, -25, noise).problem).toBe("not-lower");
  });
});

describe("hearing check", () => {
  it("returns null if the tone was never heard", () => {
    expect(summarizeHearing([null, null])).toBeNull();
  });
  it("keeps the lowest threshold (louder device — the safe side)", () => {
    const h = summarizeHearing([-88, -92])!;
    expect(h.thresholdDbfs).toBe(-92);
    expect(h.consistent).toBe(true);
  });
  it("flags trials that disagree a lot", () => {
    expect(summarizeHearing([-70, -95])!.consistent).toBe(false);
  });
  it("lower threshold gives a louder S_device", () => {
    expect(deviceFromThreshold(-95).value).toBeGreaterThan(deviceFromThreshold(-85).value);
  });
});
