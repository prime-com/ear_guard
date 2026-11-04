import Foundation

/// A value with a 1-sigma uncertainty, both in dB.
public struct Estimate: Codable, Equatable {
    public var value: Double
    public var sigma: Double
    public init(value: Double, sigma: Double) { self.value = value; self.sigma = sigma }
}

/// Cautious default for headphones we know nothing about (layer 3 of docs/PLAN.md):
/// dB SPL a full-scale 1 kHz tone produces at the ear at maximum volume.
///
/// ⚠️ UNVERIFIED PLACEHOLDER. It is NOT a measurement of any headphone. It is chosen to span
/// the only two reference points we have: Sony ULT WEAR ≈ 85–88 dB (hearing check, which reads
/// low) and Apple EarPods ≈ 111 dB (Apple Health on an iPhone at max volume — source-dependent).
/// It is meant to lean LOUD. Replace it with verified data (docs/PLAN.md M6). The UI must keep
/// calling the result a "rough estimate".
public let defaultDevice = Estimate(value: 100, sigma: 10)

/// Uncertainty added for mapping the OS volume slider to dB (the slider curve differs by OS,
/// device and Bluetooth absolute-volume behaviour; only one point has been measured).
public let volumeMappingSigma = 6.0

/// Slider position (0…1) → dB relative to maximum.
///
/// ⚠️ ASSUMPTION: amplitude proportional to the slider, i.e. 20·log10(slider). The one point
/// measured (Mac, Sony over Bluetooth, slider ≈ 0.5 → ≈ −17 dB) is QUIETER than this gives
/// (−6 dB), so the assumption leans loud, which is the safe side.
public func volumeDb(fromScalar scalar: Double) -> Double {
    guard scalar > 0 else { return -120 }
    return max(-60, 20 * log10(min(1, scalar)))
}

public struct LevelEstimate: Equatable {
    public var dbA: Double          // best estimate of the level at the ear
    public var sigma: Double
    /// Value used for dose: estimate + 1σ (reads loud when unsure — safety rule).
    public var conservative: Double { dbA + sigma }
    public var low: Double { dbA - sigma }
    public var high: Double { dbA + sigma }
}

public func estimateLevel(signalDbA: Double, volumeScalar: Double, device: Estimate = defaultDevice) -> LevelEstimate {
    let level = earLevelDb(signalDbA: signalDbA, volumeDb: volumeDb(fromScalar: volumeScalar), sDevice: device.value)
    return LevelEstimate(dbA: level, sigma: (device.sigma * device.sigma + volumeMappingSigma * volumeMappingSigma).squareRoot())
}

/// Below this the estimate means "practically silent", not a listening level. It also catches the
/// slider at 0 (volumeDb → −120) and near-silent signals, which would otherwise give negative dB.
public let minReportableDb = 20.0

public extension LevelEstimate {
    var isReportable: Bool { dbA.isFinite && dbA >= minReportableDb }
}
