import AppKit
import EarGuardCore

func pct(_ f: Double) -> String { f < 0.1 ? String(format: "%.1f %%", f * 100) : String(format: "%.0f %%", f * 100) }

final class MenuBarApp: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let monitor = AudioMonitor()
    private let tracker = Tracker(store: DoseStore(url: DoseStore.defaultURL()))
    private var lastOutput: OutputInfo?
    private var errorText: String?
    private var bluetoothInput: String?

    private let headerItem = NSMenuItem()
    private let deviceItem = NSMenuItem()
    private let levelItem = NSMenuItem()
    private let detailItem = NSMenuItem()
    private let todayItem = NSMenuItem()
    private let weekItem = NSMenuItem()
    private let allowedItem = NSMenuItem()
    private let hintItem = NSMenuItem()
    private let pauseItem = NSMenuItem(title: "Pause tracking", action: #selector(togglePause), keyEquivalent: "")
    private let sensitiveItem = NSMenuItem(title: "Sensitive listener (75 dB limit)", action: #selector(toggleSensitive), keyEquivalent: "")

    private let defaults = UserDefaults.standard

    func applicationDidFinishLaunching(_ notification: Notification) {
        // remembered between launches
        tracker.mode = defaults.string(forKey: "mode") == "sensitive" ? .sensitive : .standard
        tracker.paused = defaults.bool(forKey: "paused")
        statusItem.button?.title = "🎧"
        let menu = NSMenu()
        headerItem.title = "EarGuard — rough estimate"
        for i in [headerItem, deviceItem, levelItem, detailItem, hintItem] { i.isEnabled = false; menu.addItem(i) }
        menu.addItem(.separator())
        for i in [todayItem, weekItem, allowedItem] { i.isEnabled = false; menu.addItem(i) }
        menu.addItem(.separator())
        pauseItem.target = self; sensitiveItem.target = self
        menu.addItem(pauseItem); menu.addItem(sensitiveItem)
        let about = NSMenuItem(title: "About this estimate…", action: #selector(showAbout), keyEquivalent: ""); about.target = self
        let perm = NSMenuItem(title: "Audio permission settings…", action: #selector(openPermissionSettings), keyEquivalent: ""); perm.target = self
        menu.addItem(about); menu.addItem(perm)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit EarGuard", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu

        monitor.onReading = { [weak self] r in
            guard let self else { return }
            self.lastOutput = r.output
            self.bluetoothInput = r.bluetoothInput
            self.errorText = nil
            self.tracker.handle(r)
            self.refresh()
        }
        monitor.onError = { [weak self] msg in self?.errorText = msg; self?.refresh() }
        monitor.start()
        refresh()
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.tracker.store.save() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        monitor.stop()
        tracker.store.save()
    }

    private func refresh() {
        let week = tracker.weekFraction()
        let warn = (week >= 1 ? " ⚠︎" : "") + (tracker.paused ? " ⏸" : "")
        deviceItem.title = lastOutput.map { "Output: \($0.name) (\($0.transportLabel))" } ?? "Output: —"
        hintItem.isHidden = true
        allowedItem.isHidden = true

        switch tracker.state {
        case .playing(let est, let signal, let volume):
            statusItem.button?.title = "≈\(Int(est.dbA.rounded())) dB\(warn)"
            levelItem.title = "At your ears: about \(Int(est.dbA.rounded())) dB(A)  (range \(Int(est.low.rounded()))–\(Int(est.high.rounded())))"
            detailItem.title = String(format: "Signal %.0f dBFS(A) · volume %@", signal, volume.map { String(format: "%.0f %%", $0 * 100) } ?? "unknown (assuming max)")
            allowedItem.title = String(format: "At this level: about %.1f h/week allowed", allowedHoursPerWeek(db: est.conservative, mode: tracker.mode))
            allowedItem.isHidden = false
        case .notHeadphones:
            statusItem.button?.title = "🎧" + warn
            levelItem.title = "Not headphones — not tracked"
            detailItem.title = "Speakers, displays and AirPlay aren't counted."
        case .muted:
            statusItem.button?.title = "🎧" + warn
            levelItem.title = "Muted"
            detailItem.title = ""
        case .veryQuiet:
            statusItem.button?.title = "🎧" + warn
            levelItem.title = "Very quiet (below \(Int(minReportableDb)) dB) — not counted"
            detailItem.title = ""
        case .silent:
            statusItem.button?.title = "🎧" + warn
            levelItem.title = "No sound playing"
            detailItem.title = ""
            if tracker.silentSeconds > 20, (lastOutput?.volume ?? 0) > 0.05 {
                hintItem.title = "If something is playing, allow System Audio Recording (menu below)."
                hintItem.isHidden = false
            }
        }
        if let b = bluetoothInput {
            hintItem.title = "⚠︎ Mic input is \(b): can switch headphones to call mode. Set Sound → Input to the Mac's mic."
            hintItem.isHidden = false
        }
        if let e = errorText { levelItem.title = "Problem: \(e)"; detailItem.title = "Open 'Audio permission settings…'." }
        todayItem.title = "Today: \(pct(tracker.todayFraction())) of the weekly limit"
        weekItem.title = "Last 7 days: \(pct(week)) of the weekly limit (\(tracker.mode == .standard ? "80" : "75") dB(A) × 40 h)"
        pauseItem.title = tracker.paused ? "Resume tracking" : "Pause tracking"
        pauseItem.state = tracker.paused ? .on : .off
        if tracker.paused {
            levelItem.title = "Paused — not counting.  " + levelItem.title
        }
        sensitiveItem.state = tracker.mode == .sensitive ? .on : .off
    }

    @objc private func togglePause() {
        tracker.paused.toggle()
        defaults.set(tracker.paused, forKey: "paused")
        refresh()
    }

    @objc private func toggleSensitive() {
        tracker.mode = tracker.mode == .standard ? .sensitive : .standard
        defaults.set(tracker.mode == .sensitive ? "sensitive" : "standard", forKey: "mode")
        refresh()
    }

    /// "System Audio Recording" lives under Privacy & Security → "Screen & System Audio Recording" on current
    /// macOS. Try that pane first, then older anchors, then plain System Settings.
    @objc private func openPermissionSettings() {
        let candidates = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture",
            "x-apple.systempreferences:com.apple.preference.security",
        ]
        for c in candidates {
            if let url = URL(string: c), NSWorkspace.shared.open(url) { return }
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
    }

    @objc private func showAbout() {
        // A menu-bar-only app is not frontmost, so bring it forward or the window opens hidden behind others.
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.addButton(withTitle: "OK")
        a.messageText = "A rough estimate, not a measurement"
        a.informativeText = """
        EarGuard hears what your Mac plays and combines it with the volume setting and an assumed headphone loudness (100 dB ± 10 for a full-scale tone). That assumption is a placeholder that leans loud — it is not measured for your headphones, and the volume-slider curve is also assumed.

        So treat the number as "somewhere around", not exact. When unsure it reads LOUD, never quiet: the listening total uses the high end of the range.

        Everything stays on this Mac. Nothing is uploaded.
        """
        a.runModal()
    }
}
