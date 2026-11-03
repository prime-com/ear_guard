# EarGuard — Plan

Goal: anyone, on any platform, can see how loud their headphones / earbuds / headset
are in dB (wired or Bluetooth, any brand), live, and how much of their safe weekly
listening they've used.

## Phases

| Phase | What | Why first |
|---|---|---|
| 1 | **Calibration web app** — one-time 2–3 min test per headphone | Proves the hard part works; no app store, runs from a link |
| 2 | **Headphone data** — official specs + platform data (Apple Health, Android sound dose) + shared calibration results | Skips the test for known devices |
| 3 | **Live dB apps** — Mac (menu bar + widget) → Windows/Android → iPhone (via Apple Health) | Browsers can't hear other apps' audio |
| 4 | Website, docs, contribution guide, published accuracy report | Trust + growth |

Data source priority per device: phone's own calibrated data → official spec sheet → user's calibration test.

---

# Phase 1 — Calibration web app

## 1. The test flow (one time per headphone)

| Step | User does | App does | Time |
|---|---|---|---|
| 0. Setup | Picks headphone type (earbuds / over-ear / on-ear), wired or Bluetooth, enters model name | Remembers device | 15 s |
| 1. Room check | Stays quiet | Mic measures background noise; if too loud → "find a quieter room" | 10 s |
| 2. Mic test | Sets volume to **max**, holds earbud/earcup against the phone/laptop mic (app shows where it is) | Plays 1 kHz tone, then pink noise, at rising digital levels; measures with mic; checks for clipping & bad seal (sweep) | ~60 s |
| 3. Volume steps | Same position, sets volume to ~50% and ~25% when asked | Measures again → learns the device's volume curve (matters for Bluetooth) | ~30 s |
| 4. Hearing check | Puts headphones on (mic is closed now), lowers a 1 kHz tone until barely audible, both ears | Records threshold level | ~45 s |
| 5. Result | — | Combines, shows "Max ≈ X dB(A) ± Y", confidence label, saves locally | — |

Headphones are off the head during the loud mic steps, so nothing is played loudly into ears.

## 2. The math

**Mic test → device loudness**
```
SPL_at_mic   = L_mic(dBFS) − M_mic(dBFS @ 94 dB SPL) + 94
S_device     = SPL_at_mic − L_played(dBFS) − G_volume(dB) + C_type(dB)
```
- `S_device` = dB SPL at the ear for a full-scale signal at max volume (the profile number).
- `M_mic` = mic sensitivity: from a small per-phone/laptop-model table, else a typical MEMS default with wider uncertainty.
- `C_type` = correction from "against a mic" to "in an ear canal", per type (earbuds / over-ear / on-ear). We measure these once ourselves with proper gear on a handful of headphones.

**Hearing check → independent estimate**
```
S_device_hearing = T_ref(≈ 5–7 dB SPL at 1 kHz) − L_threshold(dBFS)   [at max volume]
```
Hearing loss and background noise push this estimate *low*, so it is only used as a cross-check / to raise the result, never to lower it.

**Combine**
- Agree within ~4 dB → "Confident".
- Disagree → use the louder estimate, label "Retest suggested".
- Stored value used for dose = estimate + 1σ (leans loud when unsure).

**Live dB (later apps)** = signal level (A-weighted, dBFS) + volume (dB) + `S_device`.
Dose vs WHO/ITU-T H.870: 80 dB(A) × 40 h/week (adult), 75 dB(A) × 40 h/week (sensitive); +3 dB halves allowed time.

## 3. Test signals (generated in code, no licensing)
- 1 kHz sine — reference for mic test and hearing check
- Pink noise (IEC 60268-1 programme-simulation shaped) — "typical music" level, used by EN 50332
- Log sine sweep 100 Hz–10 kHz — seal/coupling sanity check

## 4. Tech
- TypeScript + Vite, Web Audio API (AudioWorklet for level metering), static hosting (GitHub Pages / Vercel), no backend.
- Mic opened with `echoCancellation:false, noiseSuppression:false, autoGainControl:false`.
- Results stored locally (IndexedDB) + export as a small JSON profile; optional anonymous share later.
- Calibration/dose math in a small standalone module with unit tests, so the native apps can reuse it.

## 5. Biggest risks — test these first
1. **Bluetooth mic switching:** when a page opens the mic, many phones/laptops switch a Bluetooth headset into "call mode" (its own mic, lower-quality audio, different level). Mitigation: force the built-in mic (possible on desktop; must test on iPhone/Android), and keep the hearing check in a separate step with the mic closed.
2. **Browsers ignoring "no processing"** (esp. iOS Safari): verify by measuring a known tone.
3. **Phone mic variation** across models: start with a few common phones, measure them against a sound level meter.
4. **Earbud-vs-ear-canal correction:** needs our own reference measurements.

## 6. How we know it's accurate
- **AirPods**: compare our result with Apple Health's headphone level for the same audio.
- **Wired headphones with official specs**: compare with spec-derived value.
- If available: a basic sound level meter / calibrated USB mic for spot checks.
- Target: within ±5 dB on most devices for v1; publish the results.

## 7. Milestones
1. Mic + tone playback prototype; test the Bluetooth mic-switching risk on Mac, iPhone, Android.
2. Full test flow + math module with tests.
3. Accuracy check on 5–10 headphones; tune `C_type` and defaults.
4. Polish UI, export profile, publish.
