import AppKit
import EarGuardCore

/// `EarGuardMac --print [seconds]` runs the engine with no UI (for testing).
func runHeadless(seconds: Int) {
    let tracker = Tracker(store: DoseStore(url: nil))
    let monitor = AudioMonitor()
    var n = 0
    monitor.onError = { print("ERROR: \($0)"); exit(2) }
    monitor.onReading = { r in
        let s = tracker.handle(r)
        var line = "\(r.output.name) [\(r.output.transportLabel)] vol=\(r.output.volume.map { String(format: "%.3f", $0) } ?? "n/a") muted=\(r.output.muted) → "
        switch s {
        case .playing(let e, let sig, _): line += String(format: "signal %.1f dBFS(A) → ≈%.0f dB(A) (%.0f–%.0f) cons=%.0f  week=%.4f%%", sig, e.dbA, e.low, e.high, e.conservative, tracker.weekFraction() * 100)
        case .notHeadphones: line += "not headphones (not tracked)"
        case .muted: line += "muted"
        case .veryQuiet: line += "very quiet (not counted)"
        case .silent: line += "silent"
        }
        print(line)
        n += 1
        if n >= seconds { monitor.stop(); exit(0) }
    }
    monitor.start()
    RunLoop.main.run()
}

if let i = CommandLine.arguments.firstIndex(of: "--print") {
    runHeadless(seconds: Int(CommandLine.arguments.dropFirst(i + 1).first ?? "5") ?? 5)
} else {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = MenuBarApp()
    app.delegate = delegate
    app.run()
}
