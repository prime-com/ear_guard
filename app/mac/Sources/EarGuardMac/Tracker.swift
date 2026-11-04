import EarGuardCore
import Foundation

/// Turns audio readings into a level estimate and a listening dose.
final class Tracker {
    enum State: Equatable {
        case notHeadphones              // speakers / display: not tracked
        case muted
        case silent                     // nothing heard (or capture permission missing)
        case playing(LevelEstimate, signalDbfsA: Double, volume: Double?)
    }

    let store: DoseStore
    var mode: DoseMode = .standard
    var paused = false
    private(set) var state: State = .silent
    private(set) var silentSeconds = 0.0

    init(store: DoseStore) { self.store = store }

    @discardableResult
    func handle(_ r: AudioMonitor.Reading, at date: Date = Date()) -> State {
        guard r.output.isHeadphones else { silentSeconds = 0; return set(.notHeadphones) }
        if r.output.muted { silentSeconds = 0; return set(.muted) }
        guard let w = r.window, !w.isSilent, w.dbfsA.isFinite else {
            silentSeconds += r.seconds
            return set(.silent)
        }
        silentSeconds = 0
        // Volume unknown (some devices expose no slider): assume maximum — the loud side.
        let est = estimateLevel(signalDbA: w.dbfsA, volumeScalar: r.output.volume ?? 1)
        if !paused { store.add(pa2h: exposurePa2h(db: est.conservative, seconds: r.seconds), at: date) }
        return set(.playing(est, signalDbfsA: w.dbfsA, volume: r.output.volume))
    }

    private func set(_ s: State) -> State { state = s; return s }

    func weekFraction(now: Date = Date()) -> Double { weeklyDoseFraction(pa2h: store.weekPa2h(now: now), mode: mode) }
    func todayFraction(now: Date = Date()) -> Double { weeklyDoseFraction(pa2h: store.todayPa2h(now: now), mode: mode) }
}
