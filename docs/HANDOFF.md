# EarGuard — context handoff

Paste this to a fresh Claude session (VS Code extension, CLI, anywhere) to pick up
where the project left off. Read `docs/PLAN.md` next — it holds the full plan and math.

## What this project is

Open-source app that shows **how loud your headphones actually are, in dB, live** —
any brand, wired or Bluetooth, on any platform. Free, no account, listening data stays
on the device. It also tracks how much of your safe weekly listening you've used
(WHO / ITU-T H.870: 80 dB(A) × 40 h/week).

Repo: https://github.com/prime-com/ear_guard · Owner: prime-com (Jayesh) · License: MIT

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
                           native apps will reuse it). 9 passing tests.
src/core/calibration.test.ts
src/audio/signals.ts       1 kHz sine, pink noise, log sweep — generated in code
src/audio/mic.ts           mic capture with echoCancellation/noiseSuppression/autoGain OFF
src/main.ts, index.html    "EarGuard Lab" prototype UI + JSON result export
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

- **Rule: measure with the built-in mic, never the headset mic.** The Lab now auto-picks
  it (`src/audio/micPick.ts`) and warns on a Bluetooth mic or a ≤16 kHz sample rate.
- Chrome reports echoCancel/noiseSuppr/autoGain all `false`. **Safari only reports
  `echoCancellation`**, so NS/AGC being off is unconfirmed there — verify by playing two
  levels and checking the mic reading moves by the same amount.
- First Safari readings: −40 dBFS tone → −52 dBFS at the mic, room floor −70 dBFS,
  repeat readings within 0.4 dB.
- Still to run: Android Chrome, iPhone Safari (via the GitHub Pages deploy).

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
