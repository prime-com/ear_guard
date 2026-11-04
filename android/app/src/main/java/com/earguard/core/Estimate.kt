package com.earguard.core

import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

data class Estimate(val value: Double, val sigma: Double)

/**
 * Cautious default for headphones we know nothing about (layer 3 of docs/PLAN.md): dB SPL a full-scale
 * 1 kHz tone produces at the ear at maximum volume.
 *
 * UNVERIFIED PLACEHOLDER — not a measurement of any headphone. Chosen to span the only two reference points
 * we have (Sony ULT WEAR ≈ 85–88 dB from the hearing check, which reads low; Apple EarPods ≈ 111 dB from
 * Apple Health on an iPhone) and to lean LOUD. The UI must keep calling the result a "rough estimate".
 */
val DEFAULT_DEVICE = Estimate(100.0, 10.0)

/** Uncertainty added for mapping the OS volume setting to dB (assumed curve, device dependent). */
const val VOLUME_MAPPING_SIGMA = 6.0

/**
 * Volume (0…1) → dB relative to maximum. ASSUMPTION: amplitude proportional to the setting, 20·log10(v).
 * The one point measured on a Mac (≈ 0.5 → ≈ −17 dB) is quieter than this gives (−6 dB), so it leans loud.
 */
fun volumeDb(scalar: Double): Double = if (scalar > 0) max(-60.0, 20 * log10(min(1.0, scalar))) else -120.0

/** Below this the estimate means "practically silent", not a listening level (also catches volume 0). */
const val MIN_REPORTABLE_DB = 20.0

data class LevelEstimate(val dbA: Double, val sigma: Double) {
    /** Value used for dose: estimate + 1σ (reads loud when unsure — safety rule). */
    val conservative: Double get() = dbA + sigma
    val low: Double get() = dbA - sigma
    val high: Double get() = dbA + sigma
    val isReportable: Boolean get() = dbA.isFinite() && dbA >= MIN_REPORTABLE_DB
}

fun estimateLevel(signalDbA: Double, volumeScalar: Double, device: Estimate = DEFAULT_DEVICE): LevelEstimate {
    val level = earLevelDb(signalDbA, volumeDb(volumeScalar), device.value)
    return LevelEstimate(level, sqrt(device.sigma * device.sigma + VOLUME_MAPPING_SIGMA * VOLUME_MAPPING_SIGMA))
}
