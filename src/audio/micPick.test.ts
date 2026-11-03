import { describe, expect, it } from "vitest";
import { looksBluetooth, pickMeasurementMic, suggestsCallMode } from "./micPick";

// Labels as reported in the milestone-1 Mac runs (Chrome and Safari).
const chrome = [
  { deviceId: "default", label: "Default - SONY ULT WEAR (Bluetooth)" },
  { deviceId: "a", label: "SONY ULT WEAR (Bluetooth)" },
  { deviceId: "b", label: "Tanmay’s iPhone Microphone" },
  { deviceId: "c", label: "MacBook Pro Microphone (Built-in)" },
];
const safari = [
  { deviceId: "x", label: "MacBook Pro Microphone" },
  { deviceId: "y", label: "Tanmay’s iPhone Microphone" },
  { deviceId: "z", label: "SONY ULT WEAR" },
];

describe("pickMeasurementMic", () => {
  it("picks the built-in mic even when the headset is the system default (Chrome)", () => {
    expect(pickMeasurementMic(chrome)?.deviceId).toBe("c");
  });
  it("picks the built-in mic in Safari", () => {
    expect(pickMeasurementMic(safari)?.deviceId).toBe("x");
  });
  it("returns undefined before permission (labels hidden)", () => {
    expect(pickMeasurementMic([{ deviceId: "", label: "" }])).toBeUndefined();
  });
  it("never picks a Bluetooth mic when another exists", () => {
    const r = pickMeasurementMic([
      { deviceId: "1", label: "AirPods Pro" },
      { deviceId: "2", label: "USB Audio Device" },
    ]);
    expect(r?.deviceId).toBe("2");
  });
});

describe("helpers", () => {
  it("flags Bluetooth labels", () => {
    expect(looksBluetooth("SONY ULT WEAR (Bluetooth)")).toBe(true);
    expect(looksBluetooth("MacBook Pro Microphone (Built-in)")).toBe(false);
  });
  it("treats 16 kHz as call mode, 44.1/48 kHz as normal", () => {
    expect(suggestsCallMode(16000)).toBe(true);
    expect(suggestsCallMode(48000)).toBe(false);
    expect(suggestsCallMode(undefined)).toBe(false);
  });
});
