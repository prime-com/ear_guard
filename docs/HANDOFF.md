# EarGuard — context handoff

Paste this to a fresh Claude session (VS Code extension, CLI, anywhere) to pick up
where the project left off. Read `docs/PLAN.md` next — it holds the full plan and math.

## What this project is

Open-source app that shows **how loud your headphones actually are, in dB, live** —
any brand, wired or Bluetooth, on any platform. Free, no account, listening data stays
on the device. It also tracks how much of your safe weekly listening you've used
(WHO / ITU-T H.870: 80 dB(A) × 40 h/week).

Repo: https://github.com/prime-com/ear_guard · Owner: prime-com (Tanmay) · License: MIT

## Decisions already made — don't re-litigate these

| Decision | Why |
|---|---|
| **Web app first**, then Mac → Windows/Android → iPhone last | iPhone needs a $99/yr dev account to test; the web runs from a link anywhere |
| **Calibration is the hard part and comes first** | Everything else is easy once we know how loud a device gets |
| **Must work for Bluetooth, not just wired** | Spec-sheet-only approaches were rejected for this reason |
| **The "calibration network" idea (users loudness-matching between devices) was dropped** | Needs a large user base we don't have yet |
| **Official-specs-only approach was dropped as the primary method** | Brands publish almost nothing usable for Bluetooth |
| **Chosen method: a one-time 2–3 min test per headphone** using the phone/laptop mic + a hearing check | Works identically for wired and Bluetooth, needs no extra gear |
| Naming/branding | Deferred. "EarGuard" is a working name |

## How calibration works (short version)

```
live dB at ear = audio signal level (A-weighted dBFS) + volume (dB) + S_device
```
`S_device` = dB SPL the headphone produces for a full-scale signal at max volume. That
one number per headphone is what the test measures. The test:

1. **Room check** — mic measures background noise, rejects noisy rooms.
2. **Mic test** (headphones OFF the head) — hold the earbud/earcup against the
   phone/laptop mic; app plays tones at known levels and measures them. → estimate #1
3. **Volume steps** — repeat at ~50 % and ~25 % to learn the device's volume curve
   (important for Bluetooth, where steps are non-linear).
4. **Hearing check** (headphones ON) — lower a 1 kHz tone until barely audible. → estimate #2
5. **Combine** — agree within 4 dB → "confident"; disagree → use the louder one and
   suggest a retest.

**Safety rule that must never be broken:** when uncertain, the app reads **loud, not
quiet**. Dose uses `estimate + 1σ`. The hearing check may only *raise* a result, never
lower it, because hearing loss and background noise bias it low — which would hide risk.

Priority of data sources per device: platform data (Apple Health / Android sound dose)
→ official spec sheet (wired only) → the user's own calibration test.

## Current state

```
docs/PLAN.md               full plan: phases, test flow, math, risks, milestones
docs/HANDOFF.md            this file
src/core/calibration.ts    calibration + dose math (pure TS, no browser APIs — the
                           native apps will reuse it). 
src/core/calibration.test.ts
src/audio/signals.ts       1 kHz sine, pink noise, log sweep — generated in code
src/audio/mic.ts           mic capture with echoCancellation/noiseSuppression/autoGain OFF
src/main.ts, index.html    "EarGuard Lab" prototype UI + JSON result export
calibrate.html, src/calibrate.ts
                           guided calibration flow (milestone 2): room check → mic test →
                           volume steps → hearing check → result, saved in localStorage.
                           Also a "hearing check only" mode (used by default on iPhone).
src/core/measure.ts        pure analysis for that flow (room check, mic-test linearity /
                           SNR / clipping checks, volume steps, hearing summary) + tests
src/core/profile.ts        saved-profile shape; src/storage.ts = localStorage wrapper
src/audio/hearing.ts       pulsed 1 kHz tone, −105 → hard cap −55 dBFS at 1.5 dB/s
src/audio/builtin.ts       opens the built-in mic, refuses Bluetooth/call-mode mics
```

Run it:
```bash
npm install
npm run dev     # Network URL lets you test from a phone
npm test        # math tests
```

Status: prototype smoke-tested in a headless browser only. **Never tested with real
headphones or a real mic.**

### Known placeholders that must be replaced before any number is trustworthy
- `COUPLING_CORRECTION` in `calibration.ts` is **0 dB for all types** — the real
  "against a mic" → "in an ear canal" corrections must be measured with reference gear.
- `DEFAULT_MIC_SENSITIVITY` is a generic MEMS guess (−38 dBFS @ 94 dB SPL). Real
  per-phone-model values are needed.
- No headphone or phone database exists yet.

**Rule: never invent calibration numbers for real devices.** A wrong number here means
someone under-estimates their exposure. Placeholders must stay obviously placeholder.

## Milestone 2 status (guided calibration)

Built and tested end-to-end in headless Chromium with a **simulated** mic (known offset →
recovered S_device to <0.1 dB; volume drops and hearing thresholds recovered exactly).
**Not yet run with a real mic + real headphones** — that is the next thing to do.

Choices made while building it (change if the real-hardware run says so):
- Mic test plays 1 kHz at −60…−20 dBFS and stops early if the mic reads > −30 dBFS or
  clips. Each step needs ≥ 15 dB SNR over the room noise; steps must rise ~1 dB/dB
  (otherwise "not linear" = the browser is probably applying auto-gain — this is the
  check that covers Safari not reporting noiseSuppression/autoGain).
- The volume curve is stored as dB vs max at OS-slider 50 % / 25 %. The hearing check runs
  at max volume, as in the plan.
- Hearing check: two ascending trials, pulsed tone, keeps the **lowest** threshold
  (= louder device, the safe side). Reaction delay is deliberately not corrected.
- Every threshold in `measure.ts` (ROOM_MAX_DBFS, MIN_SNR_DB, …) is a heuristic to tune.
- Results are labelled "test version — not accurate yet" because COUPLING_CORRECTION and the
  mic sensitivity are still placeholders. Profiles carry `accuracy: "placeholder"`.
- Fixed: `combine()` let a lower hearing estimate pull a confident mic result *down*, which
  broke the safety rule. It can now only raise it (test added).
- Fixed: readings in the first ~170 ms after opening the mic were too low (empty analyser
  buffer) and made quiet rooms look "unsteady". `measureFor` now waits 400 ms after open.
- Not built yet: pink-noise / sweep seal check, per-phone mic sensitivity table, wear-detection
  handling beyond the on-screen advice.

### First real-hardware run of the calibration page (2026-11-04, ~3 am)

- **Hearing-only mode worked** (Sony ULT WEAR, Bluetooth): thresholds −76.6 / −79.2 dBFS,
  2.6 dB apart (consistent) → S_device ≈ 85 ± 5 dB, dose value 90 dB, confidence
  "hearing-only". Unverified: not known whether volume was at max; hearing-only reads low by
  design; no reference to compare with yet. Saved as "Unnamed headphones" (name left empty).
- **Room check rejected a quiet room — diagnosed, fix pushed (needs a real-hardware re-test).**
  Measured with the Lab meter, silent room, MacBook built-in mic: Chrome −42…−47 dBFS,
  Safari −50.8 dBFS by day, versus Safari −70 dBFS at 2 am. DC offset is only −86 dBFS, so it
  was not DC (DC is still removed from levels, which is correct anyway). The floor moves ~19 dB
  with time of day and differs by browser, so the fixed −55 dBFS limit was the wrong rule.
  Now `ROOM_MAX_DBFS = MIC_CEILING_DBFS − MIN_SNR_DB = −35` (derived: a tone must reach 15 dB
  above the noise without passing the mic ceiling, now −20 dBFS), swing limit 10 dB. Accuracy
  is still protected by the per-step SNR gate + noise subtraction in `analyzeMicTest`.
  Watch for: if the floor is high the top mic-test steps may fail "too quiet" — that is the
  honest outcome; consider a tighter coupling (earcup sealed on the mic) or a quieter time.
- Was the run on Mac or iPhone, and was volume at max? Not confirmed with the user.

## NEXT STEPS (pick up here)

1. Re-run the **full test** on the Mac (Chrome, built-in mic, Sony on a pillow, volume max)
   and read the room-check numbers in the message if it fails again. Fix thresholds from data.
2. Compare mic estimate vs hearing estimate; discuss the gap.
3. Milestone 3 accuracy check (AirPods + Apple Health, wired headphones with published specs)
   to replace the placeholder `COUPLING_CORRECTION` / mic sensitivity.
4. Android Chrome milestone-1 run (no Android phone was available).
5. Later: headphone/phone database, native apps (see "After milestone 1" below).

## THE IMMEDIATE NEXT TASK — milestone 1

**Find out whether opening the microphone breaks Bluetooth audio.** On many
phones/laptops, a page calling `getUserMedia()` switches a Bluetooth headset into
"call mode" (HFP), which changes its level and quality — that would invalidate the mic
test for Bluetooth and force a redesign.

Test procedure (the Lab UI walks through it):
1. Connect Bluetooth headphones, set them as output.
2. Level slider low (≈ −50 dBFS), press **Play**, headphones off the ears but audible.
3. Select the **built-in** mic in the dropdown.
4. Press **Open mic** while the tone plays.
5. Note whether the sound changes — quieter, muffled, stops, switches to speakers.
6. Press "Sound changed" / "Sound unchanged", then **Download results (JSON)**.

Run it on: **Mac, Android, iPhone** (iOS Safari is the strictest and matters most).
Phones need HTTPS for mic access — deploy to GitHub Pages / Vercel, or use a tunnel.

Also verify: does the browser actually honour `echoCancellation:false` etc.? The Lab
prints what the browser reports — check it, and sanity-check by measuring a known tone.

### Results so far (2026-11-03, MacBook Pro + Sony ULT WEAR over Bluetooth)

| Setup | Mic sample rate | Bluetooth audio |
|---|---|---|
| Chrome, **headset's own mic** | 16 kHz | **Changed** — call mode (HFP), music suppressed |
| Chrome, built-in mic | 48 kHz | Unchanged ✅ |
| Safari, built-in mic | 44.1 kHz | Unchanged ✅ |
| **iPhone** (iOS 26.2, Chrome = WebKit), built-in "iPhone Microphone" | 48 kHz | **Changed** ❌ |

- **Rule: measure with the built-in mic, never the headset mic.** The Lab now auto-picks
  it (`src/audio/micPick.ts`) and warns on a Bluetooth mic or a ≤16 kHz sample rate.
- Chrome reports echoCancel/noiseSuppr/autoGain all `false`. **Safari only reports
  `echoCancellation`**, so NS/AGC being off is unconfirmed there — verify by playing two
  levels and checking the mic reading moves by the same amount.
- First Safari readings: −40 dBFS tone → −52 dBFS at the mic, room floor −70 dBFS,
  repeat readings within 0.4 dB.
- **iPhone: opening any mic in a web page changes Bluetooth audio**, even with the
  built-in mic selected. iOS switches the audio session to play-and-record. The mic still
  reports 48 kHz, so the ≤16 kHz call-mode check does **not** catch this on iOS — the
  sample rate describes the mic, not the headphone link.
  → On iPhone, the web mic test can't measure Bluetooth headphones. Use the hearing
  check there, run the mic test from a Mac/Android instead, or (native app) Apple Health.
- iPhone Safari mutes Web Audio in Silent mode; the Lab sets `navigator.audioSession.type
  = "playback"` to fix that (worked: tone played).
- **Wear detection** (Sony ULT WEAR, AirPods, many others) pauses or re-routes audio when
  the headphones come off the head — this clashes with "loud tones only off the head".
  The calibration flow must handle it (ask users to disable it, or keep the head-shaped
  object trick). Unsolved.
- Still to run: Android Chrome.

**If Bluetooth audio does change when the mic opens,** fall back options to explore:
force the built-in mic (works on desktop), measure during a mic-closed window, or lean
harder on the hearing check for Bluetooth devices.

## After milestone 1

2. Build the full guided calibration flow (the 5 steps above) + save profiles locally.
3. Accuracy check on 5–10 headphones. Reference points: AirPods (Apple Health shows
   real dB for the same audio) and wired headphones with published sensitivity/impedance.
   Tune `COUPLING_CORRECTION` from this. Target: within ±5 dB for v1, and publish the
   error data honestly.
4. Headphone/phone database as plain files in the repo so anyone can contribute.
5. Native apps for live dB (browsers can't hear other apps' audio — this is why a real
   app is needed): Mac menu bar first, then Windows tray / Android widget, iPhone last
   (reads Apple Health, since iOS forbids third-party audio capture).

## Conventions
- TypeScript, Vite, no backend, no telemetry. Math stays in `src/core/` as pure
  functions so native apps can port it.
- dBFS follows AES17 (full-scale sine = 0 dBFS).
- Anything uncertain gets a sigma and is shown to the user as a range, never a bare number.
- Loud tones are only ever played with headphones off the head; the UI must keep warning this.
