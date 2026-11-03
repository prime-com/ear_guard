# EarGuard

Open-source app to see how loud your headphones, earbuds or headset really are — in dB,
live — for **any brand**, **wired or Bluetooth**, on any platform. Free, no account,
your listening data stays on your device.

> Status: early prototype (Phase 1, milestone 1). See [docs/PLAN.md](docs/PLAN.md).

## How it works (short)
A one-time 2–3 minute test per headphone measures how loud it gets using only your
phone/laptop mic plus a quick hearing check. After that, live dB = audio signal level +
volume + your headphone's calibration. Exposure is tracked against the WHO / ITU-T H.870
safe-listening limits (80 dB(A) for 40 h/week).

## Run the lab prototype
```bash
npm install
npm run dev      # open the printed URL (use the Network URL to test on your phone)
npm test         # calibration & dose math tests
```
Mic access on a phone needs HTTPS (or localhost) — use the deployed version for phones.

## Project layout
- `src/core/` — calibration + dose math (pure, shared with future native apps)
- `src/audio/` — test-signal generator and mic meter
- `docs/PLAN.md` — the full plan

## License
MIT
