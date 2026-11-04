import Foundation

// Port of src/core/calibration.ts (dose + live-level maths). Shared test vectors in
// test-vectors/core.json keep the TypeScript and Swift versions in agreement.

public let refPressurePa = 20e-6

public enum DoseMode: String, Codable {
    case standard  // 80 dB(A) for 40 h/week  (WHO / ITU-T H.870)
    case sensitive // 75 dB(A) for 40 h/week

    public var allowancePa2h: Double { self == .standard ? 1.6 : 0.51 }
}

public func dbToPa2(_ db: Double) -> Double {
    pow(refPressurePa * pow(10, db / 20), 2)
}

/// Sound energy (Pa²·h) of listening at `db` dB(A) for `seconds`.
public func exposurePa2h(db: Double, seconds: Double) -> Double {
    dbToPa2(db) * (seconds / 3600)
}

/// Fraction of the weekly allowance used (1.0 = 100 %).
public func weeklyDoseFraction(pa2h: Double, mode: DoseMode = .standard) -> Double {
    pa2h / mode.allowancePa2h
}

/// Hours per week allowed at a constant level.
public func allowedHoursPerWeek(db: Double, mode: DoseMode = .standard) -> Double {
    mode.allowancePa2h / dbToPa2(db)
}

/// Live estimate at the ear: signal (A-weighted dBFS) + volume (dB) + S_device.
public func earLevelDb(signalDbA: Double, volumeDb: Double, sDevice: Double) -> Double {
    signalDbA + volumeDb + sDevice
}

/// dBFS per AES17: a full-scale sine is 0 dBFS (rms · √2).
public func rmsToDbfs(_ rms: Double) -> Double {
    rms > 0 ? 20 * log10(rms * 2.0.squareRoot()) : -.infinity
}
