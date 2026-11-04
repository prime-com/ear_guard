# EarGuard — Plan (v2, 2026-11-04)

Goal: anyone, on any platform, can see how loud their headphones / earbuds / headset are
in dB (wired or Bluetooth, any brand), live, and how much of their safe weekly listening
they've used — with no setup and no account, and without pretending to more accuracy than
we have.

> **v2 replaces v1.** v1 relied on a per-user, 2–3 minute calibration test. We built and
> ran it on real hardware (see §1) and dropped it as the main path. The old design is
> archived at the end of this file.

---

## 1. What we learned (evidence, not opinion)

| Finding | Evidence | Consequence |
|---|---|---|
| Opening a Bluetooth headset's own mic switches it to call mode (16 kHz) | Mac, Sony ULT WEAR: music suppressed | Never use the headset mic |
| Opening the Mac's built-in mic does **not** break Bluetooth audio | Chrome 48 kHz, Safari 44.1 kHz | Mic work is possible on desktop |
| On iPhone, opening *any* mic in a web page changes Bluetooth sound | iOS 26.2, built-in mic, "changed" | No mic-based test on iPhone web |
| The DSP chain is sound | Mic test linear to 0.6 dB; simulated S_device recovered to <0.1 dB; hearing check repeatable to ~2.5 dB across sessions | The math and audio code are reusable |
| **Absolute mic level is not portable** | MacBook mic floor −70 dBFS (Safari, night) vs −51 (Safari, day) vs −42…−47 (Chrome, day); the generic −38 dBFS@94 dB sensitivity gave 123 dB vs 88 dB from hearing | A single placeholder sensitivity can't work; every phone/laptop/browser/input-slider differs |
| Wear detection pauses headphones taken off the head | Sony ULT WEAR | The "off-head loud tones" step is fragile in practice |
| The flow is too demanding | Quiet room, max volume, earcup pressed on a hidden mic, two listening rounds | Few people would finish it |

Conclusion: the mic-measurement route cannot be made accurate *and* easy. Accuracy has to
come from **measured headphone data** (measured once, by someone with the right gear),
not from every user's laptop mic.

---

## 2. The model

```
live dB at ear = signal level (A-weighted dBFS) + volume (dB) + S_device
```
`S_device` = dB SPL a full-scale 1 kHz tone produces at the ear at maximum volume.
Dose, A-weighting and the formula above are unchanged from v1 and already implemented
and tested in `src/core/calibration.ts`.

Every `S_device` carries a **source** and a **sigma**, and the app shows a range, never a
bare number. Per device, the best available source wins:

| Priority | Layer | Source | Typical uncertainty |
|---|---|---|---|
| 1 | **Platform data** | Apple Health headphone levels (Apple/Beats), Android sound-dose data | Best where it exists; platform's own calibration |
| 2 | **Headphone database** | Measured once on reference gear, stored as plain files in this repo | ±2–3 dB target, per model |
| 3 | **Cautious estimate** | Generic default chosen to lean **loud** | Wide; clearly labelled "estimate" |

**Safety rule (unchanged): when uncertain, read loud, never quiet.** Dose uses
`estimate + 1σ`. A layer may only be replaced by a more precise one, and the cautious
default must sit at the loud end of what real headphones do.

### Layer 3 — cautious estimate (works for everyone on day one)
- Needs no input from the user: just system volume, output device and signal level.
- The default `S_default` must come from data, not a guess. Candidates: the 90th-percentile
  `S_device` of the database once it has enough models, and until then published limits
  for personal music players (EN 50332 / IEC 62368-1 — figures **to be verified from the
  standards before use**). Until one is verified, the app shows "level unavailable"
  instead of inventing a number.
- Always displayed as an estimate with a wide range.

### Layer 2 — headphone database
- **No measurement rig is available (decision 2026-11-04).** So the database cannot start
  from our own measurements. Until a rig or collaborator appears, entries come from
  **published specs** (wired headphones: sensitivity + impedance) and from **Apple Health
  reference readings** (Apple/Beats). Every entry records its method, and spec-derived
  entries carry a wider sigma. Bluetooth headphones without a published or measured number
  fall back to layer 3.
- Plain files, one per model, in `data/headphones/` (JSON). Fields: id, brand, model,
  type, connection, `S_device {value, sigma}`, method, measured_by, date, rig, notes.
- Contributing = measuring with a reference rig (ear/coupler simulator + calibrated mic)
  and opening a PR; the existing Lab/DSP code is the contributor's measurement tool.
- Wired headphones with a published sensitivity and impedance can be derived from specs,
  but the result also depends on the source's output voltage, so it carries extra sigma.
- A schema check in CI keeps files valid.

### Layer 1 — platform data
- **iPhone / Apple Watch:** read headphone audio exposure from Apple Health (native app
  only; iOS forbids third-party audio capture, so this is the only route on iPhone).
- **Android:** the OS sound-dose data on recent versions (**to verify** API and coverage).
- **Mac / Windows:** no platform dose data → layers 2 and 3.

---

## 3. Apps

A browser cannot hear other apps' audio or read system volume, so live monitoring needs
native apps. The web part shrinks to a landing page, docs, the database browser, and the
contributor measurement tools.

| Order | App | How it gets what it needs |
|---|---|---|
| 1 | **Mac menu bar** | System output level + output volume + device identity via Core Audio (**spike first**, see M3) |
| 2 | Windows tray / Android | Same idea per platform |
| 3 | iPhone | Apple Health only |

The core math (`src/core/`) stays pure TypeScript. For native apps we **port it and share
test vectors** (JSON input/output pairs) so every port is checked against the same
expectations.

### 3a. M3 result — Mac feasibility (macOS 26.6, Swift 6.3, Sony ULT WEAR over Bluetooth)

Code: `spike/mac-audio/` (`swift run spike 10`). All three needs are met:

| Need | How | Result |
|---|---|---|
| Output device name + type | Core Audio default output device: `kAudioObjectPropertyName`, `kAudioDevicePropertyTransportType` | ✅ "SONY ULT WEAR", transport `blue` (Bluetooth); built-in is `bltn`, USB `usb ` |
| Output volume | virtual main volume (`vmvc`) → 0…1 slider position | ✅ works for Bluetooth. `VolumeDecibels` returns 0 → **no real dB**, so slider→dB mapping is still ours |
| System output signal level | Core Audio **process tap** (`CATapDescription` global tap + private aggregate device with the output device as sub-device), macOS ≥ 14.2 | ✅ 48 kHz stereo float; level moved with the music (−11…−21 dBFS, peaks 0.4–0.74) |

Findings that shape the app:
- The tap reads the signal **before** the volume is applied (same ≈ −15 dBFS at volume 0.44 and
  0.0625), so signal level and volume are cleanly separate inputs to the formula.
- **Permission:** capture returns pure silence, with no error, until the host app has
  *System Settings → Privacy & Security → Screen & System Audio Recording → "System Audio
  Recording Only"*. A tool run from VS Code's helper gets silence; from Terminal it works once
  Terminal is added. The real app needs `NSAudioCaptureUsageDescription` in its Info.plist and
  must explain the permission in onboarding. Detect "all silence while volume > 0" and tell
  the user.
- Bluetooth: no gain in dB is exposed, only the slider. Absolute-volume behaviour on the
  headphone side is unknown and stays inside `S_device`'s uncertainty.
- Still to check later: per-app audio, multi-output setups, device switches while running,
  sleep/wake, an Info.plist-bundled app (the spike is a bare executable).

### 3b. M4 — what was built (`app/mac/`, Swift package, no Xcode needed)

- `EarGuardCore` (pure): dose maths, `AWeightingFilter` (IEC 61672, bilinear, within 0.7 dB of the
  standard table), `LevelMeter` (per-channel, **loudest channel wins**), `DoseStore` (15-minute
  buckets, rolling 7 days, `~/Library/Application Support/EarGuard/dose.json`), `estimateLevel`.
- `EarGuardMac`: Core Audio tap + output info + `Tracker` + menu-bar UI. `--print N` runs the engine
  headless. `./build-app.sh` makes an ad-hoc-signed `build/EarGuard.app` with
  `NSAudioCaptureUsageDescription` (the app gets its own "System Audio Recording" entry).
- `EarGuardSelfTest`: `swift run EarGuardSelfTest` — 66 checks incl. `test-vectors/core.json`,
  which is **generated from the TypeScript** and verified by both languages.
- Counted toward dose: Bluetooth, USB, headphone jack. Not counted: built-in speakers, HDMI/display,
  AirPlay. Volume unknown → assume max (loud side). Dose accumulates `estimate + 1σ`.

**Layer-3 default is an UNVERIFIED PLACEHOLDER** (`Estimate.swift`): `S_default = 100 ± 10 dB`
(full-scale tone at max volume) and slider→dB = `20·log10(slider)` ± 6 dB. They were chosen only to
span the two reference points we have (Sony ≈ 85–88 dB from the hearing check, which reads low;
EarPods ≈ 111 dB from Apple Health on an iPhone, source-dependent) and to lean loud. Research
(2026-11-04): EN 50332 caps player output at 100 dB(A) **for its own programme-noise test signal**
and warns above 85 dB(A); converting that to a full-scale-sine figure was not possible from
published sources, so it was NOT used. The UI labels everything "rough estimate". Replace with
verified data in M6.

### Volume curve
Slider position → dB is not linear and differs per OS and, for Bluetooth, per device
(absolute volume). Measured once: Mac slider at 50 % ≈ −17 dB on the Sony. The apps need a
per-platform mapping, ideally from reading the actual device gain rather than the slider.

---

## 4. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Web prototype & Bluetooth-mic test | ✅ done (Android untested) |
| M2 | Guided calibration flow | ✅ built and run end to end; **retired as main path** |
| ✅ **M3** | **Mac spike (DONE 2026-11-04, see §3a):** can a native Mac app get (a) the system output signal level, (b) the output volume or gain, (c) the output device name, for Bluetooth and wired? Write down what needs permissions | A short written result + a tiny working prototype |
| 🟡 **M4** | **Mac menu-bar app** (`app/mac/`): live dB from layer 3 + dose tracking, local only. **Built and self-tested (66 checks); not yet run for a day with real music** | Runs for a day without crashing; dose matches hand calculation |
| M5 | Database format + schema CI + first entries (needs a measurement rig or a collaborator who has one) | ≥ 5 models measured with published method |
| M6 | Verify the layer-3 default against standards and the first measurements; publish error data | Written accuracy report |
| M7 | Windows / Android | — |
| M8 | iPhone via Apple Health | — |
| M9 | Website, docs, contribution guide | — |

---

## 5. Risks
1. **No measurement rig, and none planned.** Layer 2 is spec-derived only, so most
   Bluetooth headphones run on layer 3 (wide ranges). Mitigation: label every number's
   source; use Apple Health on Apple/Beats headphones as a free reference; accept a
   collaborator's measurements if one appears.
2. **macOS may restrict reading system audio** (permissions, Bluetooth absolute volume).
   Mitigation: the M3 spike comes before any UI work.
3. **Cautious default may be too loud/quiet for typical headphones.** Mitigation: derive it
   from measured data; publish it with its error; keep the "read loud" rule.
4. **Slider-to-dB mapping** differs by OS/device. Mitigation: read real device gain where
   the OS exposes it; otherwise widen sigma.
5. **Trust.** A health app that is wrong is worse than none. Mitigation: ranges, honest
   labels, published error data, no invented numbers.

---

## Archived — v1 calibration test (kept for contributors)

The flow built in M2 (still deployed, labelled experimental): room check → mic test
(headphones against the device mic, volume at max) → volume steps → hearing check →
combined result. Math: `S_device = SPL_at_mic − L_played − G_volume + C_type`, with the
hearing check as a floor-only cross-check (`S_hearing = T_ref − L_threshold`, may raise a
result, never lower it). It works as a **measurement tool** but not as a consumer flow,
because the mic sensitivity and earcup coupling are not known per device. Code:
`src/calibrate.ts`, `src/core/measure.ts`, `src/audio/*`.
