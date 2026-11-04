# EarGuard

See how loud your headphones really are, live, and keep track of your weekly listening
against the WHO / ITU-T H.870 safe-listening limit (80 dB(A) for 40 hours a week).

- Works with **any headphones**, wired or Bluetooth, any brand
- **Free, open source, no account, no tracking**. Everything stays on your device
- Honest about accuracy: the number is a **rough estimate**, and when unsure it reads *loud*, never quiet

| Platform | What you get | Live dB |
|----------|--------------|---------|
| **Mac** (macOS 14.2+) | Menu-bar app | Yes |
| **Windows** (10/11) | System-tray app | Yes |
| **Android** (10+) | App with a status notification | Yes |
| **iPhone** | Apple blocks third-party apps from hearing other apps' audio. Use Control Center's **Hearing** tile for live level, and the [Health page](https://prime-com.github.io/ear_guard/health.html) for your weekly dose | Via Apple |

## Get it

Download the latest build from the **[Releases page](https://github.com/prime-com/ear_guard/releases)**.

### Mac
1. Download `EarGuard-mac.zip`, unzip it, and drag **EarGuard** anywhere (for example Applications).
2. The first time, **right-click → Open** (the app is not notarised by Apple, so a plain double-click is blocked).
   If macOS still refuses, run `xattr -dr com.apple.quarantine EarGuard.app` in Terminal.
3. Look for the 🎧 icon in the menu bar.
4. Allow **System Audio Recording** when asked (System Settings → Privacy & Security → *Screen & System Audio Recording*).
   Without it EarGuard cannot hear what you play.
5. **Bluetooth headphones:** keep **System Settings → Sound → Input** on the Mac's own microphone.
   If a Bluetooth headset is the input, macOS switches it to phone-call quality. EarGuard warns you when this happens.

### Windows
1. Download `EarGuard-windows.exe` and double-click it.
2. SmartScreen may warn that the app is unrecognised (it is not code-signed): **More info → Run anyway**.
3. Find the round icon in the tray (bottom-right, maybe behind the `^`). The number on it is the live dB.
   Right-click for today's and the weekly dose.

### Android
1. Download `EarGuard-android.apk` on the phone and open it. Allow *install unknown apps* if asked.
2. Tap **Start monitoring**. Allow the microphone (Android requires it for capturing playback; nothing is recorded or uploaded),
   notifications, and the screen-capture prompt (only audio is used).
3. Play music through your headphones. Some apps block capture; those show "no audio captured".

### iPhone
- **Live:** Settings → Control Center → add **Hearing**. Play music, open Control Center, tap the tile.
- **Weekly dose:** export Apple Health (Health app → profile picture → *Export All Health Data*), then open the
  [Health page](https://prime-com.github.io/ear_guard/health.html) and choose the zip. It is read in your browser and never uploaded.

## How accurate is it?

Be sceptical of the absolute number, and trust trends more than digits.

```
level at your ear  =  loudness of the sound  +  volume setting  +  how loud your headphones are
```

The first two are measured on your device. The third is **not known** for most headphones, so EarGuard uses a
cautious default (100 ± 10 dB for a full-scale tone) that is a placeholder, not a measurement of your pair.
Tested live on a Mac, a Windows PC and an Android phone with Sony ULT WEAR and Apple EarPods. Expect to be
off by roughly ±10 dB until per-headphone data exists. See [docs/PLAN.md](docs/PLAN.md) for the reasoning, and
[docs/HANDOFF.md](docs/HANDOFF.md) for exactly what was verified and what was not.

## Build from source

| Part | Command |
|------|---------|
| Mac app | `cd app/mac && ./build-app.sh && open build/EarGuard.app` (needs Swift / Xcode command-line tools) |
| Windows app | `dotnet publish app/windows/EarGuardWin -c Release -r win-x64 --self-contained -p:PublishSingleFile=true` |
| Android app | `gradle -p android assembleDebug` (JDK 17) |
| Web pages | `npm install && npm run dev` (`npm test` runs the maths tests) |

Shared maths (dose, A-weighting, estimate) is written four times (TypeScript, Swift, C#, Kotlin).
[test-vectors/core.json](test-vectors/core.json) is checked by all four so they cannot drift apart.

## Project layout
- `app/mac`, `app/windows`, `android/` — the apps
- `src/` + `*.html` — web pages (Apple Health analysis, experimental mic-calibration lab)
- `spike/` — small feasibility experiments, kept for reference
- `docs/` — plan and handoff notes
- `.github/workflows/` — CI and the release build

## Privacy
No servers, no analytics, no accounts. Audio is analysed in memory and never stored or sent anywhere.
Your listening totals are saved only on your own device.

## Licence
MIT
