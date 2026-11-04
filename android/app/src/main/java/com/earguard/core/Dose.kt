package com.earguard.core

import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sqrt

// Port of src/core/calibration.ts and app/mac/.../Dose.swift.
// test-vectors/core.json keeps the TypeScript, Swift and Kotlin versions in agreement.

const val REF_PRESSURE_PA = 20e-6

enum class DoseMode(val allowancePa2h: Double) {
    STANDARD(1.6), // 80 dB(A) for 40 h/week (WHO / ITU-T H.870)
    SENSITIVE(0.51), // 75 dB(A) for 40 h/week
}

fun dbToPa2(db: Double): Double = (REF_PRESSURE_PA * 10.0.pow(db / 20)).pow(2)

/** Sound energy (Pa²·h) of listening at [db] dB(A) for [seconds]. */
fun exposurePa2h(db: Double, seconds: Double): Double = dbToPa2(db) * (seconds / 3600)

/** Fraction of the weekly allowance used (1.0 = 100 %). */
fun weeklyDoseFraction(pa2h: Double, mode: DoseMode = DoseMode.STANDARD): Double = pa2h / mode.allowancePa2h

/** Hours per week allowed at a constant level. */
fun allowedHoursPerWeek(db: Double, mode: DoseMode = DoseMode.STANDARD): Double = mode.allowancePa2h / dbToPa2(db)

/** Live estimate at the ear: signal (A-weighted dBFS) + volume (dB) + S_device. */
fun earLevelDb(signalDbA: Double, volumeDb: Double, sDevice: Double): Double = signalDbA + volumeDb + sDevice

/** dBFS per AES17: a full-scale sine is 0 dBFS (rms · √2). */
fun rmsToDbfs(rms: Double): Double = if (rms > 0) 20 * log10(rms * sqrt(2.0)) else Double.NEGATIVE_INFINITY
