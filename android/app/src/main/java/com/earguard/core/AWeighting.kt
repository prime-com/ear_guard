package com.earguard.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * A-weighting (IEC 61672) as three digital biquads, designed with the bilinear transform and pre-warped pole
 * frequencies, normalised to 0 dB at 1 kHz. Same design as the Swift version.
 */
class AWeightingFilter(val sampleRate: Double) {
    private class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
        var z1 = 0.0
        var z2 = 0.0
        fun process(x: Double): Double {
            val y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }
        fun magnitude(omega: Double): Double {
            val c1 = cos(omega); val s1 = sin(omega); val c2 = cos(2 * omega); val s2 = sin(2 * omega)
            val nr = b0 + b1 * c1 + b2 * c2; val ni = -(b1 * s1 + b2 * s2)
            val dr = 1 + a1 * c1 + a2 * c2; val di = -(a1 * s1 + a2 * s2)
            return sqrt((nr * nr + ni * ni) / (dr * dr + di * di))
        }
    }

    private val sections: List<Biquad>
    private val gain: Double

    init {
        val f1 = 20.598997; val f2 = 107.65265; val f3 = 737.86223; val f4 = 12194.217
        val c = 2 * sampleRate
        fun w(f: Double) = c * tan(2 * PI * f / c) // pre-warp
        val w1 = w(f1); val w2 = w(f2); val w3 = w(f3); val w4 = w(f4)
        // analog sections: b2, b1, b0, a2, a1, a0
        val analog = listOf(
            doubleArrayOf(1.0, 0.0, 0.0, 1.0, 2 * w1, w1 * w1), // s² / (s+w1)²
            doubleArrayOf(1.0, 0.0, 0.0, 1.0, w2 + w3, w2 * w3), // s² / ((s+w2)(s+w3))
            doubleArrayOf(0.0, 0.0, 1.0, 1.0, 2 * w4, w4 * w4), // 1  / (s+w4)²
        )
        sections = analog.map { s ->
            val (b2, b1, b0, a2, a1, a0) = s
            val c2 = c * c
            val n0 = b2 * c2 + b1 * c + b0; val n1 = -2 * b2 * c2 + 2 * b0; val n2 = b2 * c2 - b1 * c + b0
            val d0 = a2 * c2 + a1 * c + a0; val d1 = -2 * a2 * c2 + 2 * a0; val d2 = a2 * c2 - a1 * c + a0
            Biquad(n0 / d0, n1 / d0, n2 / d0, d1 / d0, d2 / d0)
        }
        val omega1k = 2 * PI * 1000 / sampleRate
        gain = 1 / sections.fold(1.0) { acc, s -> acc * s.magnitude(omega1k) }
    }

    fun process(x: Float): Float {
        var v = x.toDouble()
        for (s in sections) v = s.process(v)
        return (v * gain).toFloat()
    }

    /** Filter gain in dB at [frequency] (for tests). */
    fun responseDb(frequency: Double): Double {
        val omega = 2 * PI * frequency / sampleRate
        return 20 * log10(gain * sections.fold(1.0) { acc, s -> acc * s.magnitude(omega) })
    }
}

private operator fun DoubleArray.component6() = this[5]
